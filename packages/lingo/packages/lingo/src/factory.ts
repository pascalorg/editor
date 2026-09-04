import { convertDeltaValue, convertValue } from './core/convert'
import { makeIssue } from './core/errors'
import { Quantity } from './core/quantity'
import { createRegistry, type FuzzyVocab, type Registry } from './core/registry'
import type { IssueCode, Kind, KindDef, LingoIssue, Messages, Span, UnitDef } from './core/types'
import type { BuiltinKind, BuiltinUnitRef, KindOfUnit, UnitRefByKind } from './core/unit-refs'
import { registerTemperatureVocabs } from './fuzzy/temperature'
import type { LocalePack } from './locale'
import { en } from './messages/en'
import { type ParserState, prepare } from './parse/config'
import { parsePreparedExpression } from './parse/finish'
import {
  type FailResult,
  type LingoResult,
  type ParseOptions,
  type PartialState,
  parseExpression,
  parseQuantityExpr,
  parseRangeExpr,
  partialQuantityState,
  type QuantityResult,
  type RangeResult,
} from './parse/grammar'
import { attachSerialization } from './parse/serialize'
import {
  candidateOf as resultCandidateOf,
  firstError as resultFirstError,
  formatIssue as resultFormatIssue,
  isConversion as resultIsConversion,
  isQuantity as resultIsQuantity,
  isRange as resultIsRange,
} from './result'
import { allKinds, byteishFallbacks } from './units/index'

const DEFAULT_FALLBACKS: NonNullable<ParseOptions['aliasFallbacks']> = byteishFallbacks

/**
 * Public options: everything from the grammar, registry optional. Accepted
 * by `lingo()`, `parseQuantity()`, `parseRange()`, `partialState()`,
 * `findQuantities()` — and their `createLingo()`-bound equivalents.
 * @example
 * ```ts
 * import { lingo, type LingoOptions } from '@pascal-app/lingo'
 * const opts: LingoOptions = { kind: 'length', strictness: 'confirm' }
 * lingo('5 meterz', opts)
 * ```
 */
export type LingoOptions = Omit<
  ParseOptions,
  'registry' | 'aliasFallbacks' | 'extract' | 'localePacks'
> & {
  registry?: Registry
}

/**
 * Caller-supplied FX rates relative to one base currency.
 * @example
 * ```ts
 * import type { RateSnapshot } from '@pascal-app/lingo'
 * const rates: RateSnapshot = { base: 'USD', rates: { USD: 1, EUR: 0.92 } }
 * ```
 */
export interface RateSnapshot {
  asOf?: string
  base: string
  rates: Record<string, number>
}

/**
 * Synchronous FX rate provider. lingo never fetches rates itself.
 * @example
 * ```ts
 * import type { RateProvider } from '@pascal-app/lingo'
 * const rates: RateProvider = (from, to) => (from === 'USD' && to === 'EUR' ? 0.92 : 1)
 * ```
 */
export type RateProvider = (from: string, to: string) => number

/**
 * Successful `tryConvert()` result with the converted value, target unit, and
 * kind, so JSON logs stay self-explanatory.
 * @example
 * ```ts
 * import { tryConvert, type TryConvertSuccess } from '@pascal-app/lingo'
 * const r = tryConvert(72, 'in', 'cm')
 * if (r.ok) {
 *   const ok: TryConvertSuccess = r
 * }
 * ```
 */
export interface TryConvertSuccess {
  kind: Kind
  ok: true
  schemaVersion: 3
  type: 'conversion'
  unit: string
  value: number
}

/**
 * Failed `tryConvert()` result: no exception, just normal structured lingo
 * issues (`UNKNOWN_UNIT`, `CONVERSION_KIND_MISMATCH`, `RATE_REQUIRED`, ...).
 * @example
 * ```ts
 * import { tryConvert, type TryConvertFailure } from '@pascal-app/lingo'
 * const r = tryConvert(5, 'USD', 'EUR')
 * if (!r.ok) {
 *   const failure: TryConvertFailure = r
 * }
 * ```
 */
export interface TryConvertFailure {
  issues: LingoIssue[]
  ok: false
  schemaVersion: 3
  type: 'failure'
}

/**
 * Non-throwing result from `tryConvert()`: success carries the converted
 * number, failure carries normal structured lingo issues.
 * @example
 * ```ts
 * import { tryConvert } from '@pascal-app/lingo'
 * const r = tryConvert(72, 'in', 'cm')
 * if (r.ok) r.value // 182.88
 * ```
 */
export type TryConvertResult = TryConvertSuccess | TryConvertFailure

export function assertFiniteNumber(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`lingo: ${field} must be a finite number`)
  }
}

export function currencyUnit(reg: Registry, code: string): UnitDef {
  const unit = reg.unitByRef('currency', code)
  if (!unit) {
    throw new Error(`lingo: unknown currency "${code}"`)
  }
  return unit
}

function currencyMinorScale(unit: UnitDef): number {
  return 10 ** (unit.minorUnit ?? 2)
}

export function snapshotRate(snapshot: RateSnapshot, code: string, base: string): number {
  if (code === base) {
    return 1
  }
  const rate = snapshot.rates[code]
  if (rate === undefined || !(rate > 0 && Number.isFinite(rate))) {
    throw new Error(`lingo: missing rate for currency "${code}"`)
  }
  return rate
}

/**
 * `createLingo()`'s `fuzzy` option: `false` to skip fuzzy vocab entirely, or
 * an explicit `{ kind, vocab }[]` list instead of the default temperature
 * words. Omitted defaults to the built-in temperature vocab when using the
 * default `kinds`, and to none when a custom `kinds` list is supplied.
 * @example
 * ```ts
 * import { createLingo, type LingoFuzzyOption } from '@pascal-app/lingo'
 * const fuzzy: LingoFuzzyOption = [{ kind: 'mass', vocab: {
 *   profile: 'parcels', unit: 'kg', terms: { light: [0, 5], heavy: [20, 70] },
 * } }]
 * createLingo({ fuzzy })
 * ```
 */
export type LingoFuzzyOption = false | Array<{ kind: Kind; vocab: FuzzyVocab }>

/**
 * Options for `createLingo()`: an isolated instance instead of mutating the
 * shared default registry.
 * @example
 * ```ts
 * import { createLingo, allKinds } from '@pascal-app/lingo'
 * const lengthOnly = createLingo({ kinds: allKinds.filter((k) => k.kind === 'length') })
 * lengthOnly.parse('5 kg').ok // false — 'mass' was never registered
 * ```
 */
export interface CreateLingoOptions {
  fuzzy?: LingoFuzzyOption
  kinds?: readonly KindDef[]
  locales?: readonly LocalePack[]
  messages?: Messages
  registry?: Registry
}

type BuiltinCreateLingoOptions = Omit<CreateLingoOptions, 'kinds' | 'registry'> & {
  kinds?: undefined
  registry?: undefined
}

/**
 * What `createLingo()` returns: the same API as the main entry's top-level
 * functions, bound to one isolated registry/messages pack — no shared
 * mutable state, safe for SSR and multi-tenant use.
 * @example
 * ```ts
 * import { createLingo } from '@pascal-app/lingo'
 * const tenant = createLingo() // : LingoInstance
 * tenant.parseQuantity('5 kg').ok // true
 * ```
 */
export interface LingoInstance {
  /** Instance-bound equivalent of the main entry's `candidateOf()`. */
  candidateOf(result: LingoResult): Exclude<LingoResult, FailResult> | null
  /** Instance-bound equivalent of the main entry's `convert()`. */
  convert(value: number, from: string, to: string): number
  /** Instance-bound equivalent of the main entry's `convertDelta()`. */
  convertDelta(value: number, from: string, to: string): number
  /** Instance-bound equivalent of the main entry's `findQuantities()`. */
  findQuantities(text: string, opts?: LingoOptions): FoundQuantity[]
  /** Instance-bound equivalent of the main entry's `firstError()`. */
  firstError(result: LingoResult | null | undefined): LingoIssue | null
  /** Instance-bound equivalent of the main entry's `formatIssue()`. */
  formatIssue<C extends IssueCode>(issue: LingoIssue<C>, messages?: Messages): string
  /** Instance-bound equivalent of the main entry's `fromMinor()`. */
  fromMinor(amount: number, code: string): Quantity
  /** Instance-bound equivalent of the main entry's `isConversion()`. */
  isConversion(result: LingoResult): result is Extract<LingoResult, { type: 'conversion' }>
  /** Instance-bound equivalent of the main entry's `isQuantity()`. */
  isQuantity(result: LingoResult): result is QuantityResult
  /** Instance-bound equivalent of the main entry's `isRange()`. */
  isRange(result: LingoResult): result is RangeResult
  /** Instance-bound equivalent of the main entry's `lingo()`. */
  parse(input: string, opts?: LingoOptions): LingoResult
  /** Instance-bound equivalent of the main entry's `parseQuantity()`. */
  parseQuantity(input: string, opts?: LingoOptions): QuantityResult | FailResult
  /** Instance-bound equivalent of the main entry's `parseRange()`. */
  parseRange(input: string, opts?: LingoOptions): RangeResult | FailResult
  /** Instance-bound equivalent of the main entry's `partialState()`. */
  partialState(input: string, opts?: LingoOptions): PartialState
  /** Instance-bound equivalent of the main entry's `quantity()`. */
  quantity(value: number, unit: string, kind?: Kind): Quantity
  /** Instance-bound equivalent of the main entry's `tryConvert()`. */
  tryConvert(value: number, from: string, to: string): TryConvertResult
}

export type BuiltinLingoInstance = Omit<
  LingoInstance,
  'convert' | 'convertDelta' | 'fromMinor' | 'quantity' | 'tryConvert'
> & {
  /** Built-in instance-bound equivalent of the main entry's typed `convert()`. */
  convert: ConvertFn
  /** Built-in instance-bound equivalent of the main entry's typed `convertDelta()`. */
  convertDelta: ConvertFn
  /** Built-in instance-bound equivalent of the main entry's typed `fromMinor()`. */
  fromMinor: FromMinorFn
  /** Built-in instance-bound equivalent of the main entry's typed `quantity()`. */
  quantity: QuantityFn
  /** Built-in instance-bound equivalent of the main entry's typed `tryConvert()`. */
  tryConvert: TryConvertFn
}

type ValidateConvertTo<From extends string, To extends string> = string extends From
  ? To
  : string extends To
    ? To
    : [KindOfUnit<From>] extends [never]
      ? To
      : To extends UnitRefByKind<KindOfUnit<From>>
        ? To
        : UnitRefByKind<KindOfUnit<From>>

type ValidateQuantityUnit<Unit extends string> = string extends Unit
  ? Unit
  : [KindOfUnit<Unit>] extends [never]
    ? BuiltinUnitRef
    : Unit

type ValidateQuantityKind<Unit extends string, K extends string | undefined> = K extends undefined
  ? K
  : string extends Unit
    ? K
    : string extends K
      ? K
      : K extends KindOfUnit<Unit>
        ? K
        : KindOfUnit<Unit>

type QuantityKind<Unit extends string, K extends string | undefined> = string extends Unit
  ? K extends BuiltinKind
    ? K
    : Kind
  : K extends BuiltinKind
    ? K
    : KindOfUnit<Unit> extends BuiltinKind
      ? KindOfUnit<Unit>
      : Kind

export type ValidateCurrencyUnit<Unit extends string> = string extends Unit
  ? Unit
  : Unit extends UnitRefByKind<'currency'>
    ? Unit
    : UnitRefByKind<'currency'>

export type QuantityFn = <
  const Unit extends string,
  const K extends string | undefined = undefined,
>(
  value: number,
  unit: Unit & ValidateQuantityUnit<Unit>,
  kind?: K & ValidateQuantityKind<Unit, K>,
) => Quantity<QuantityKind<Unit, K>>

export type ConvertFn = <const From extends string, const To extends string>(
  value: number,
  from: From,
  to: To & ValidateConvertTo<From, To>,
) => number

export type TryConvertFn = <const From extends string, const To extends string>(
  value: number,
  from: From,
  to: To & ValidateConvertTo<From, To>,
) => TryConvertResult

export type FromMinorFn = <const Code extends string>(
  amount: number,
  code: Code & ValidateCurrencyUnit<Code>,
) => Quantity<'currency'>

function installFuzzy(reg: Registry, fuzzy: LingoFuzzyOption | undefined): void {
  if (fuzzy) {
    for (const { kind, vocab } of fuzzy) {
      reg.defineFuzzyVocab(kind, vocab)
    }
  } else if (fuzzy !== false) {
    registerTemperatureVocabs(reg)
  }
}

function installLocalePacks(
  reg: Registry,
  packs: readonly LocalePack[] | undefined,
  includeFuzzy: boolean,
): void {
  for (const pack of packs ?? []) {
    for (const kind of Object.keys(pack.units ?? {})) {
      for (const [unit, aliases] of pack.units![kind as keyof typeof pack.units] ?? []) {
        reg.registerUnitAliases(kind as Kind, unit, aliases.split(' '))
      }
    }
    for (const { kind, unit, aliases } of pack.unitAliases ?? []) {
      reg.registerUnitAliases(kind, unit, aliases)
    }
    if (!includeFuzzy) {
      continue
    }
    for (const { kind, vocab } of pack.fuzzy ?? []) {
      if (reg.unitByRef(kind, vocab.unit)) {
        reg.defineFuzzyVocab(kind, vocab)
      }
    }
  }
}

/**
 * One hit from `findQuantities()`: a parsed result plus where it sat in the
 * scanned text.
 */
export interface FoundQuantity {
  result: Exclude<LingoResult, FailResult>
  /** Character offsets into the original text. */
  span: Span
}

/**
 * Build an isolated lingo instance: its own registry, messages, and fuzzy
 * vocab, with no shared mutable state — safe for SSR and multi-tenant apps
 * (e.g. per-request locale/unit-system config). The top-level `lingo`/
 * `parseQuantity`/etc. exports are a `createLingo()` singleton bound to
 * `defaultRegistry` internally; call this directly when you need more than
 * one configuration in the same process.
 * @example
 * ```ts
 * import { createLingo } from '@pascal-app/lingo'
 * const metric = createLingo() // isolated instance, same built-in kinds
 * metric.parse('5 kg') // independent of the shared default registry
 * ```
 */
export function createLingo(options?: BuiltinCreateLingoOptions): BuiltinLingoInstance
export function createLingo(options: CreateLingoOptions): LingoInstance
export function createLingo(options: CreateLingoOptions = {}): LingoInstance {
  const reg = options.registry ?? createRegistry(options.kinds ?? allKinds)
  if (!options.registry) {
    installFuzzy(reg, options.fuzzy ?? (options.kinds ? false : undefined))
  } else if (options.fuzzy !== undefined) {
    installFuzzy(reg, options.fuzzy)
  }
  const instanceMessages = options.messages ? { ...en, ...options.messages } : en
  const localePacks = options.locales
  installLocalePacks(reg, localePacks, options.fuzzy !== false)

  const defaultOptions: ParseOptions = {
    aliasFallbacks: DEFAULT_FALLBACKS,
    messages: instanceMessages,
    registry: reg,
    ...(localePacks && { localePacks }),
  }
  const defaultExtractOptions: ParseOptions = { ...defaultOptions, extract: true }

  const resolve = (opts?: LingoOptions, extract?: boolean): ParseOptions => {
    if (!opts) {
      return extract ? defaultExtractOptions : defaultOptions
    }
    return {
      aliasFallbacks: DEFAULT_FALLBACKS,
      ...opts,
      ...(localePacks && { localePacks }),
      messages: opts.messages ?? instanceMessages,
      registry: opts.registry ?? reg,
      ...(extract && { extract }),
    }
  }

  function parse(input: string, opts?: LingoOptions): LingoResult {
    return attachSerialization(parseExpression(input, resolve(opts)))
  }

  function parseQuantity(input: string, opts?: LingoOptions): QuantityResult | FailResult {
    return attachSerialization(parseQuantityExpr(input, resolve(opts)))
  }

  function parseRange(input: string, opts?: LingoOptions): RangeResult | FailResult {
    return attachSerialization(parseRangeExpr(input, resolve(opts)))
  }

  function partialState(input: string, opts?: LingoOptions): PartialState {
    return partialQuantityState(input, resolve(opts))
  }

  function findQuantities(text: string, opts?: LingoOptions): FoundQuantity[] {
    const out: FoundQuantity[] = []
    const parseOptions = resolve(opts, true)
    const prepared = prepare(text, parseOptions)
    let index = 0
    while (index < prepared.tokens.length) {
      const attempt: ParserState = { ...prepared, issues: [] }
      const r = parsePreparedExpression(attempt, index)
      if (r.ok && r.span.end > r.span.start) {
        out.push({ result: r, span: r.span })
        let next = index + 1
        while (next < prepared.tokens.length) {
          const t = prepared.tokens[next]!
          const sourceStart =
            prepared.n.start.length === 0 ? t.start : (prepared.n.start[t.start] ?? text.length)
          if (sourceStart >= r.span.end) {
            break
          }
          next++
        }
        index = Math.max(next, index + 1)
      } else {
        index++
      }
    }
    return out
  }

  function quantity(value: number, unit: string, kind?: Kind): Quantity {
    const target = kind
      ? (() => {
          const u = reg.unitByRef(kind, unit)
          return u ? { kind, unit: u } : undefined
        })()
      : reg.findUnitByRef(unit)
    if (!target) {
      throw new Error(`lingo: unknown unit "${unit}"${kind ? ` for kind "${kind}"` : ''}`)
    }
    return new Quantity(
      reg,
      target.kind,
      value * target.unit.factor + (target.unit.offset ?? 0),
      target.unit.id,
    )
  }

  function fromMinor(amount: number, code: string): Quantity {
    assertFiniteNumber(amount, 'amount')
    const unit = currencyUnit(reg, code)
    return new Quantity(reg, 'currency', amount / currencyMinorScale(unit), unit.id)
  }

  function conversionTargetKind(kind: Kind, to: string): Kind | undefined {
    const found = reg.findUnitByRef(to)
    return found && found.kind !== kind ? found.kind : undefined
  }

  function convert(value: number, from: string, to: string): number {
    const result = tryConvert(value, from, to)
    if (result.ok) {
      return result.value
    }
    throw new Error(result.issues[0]?.message ?? 'lingo: conversion failed')
  }

  function convertDelta(value: number, from: string, to: string): number {
    const found = reg.findUnitByRef(from)
    if (!found) {
      throw new Error(`lingo: unknown unit "${from}"`)
    }
    return convertDeltaValue(reg, found.kind, value, found.unit.id, to)
  }

  function tryConvert(value: number, from: string, to: string): TryConvertResult {
    const failure = (issue: LingoIssue): TryConvertFailure => ({
      ok: false,
      schemaVersion: 3,
      type: 'failure',
      issues: [issue],
    })

    if (!Number.isFinite(value)) {
      return failure(makeIssue('NONFINITE', {}, undefined, instanceMessages))
    }

    const source = reg.findUnitByRef(from)
    if (!source) {
      return failure(makeIssue('UNKNOWN_UNIT', { unit: from }, undefined, instanceMessages))
    }

    const target = reg.unitByRef(source.kind, to)
    if (!target) {
      const targetKind = conversionTargetKind(source.kind, to)
      if (targetKind) {
        return failure(
          makeIssue(
            'CONVERSION_KIND_MISMATCH',
            { found: source.kind, target: targetKind },
            undefined,
            instanceMessages,
          ),
        )
      }
      return failure(makeIssue('UNKNOWN_UNIT', { unit: to }, undefined, instanceMessages))
    }

    if (source.unit.id !== target.id && reg.kind(source.kind)?.rateBased) {
      return failure(
        makeIssue(
          'RATE_REQUIRED',
          { from: source.unit.id, to: target.id },
          undefined,
          instanceMessages,
        ),
      )
    }

    return {
      ok: true,
      schemaVersion: 3,
      type: 'conversion',
      kind: source.kind,
      value: convertValue(reg, source.kind, value, source.unit.id, target.id),
      unit: target.id,
    }
  }

  function formatIssue<C extends IssueCode>(issue: LingoIssue<C>, messages?: Messages): string {
    return resultFormatIssue(issue, messages ?? instanceMessages)
  }

  return {
    parse,
    parseQuantity,
    parseRange,
    partialState,
    findQuantities,
    quantity,
    fromMinor,
    convert,
    convertDelta,
    tryConvert,
    firstError: resultFirstError,
    isQuantity: resultIsQuantity,
    isRange: resultIsRange,
    isConversion: resultIsConversion,
    candidateOf: resultCandidateOf,
    formatIssue,
  }
}
