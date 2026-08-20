/**
 * lingo — make forms easier, LLM tools safer.
 *
 * Batteries-included entry: all built-in kinds registered, fuzzy temperature
 * vocabulary attached, one-call APIs bound to the default registry.
 * For a bring-your-own-data build, use 'lingo/core'.
 */

import { setDefaultMessages } from './core/errors'
import { Quantity, type QuantityJSON, QuantityRange, type QuantityRangeJSON } from './core/quantity'
import { createRegistry, type FuzzyVocab, Registry } from './core/registry'
import type { Kind, KindDef, UnitDef } from './core/types'
import {
  assertFiniteNumber,
  type ConvertFn,
  createLingo,
  currencyUnit,
  type FromMinorFn,
  type QuantityFn,
  type RateProvider,
  type RateSnapshot,
  snapshotRate,
  type TryConvertFn,
  type ValidateCurrencyUnit,
} from './factory'
import { registerTemperatureVocabs } from './fuzzy/temperature'
import { en } from './messages/en'
import { allKinds } from './units/index'

// ---------------------------------------------------------------------------
// Default registry & default copy

/**
 * The registry backing `lingo()`/`parseQuantity()`/etc. — all built-in
 * kinds plus the default temperature fuzzy vocab. Mutate it via
 * `registerKind`/`registerUnits`/`defineFuzzyVocab`, or read it directly for
 * introspection (`defaultRegistry.kinds()`).
 * @example
 * ```ts
 * import { defaultRegistry } from '@pascal-app/lingo'
 * defaultRegistry.unit('length', 'm')?.symbol // 'm'
 * ```
 */
export const defaultRegistry: Registry = createRegistry(allKinds)
registerTemperatureVocabs(defaultRegistry)
setDefaultMessages(en)

// The factory (createLingo + instance/option/result types) lives in
// ./factory; this entry binds one singleton instance to `defaultRegistry`.
export type {
  BuiltinLingoInstance,
  CreateLingoOptions,
  FoundQuantity,
  LingoFuzzyOption,
  LingoInstance,
  LingoOptions,
  RateProvider,
  RateSnapshot,
  TryConvertFailure,
  TryConvertResult,
  TryConvertSuccess,
} from './factory'
export { createLingo } from './factory'
/** The English message pack (core-only builds: `setDefaultMessages(englishMessages)`). */
export { en as englishMessages }

const defaultLingo = createLingo({ registry: defaultRegistry })

/**
 * Parse anything: quantity, range, conversion request, or bare number.
 * Returns a discriminated union — switch on `result.type` (or use the
 * `isQuantity`/`isRange`/`isConversion` type guards).
 * @example
 * ```ts
 * import { lingo } from '@pascal-app/lingo'
 * lingo('72 in to cm')          // { type: 'conversion', converted: 182.88 cm, … }
 * lingo('between 5 and 10 kg')  // { type: 'range', range: 5–10 kg, … }
 * lingo("5'11\"")               // { type: 'quantity', quantity: 1.8034 m as ft+in, … }
 * ```
 */
export const lingo = defaultLingo.parse
/**
 * Parse expecting a single quantity — ranges and bare numbers fail
 * (`ok: false`) instead of returning a different shape. A conversion request
 * succeeds and honors it: the quantity comes back in the requested target
 * unit.
 * @example
 * ```ts
 * import { parseQuantity } from '@pascal-app/lingo'
 * const r = parseQuantity(`5'11"`)
 * r.ok && r.quantity.to('m').value // 1.8034
 * const c = parseQuantity('72 in to cm')
 * c.ok && c.quantity.value // 182.88 — resolved to the requested cm
 * ```
 */
export const parseQuantity = defaultLingo.parseQuantity
/**
 * Parse expecting a range — a single quantity is accepted as a degenerate
 * `[v, v]` range.
 * @example
 * ```ts
 * import { parseRange } from '@pascal-app/lingo'
 * const r = parseRange('between 5 and 10 kg')
 * r.ok && r.range.min()?.value // 5
 * ```
 */
export const parseRange = defaultLingo.parseRange
/**
 * Quad-state verdict for as-you-type UIs — `'empty' | 'incomplete' | 'valid'
 * | 'invalid'`. `'incomplete'` means "a valid prefix, don't show an error
 * yet," never `'invalid'` mid-typing.
 * @example
 * ```ts
 * import { partialState } from '@pascal-app/lingo'
 * partialState('')                        // 'empty'
 * partialState('2 f', { kind: 'length' }) // 'incomplete' — could become "2 ft"
 * partialState('abc')                     // 'invalid'
 * ```
 */
export const partialState = defaultLingo.partialState
/**
 * Scan free text for quantities/ranges/conversions (best-effort, for agents
 * and highlighting — not full NER).
 * @example
 * ```ts
 * import { findQuantities } from '@pascal-app/lingo'
 * findQuantities('bring 2 kg of flour and 500 g of sugar')
 * // [{ result: 2 kg, span: { start: 6, end: 10 } }, { result: 500 g, span: { start: 24, end: 29 } }]
 * ```
 */
export const findQuantities = defaultLingo.findQuantities
/**
 * Build a `Quantity` directly from a number and unit — no parsing, no
 * issues. Throws if `unit` (and `kind`, if given) isn't registered.
 * @example
 * ```ts
 * import { quantity } from '@pascal-app/lingo'
 * quantity(5, 'kg').to('lb').value // 11.023113109243878
 * ```
 */
export const quantity = defaultLingo.quantity as QuantityFn
/**
 * Build a currency `Quantity` from integer minor units — cents, yen, fils,
 * or the registered currency's equivalent.
 * @example
 * ```ts
 * import { fromMinor } from '@pascal-app/lingo'
 * fromMinor(500, 'USD').format() // '$5.00'
 * fromMinor(1234, 'KWD').value   // 1.234
 * ```
 */
export const fromMinor = defaultLingo.fromMinor as FromMinorFn
/**
 * Absolute conversion between two units by ref (id or alias); infers the
 * kind from `from`.
 * @example
 * ```ts
 * import { convert } from '@pascal-app/lingo'
 * convert(72, 'in', 'cm') // 182.88
 * convert(1, 'gal', 'L')  // 3.785411784
 * ```
 */
export const convert = defaultLingo.convert as ConvertFn
/**
 * Non-throwing absolute conversion. Success returns a self-describing
 * conversion payload; failures return normal structured lingo issues instead
 * of throwing, which is friendlier at service/tool boundaries.
 * @example
 * ```ts
 * import { tryConvert } from '@pascal-app/lingo'
 * const r = tryConvert(72, 'in', 'cm')
 * r.ok ? r.value : r.issues[0].code // 182.88
 * ```
 */
export const tryConvert = defaultLingo.tryConvert as TryConvertFn
/**
 * Difference (delta) conversion between two units by ref: factors only,
 * offsets ignored — a 5 °C *rise* is a 9 °F rise, not an absolute reading.
 * @example
 * ```ts
 * import { convertDelta } from '@pascal-app/lingo'
 * convertDelta(5, 'C', 'F') // 9
 * ```
 */
export const convertDelta = defaultLingo.convertDelta as ConvertFn

/**
 * Convert currency with caller-injected rates. Generic `convert()` still
 * rejects cross-currency conversion because FX rates are not static unit data.
 * @example
 * ```ts
 * import { convertCurrency } from '@pascal-app/lingo'
 * convertCurrency(100, 'USD', 'EUR', {
 *   rates: { base: 'USD', rates: { USD: 1, EUR: 0.92 } },
 * }) // 92
 * ```
 */
export function convertCurrency<const From extends string, const To extends string>(
  amount: number,
  from: From & ValidateCurrencyUnit<From>,
  to: To & ValidateCurrencyUnit<To>,
  opts: { rates: RateSnapshot | RateProvider },
): number
export function convertCurrency(
  amount: number,
  from: string,
  to: string,
  opts: { rates: RateSnapshot | RateProvider },
): number {
  assertFiniteNumber(amount, 'amount')
  const fromUnit = currencyUnit(defaultRegistry, from)
  const toUnit = currencyUnit(defaultRegistry, to)
  if (typeof opts.rates === 'function') {
    const rate = opts.rates(fromUnit.id, toUnit.id)
    if (!(rate > 0 && Number.isFinite(rate))) {
      throw new Error(
        `lingo: rate provider returned invalid rate for "${fromUnit.id}" to "${toUnit.id}"`,
      )
    }
    return amount * rate
  }
  const base = currencyUnit(defaultRegistry, opts.rates.base).id
  const fromRate = snapshotRate(opts.rates, fromUnit.id, base)
  const toRate = snapshotRate(opts.rates, toUnit.id, base)
  return amount * (toRate / fromRate)
}

/**
 * Rehydrate serialized values (the `toJSON()` shapes) against the default
 * registry.
 * @example
 * ```ts
 * import { quantity, fromJSON } from '@pascal-app/lingo'
 * const json = quantity(5, 'kg').toJSON()
 * fromJSON(json).value // 5
 * ```
 */
export function fromJSON(json: QuantityJSON): Quantity
export function fromJSON(json: QuantityRangeJSON): QuantityRange
export function fromJSON(json: QuantityJSON | QuantityRangeJSON): Quantity | QuantityRange {
  return json.type === 'quantity'
    ? Quantity.fromJSON(defaultRegistry, json)
    : QuantityRange.fromJSON(defaultRegistry, json)
}

// Result helpers are registry-free module functions; their docs live in result.ts.
export { candidateOf, firstError, isConversion, isNumber, isQuantity, isRange } from './result'
/**
 * Render an issue's message against a different `messages` pack than the one
 * it was created with.
 * @example
 * ```ts
 * import { lingo, formatIssue } from '@pascal-app/lingo'
 * const r = lingo('5 meterz', { kind: 'length' })
 * formatIssue(r.issues[0], { TYPO_CORRECTED: 'Fixed "{unit}" → {corrected}.' })
 * // 'Fixed "meterz" → m.'
 * ```
 */
export const formatIssue = defaultLingo.formatIssue

// ---------------------------------------------------------------------------
// Extension points (mutate the default registry; use createRegistry for isolation)

/**
 * Register a new measurement kind on the default registry (mutates the
 * shared instance — use `createRegistry`/`createLingo` for isolation).
 * Counterpart to `defineKind` from `./core`, which only declares a typed
 * `KindDef` without registering anything.
 * @example
 * ```ts
 * import { registerKind, quantity } from '@pascal-app/lingo'
 * registerKind({
 *   kind: 'widget', baseUnit: 'widget',
 *   units: [{ id: 'widget', symbol: 'widget', name: 'widget', factor: 1, system: 'shared' }],
 * })
 * quantity(5, 'widget', 'widget').value // 5
 * ```
 */
export function registerKind(def: KindDef): void {
  defaultRegistry.registerKind(def)
}

/**
 * Add units to an existing kind on the default registry.
 * @example
 * ```ts
 * import { registerUnits, convert } from '@pascal-app/lingo'
 * registerUnits('length', [
 *   { id: 'smoot', symbol: 'smoot', name: 'smoot', factor: 1.702, system: 'us', aliases: ['smoots'] },
 * ])
 * convert(1, 'smoot', 'm') // 1.702
 * ```
 */
export function registerUnits(kind: Kind, units: readonly UnitDef[]): void {
  defaultRegistry.registerUnits(kind, units)
}

/**
 * Attach a fuzzy vocabulary ("hot", "a few") to a kind on the default
 * registry.
 * @example
 * ```ts
 * import { defineFuzzyVocab, lingo } from '@pascal-app/lingo'
 * defineFuzzyVocab('mass', { profile: 'parcels', unit: 'kg',
 *   terms: { light: [0, 5], heavy: [20, 70] } })
 * lingo('heavy', { kind: 'mass', profile: 'parcels' }) // 20–70 kg range
 * ```
 */
export function defineFuzzyVocab(kind: Kind, vocab: FuzzyVocab): void {
  defaultRegistry.defineFuzzyVocab(kind, vocab)
}

// ---------------------------------------------------------------------------
// Re-exports

export type { QuantityJSON, QuantityPart, QuantityRangeJSON } from './core/quantity'
export type { FuzzyVocab } from './core/registry'
export type {
  IssueCode,
  IssueDataMap,
  IssueInputData,
  Kind,
  KindDef,
  LingoIssue,
  Messages,
  NumberFormatPolicy,
  Severity,
  Span,
  UnitDef,
  UnitSystem,
} from './core/types'
export type {
  AliasByKind,
  BuiltinKind,
  BuiltinUnitRef,
  CanonicalUnitId,
  KindOfUnit,
  UnitIdByKind,
  UnitRefByKind,
} from './core/unit-refs'
export type { ToBestOptions } from './format/best'
export type { FormatOptions, RangeFormatOptions } from './format/format'
export { describeTemperature, temperatureVocabs } from './fuzzy/temperature'
export type { LanguageProfile, LocalePack } from './locale'
export type {
  Alternative,
  ConversionResult,
  FailResult,
  LingoResult,
  NumberResult,
  PartialState,
  QuantityResult,
  RangeResult,
} from './parse/grammar'
export type {
  SerializedAlternative,
  SerializedBound,
  SerializedConversion,
  SerializedConversionSource,
  SerializedConverted,
  SerializedFailure,
  SerializedIssue,
  SerializedNumber,
  SerializedQuantity,
  SerializedRange,
  SerializedResult,
  SerializedSpan,
} from './parse/serialize'
export { allKinds } from './units/index'
export { createRegistry, Quantity, QuantityRange, Registry }
