import { hasError, makeIssue } from '../core/errors'
import type { Quantity, QuantityRange } from '../core/quantity'
import type { Registry } from '../core/registry'
import type {
  IssueCode,
  IssueInputData,
  Kind,
  LingoIssue,
  Messages,
  NumberFormatPolicy,
  Severity,
  Span,
  UnitSystem,
} from '../core/types'
import { detectLanguageProfile } from '../locale/detect'
import {
  englishLanguageProfile,
  hasNonEnglishLocalePacks,
  isLocaleLoaded,
  resolveLanguageProfile,
} from '../locale/profile'
import type { LanguageProfile, LocalePack } from '../locale/types'
import { parseValue, type ValueCtx } from '../number/value'
import { type Normalized, normalizeInput, toSourceSpan } from './normalize'
import type { SerializedResult } from './serialize'
import { splitGluedWords, type Token, tokenize } from './tokenize'

/**
 * Options shared by `lingo()`/`parseQuantity()`/`parseRange()`/`partialState()`
 * /`findQuantities()`. Re-exported as `LingoOptions` from the main entry
 * (minus the internal `aliasFallbacks`/`extract` fields; `registry` becomes
 * optional).
 * @example
 * ```ts
 * import { parseQuantity } from '@pascal-app/lingo'
 * const r = parseQuantity('72', { kind: 'length', unit: 'cm' })
 * r.ok && r.quantity.base // 0.72 (meters)
 * ```
 */
export interface ParseOptions {
  accept?: {
    ranges?: boolean
    conversions?: boolean
    compounds?: boolean
    fuzzy?: boolean
    numberWords?: boolean
    approximations?: boolean
    bareNumbers?: boolean
  }
  /**
   * Fallback unit readings for alias misses, applied with an AMBIGUOUS_UNIT
   * warning ("kb" → kilobytes-not-kilobits). Wired by the main entry.
   */
  aliasFallbacks?: Record<string, { kind: Kind; unit: string; alt: string }>
  /**
   * Preferred ISO currency code for ambiguous bare currency symbols. For
   * example, `$5` defaults to USD with `AMBIGUOUS_UNIT`, while
   * `{ currency: 'CAD' }` reads it as CAD without that warning.
   */
  currency?: string
  escalate?: Partial<Record<IssueCode, Severity>>
  /**
   * Extraction mode: trailing unparsed content ends the match instead of
   * failing it (powers findQuantities / free-text scanning).
   */
  extract?: boolean
  /** Expected kind — biases unit resolution and enables kind validation. */
  kind?: Kind
  /** BCP-47 locale id used to select a loaded language profile. */
  locale?: string
  /** Loaded locale packs for this parser instance. Wired by createLingo(). */
  localePacks?: readonly LocalePack[]
  messages?: Messages
  numberFormat?: NumberFormatPolicy
  /** Fuzzy profile name to prefer ('weather', 'water', 'oven'). */
  profile?: string
  registry?: Registry
  strictness?: 'forgiving' | 'confirm' | 'strict'
  /** Disambiguates gal/ton/cup families and best-fit. Default 'us'. */
  system?: Exclude<UnitSystem, 'shared'>
  tolerance?: {
    typos?: 'fix' | 'suggest' | 'off'
    ambiguity?: 'assume' | 'confirm'
  }
  /**
   * Implied unit for BARE NUMBERS only ("72" in a centimeters field reads as
   * 72 cm) — it does NOT coerce an already-unit-typed value ("72 in" stays
   * inches; `unit` is ignored). To convert a parsed value, use
   * `result.quantity.to(unit)`.
   * @example
   * ```ts
   * import { parseQuantity } from '@pascal-app/lingo'
   * const bare = parseQuantity('72', { kind: 'length', unit: 'cm' })
   * bare.ok && bare.quantity.unit // 'cm' (bare number)
   * const typed = parseQuantity('72 in', { kind: 'length', unit: 'cm' })
   * typed.ok && typed.quantity.unit // 'in' (already typed — unit ignored)
   * ```
   */
  unit?: string
}

/**
 * A secondary reading attached to `QuantityResult.alternatives` — e.g. the
 * other side of an `AMBIGUOUS_NUMBER` split ("1,234" could be 1234 or 1.234).
 * @example
 * ```ts
 * import { lingo } from '@pascal-app/lingo'
 * const r = lingo('1,234 kg')
 * if (r.ok && r.type === 'quantity') {
 *   r.alternatives?.[0]
 *   // { type: 'quantity', quantity: 1.234 kg (as a Quantity), confidence: 0.4, reason: 'AMBIGUOUS_NUMBER' }
 * }
 * ```
 */
export interface QuantityAlternative {
  confidence: number
  quantity: Quantity
  reason: string
  type: 'quantity'
}

export type Alternative = QuantityAlternative

interface OkBase {
  confidence: number
  issues: LingoIssue[]
  /** Resolved language profile locale for this successful parse. */
  locale?: string
  ok: true
  /** Parse-result wire schema version; serialized `lingo()` results are self-identifying. */
  schemaVersion: 3
  /**
   * The `[start, end)` slice of `text` that lingo recognized as this value —
   * `text.slice(span.start, span.end)` is the matched portion. It can be a
   * sub-span when the input has surrounding words ("about 5 kg please").
   */
  span: Span
  /** The full original input string that was parsed. */
  text: string
  /** Flat v3 wire JSON (see serialize.ts). Attached at the parse boundary. */
  toJSON?(): SerializedResult
}

/**
 * A single measured value — `lingo()`'s result when the input is one
 * quantity ("5 kg", "5'11\"").
 * @example
 * ```ts
 * import { lingo } from '@pascal-app/lingo'
 * const r = lingo('5 kg')
 * r.ok && r.type === 'quantity' && r.quantity.value // 5
 * ```
 */
export interface QuantityResult extends OkBase {
  alternatives?: Alternative[]
  quantity: Quantity
  type: 'quantity'
}
/**
 * A bounded/plus-minus/fuzzy range — `lingo()`'s result for "5-10 kg",
 * "10 ± 0.5 mm", "a few minutes".
 * @example
 * ```ts
 * import { lingo } from '@pascal-app/lingo'
 * const r = lingo('5-10 kg')
 * r.ok && r.type === 'range' && r.range.min()?.value // 5
 * ```
 */
export interface RangeResult extends OkBase {
  range: QuantityRange
  type: 'range'
}
/**
 * A conversion request — `lingo()`'s result for "72 in to cm": `source` as
 * typed, `converted` in `targetUnit`.
 * @example
 * ```ts
 * import { lingo } from '@pascal-app/lingo'
 * const r = lingo('72 in to cm')
 * r.ok && r.type === 'conversion' && r.targetUnit // 'cm'
 * ```
 */
export interface ConversionResult extends OkBase {
  converted: Quantity | QuantityRange
  source: Quantity | QuantityRange
  targetUnit: string
  type: 'conversion'
}
/**
 * A bare number with no unit — `lingo()`'s result for "72" when no
 * `kind`/`unit` option implies one.
 * @example
 * ```ts
 * import { lingo } from '@pascal-app/lingo'
 * const r = lingo('72')
 * r.ok && r.type === 'number' && r.value // 72
 * ```
 */
export interface NumberResult extends OkBase {
  approximate?: boolean
  type: 'number'
  value: number
}
/**
 * `ok: false` — at least one `severity: 'error'` issue. Under `strictness:
 * 'confirm'`/`'strict'`, `candidate` carries the would-have-been result (e.g.
 * a typo-corrected reading) for confirmation UX.
 * @example
 * ```ts
 * import { lingo } from '@pascal-app/lingo'
 * const r = lingo('5 meterz', { kind: 'length', strictness: 'confirm' })
 * if (!r.ok && r.candidate?.type === 'quantity') {
 *   r.candidate.quantity.format() // "5 m"
 * }
 * ```
 */
export interface FailResult {
  candidate?: Exclude<LingoResult, FailResult>
  issues: LingoIssue[]
  ok: false
  /** Parse-result wire schema version; serialized failures are self-identifying. */
  schemaVersion: 3
  text: string
  /** Flat v3 wire JSON (see serialize.ts). Attached at the parse boundary. */
  toJSON?(): SerializedResult
  type: 'failure'
}

/**
 * `lingo()`'s discriminated union — switch on `.type` (or check `.ok` first
 * for the failure case).
 * @example
 * ```ts
 * import { lingo } from '@pascal-app/lingo'
 * const r = lingo('72 in to cm')
 * if (r.ok) {
 *   if (r.type === 'conversion' && 'base' in r.converted) r.converted.value // 182.88
 * } else {
 *   r.issues[0].message
 * }
 * ```
 */
export type LingoResult =
  | QuantityResult
  | RangeResult
  | ConversionResult
  | NumberResult
  | FailResult

export interface Parsed {
  nextToken: number
  result: LingoResult
}

export interface ParserState {
  config: ParserConfig
  issues: LingoIssue[]
  lower: string
  n: Normalized
  opts: ParseOptions
  profile: LanguageProfile
  reg: Registry
  src: string
  text: string
  tokens: Token[]
}

export interface ParserConfig {
  approximations: boolean
  bareNumbers: boolean
  compounds: boolean
  conversions: boolean
  escalate?: Partial<Record<IssueCode, Severity>>
  fuzzy: boolean
  numberWords: boolean
  ranges: boolean
  typos: 'fix' | 'suggest' | 'off'
}

const PENALTY: Partial<Record<IssueCode, number>> = {
  TYPO_CORRECTED: 0.15,
  AMBIGUOUS_NUMBER: 0.2,
  AMBIGUOUS_UNIT: 0.1,
  UNIT_ASSUMED: 0.25,
  SLANG_UNIT: 0.2,
}

const ASSUMPTION_CODES =
  'TYPO_CORRECTED AMBIGUOUS_NUMBER AMBIGUOUS_UNIT AMBIGUOUS_DATE UNIT_ASSUMED SLANG_UNIT RANGE_REVERSED COMPOUND_OVERFLOW'.split(
    ' ',
  ) as IssueCode[]

export function resolveConfig(opts: ParseOptions): ParserConfig {
  const strict = opts.strictness ?? 'forgiving'
  const accept = opts.accept
  const tolerance = opts.tolerance
  const typos = tolerance?.typos ?? (strict === 'strict' ? 'off' : 'fix')
  const ambiguity = tolerance?.ambiguity ?? (strict === 'forgiving' ? 'assume' : 'confirm')
  let escalate = opts.escalate
  if (ambiguity === 'confirm') {
    const explicit = escalate
    escalate = {}
    for (const code of ASSUMPTION_CODES) {
      escalate[code] = 'error'
    }
    Object.assign(escalate, explicit)
  }
  return {
    ranges: accept?.ranges ?? true,
    conversions: accept?.conversions ?? true,
    compounds: accept?.compounds ?? true,
    fuzzy: accept?.fuzzy ?? true,
    numberWords: accept?.numberWords ?? strict !== 'strict',
    approximations: accept?.approximations ?? strict !== 'strict',
    bareNumbers: accept?.bareNumbers ?? strict !== 'strict',
    typos,
    escalate,
  }
}

const gluedVocabularyCache = new WeakMap<LanguageProfile, readonly string[]>()

/**
 * Grammar words a space-free script can glue onto its neighbours. Only
 * non-Latin entries qualify: in a spaced language the space already marks the
 * boundary, and cutting inside a Latin word would invent tokens that were never
 * written. Sorted longest-first so `不超过` wins over the `超过` inside it.
 */
function gluedWordVocabulary(profile: LanguageProfile): readonly string[] {
  const cached = gluedVocabularyCache.get(profile)
  if (cached) {
    return cached
  }
  const g = profile.grammar
  const vocabulary = [
    ...g.boundPhrases.map((entry) => entry.phrase),
    ...g.rangeSeparatorWords,
    ...g.rangeAndWords,
    ...g.rangeAlternativeWords,
    ...g.rangeBetweenWords,
    ...g.rangeFromWords,
    ...g.conversionWords,
    ...g.approximateWords,
    ...g.approximatePhrases,
    ...g.trailingApproxWords,
    ...g.trailingApproxPhrases,
  ]
    .filter((word) => word.length > 0 && !/[a-z]/i.test(word))
    .sort((a, b) => b.length - a.length)
  const unique = [...new Set(vocabulary)]
  gluedVocabularyCache.set(profile, unique)
  return unique
}

export function prepare(input: string, opts: ParseOptions): ParserState {
  if (!opts.registry) {
    throw new Error(
      "lingo: parseExpression() needs options.registry — build one with createRegistry() (from '@pascal-app/lingo/core'), import defaultRegistry from '@pascal-app/lingo', or use the main entry's lingo()/parseQuantity(), which bind it for you.",
    )
  }
  const n = normalizeInput(input)
  const text = n.text
  const lower = text.toLowerCase()
  const tokens = tokenize(n)
  const localePacks = opts.localePacks
  const localeNotLoaded =
    opts.locale && !isLocaleLoaded(localePacks, opts.locale)
      ? makeIssue('LOCALE_NOT_LOADED', { locale: opts.locale }, undefined, opts.messages)
      : undefined
  const profile = opts.locale
    ? resolveLanguageProfile(localePacks, opts.locale)
    : hasNonEnglishLocalePacks(localePacks)
      ? // Detection reuses this pass instead of re-normalizing per loaded pack.
        detectLanguageProfile(localePacks!, input, { lower, raw: input, tokens })
      : englishLanguageProfile
  return {
    src: input,
    n,
    text,
    lower,
    tokens: splitGluedWords(
      tokens,
      gluedWordVocabulary(profile),
      (at) => opts.registry!.matchUnitsAt(text, lower, at, opts.kind)[0]?.length ?? 0,
    ),
    reg: opts.registry,
    opts,
    profile,
    config: resolveConfig(opts),
    issues: localeNotLoaded ? [localeNotLoaded] : [],
  }
}

export function issue<C extends IssueCode>(
  p: ParserState,
  code: C,
  data: IssueInputData<C>,
  normStart: number,
  normEnd: number,
): LingoIssue<C> {
  const it = makeIssue(code, data, toSourceSpan(p.n, normStart, normEnd), p.opts.messages)
  p.issues.push(it)
  return it
}

export const wordAt = (p: ParserState, i: number): string | null => {
  const t = p.tokens[i]
  return t && t.type === 'word' ? t.text.toLowerCase() : null
}

export const symAt = (p: ParserState, i: number): string | null => {
  const t = p.tokens[i]
  return t && t.type === 'sym' ? t.text : null
}

/** Consume a (possibly multi-word) phrase; returns next index or -1. */
export function eatPhrase(p: ParserState, i: number, phrase: string): number {
  const words = phrase.split(' ')
  let pos = i
  for (const w of words) {
    if (wordAt(p, pos) !== w) {
      return -1
    }
    pos++
  }
  return pos
}

/** Try each phrase in order; return next token index after first match, or -1. */
export function eatAnyPhrase(p: ParserState, pos: number, phrases: Iterable<string>): number {
  for (const phrase of phrases) {
    const nx = eatPhrase(p, pos, phrase)
    if (nx >= 0) {
      return nx
    }
  }
  return -1
}

/** First token index whose start ≥ normalized position `pos`. Binary search. */
export function tokenAfter(p: ParserState, pos: number): number {
  let lo = 0
  let hi = p.tokens.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (p.tokens[mid]!.start < pos) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  return lo
}

/**
 * The one place a `ValueCtx` is assembled from parser state — call sites only
 * choose the `kind` fallback (`expectKind ?? p.opts.kind`, `a.kind ?? …`).
 */
export function valueCtx(
  p: ParserState,
  kind: Kind | undefined = p.opts.kind,
  noAnd = false,
): ValueCtx {
  return {
    tokens: p.tokens,
    n: p.n,
    src: p.src,
    numberFormat: p.opts.numberFormat ?? p.profile.defaults.numberFormat ?? 'auto',
    kind,
    numberWords: p.config.numberWords,
    profile: p.profile,
    noAnd,
  }
}

export function valueStarts(p: ParserState, i: number): boolean {
  const t = p.tokens[i]
  if (!t) {
    return false
  }
  if (t.type === 'digits' || t.type === 'vulgar') {
    return true
  }
  if (t.type === 'sym' && (t.text === '-' || t.text === '+' || t.text === '.')) {
    return true
  }
  if (t.type === 'word') {
    return parseValue(valueCtx(p), i) !== null
  }
  return false
}

export function withMessages(p: ParserState, it: LingoIssue): LingoIssue {
  // Value-layer issues were built without the messages option; rebuild copy.
  if (!p.opts.messages) {
    return it
  }
  return makeIssue(
    it.code,
    { ...(it.data ?? {}), suggestions: it.suggestions } as IssueInputData,
    it.span,
    p.opts.messages,
  )
}

export function applySeverity(p: ParserState, issues: readonly LingoIssue[]): LingoIssue[] {
  if (!p.config.escalate) {
    return issues as LingoIssue[]
  }
  return issues.map((it) => {
    const severity = p.config.escalate![it.code]
    return severity && severity !== it.severity ? { ...it, severity } : it
  })
}

function withResultIssues<T extends Exclude<LingoResult, FailResult>>(
  result: T,
  issues: LingoIssue[],
): T {
  return { ...result, issues } as T
}

export function fail(
  p: ParserState,
  candidate?: Exclude<LingoResult, FailResult>,
  issues: LingoIssue[] = p.issues,
): LingoResult {
  const finalIssues = applySeverity(p, issues)
  // An escalate map may downgrade every error — then this "fail" returns the
  // candidate as the success result.
  if (candidate && !hasError(finalIssues)) {
    return withResultIssues({ ...candidate, locale: p.profile.locale }, finalIssues)
  }
  return candidate
    ? { ok: false, schemaVersion: 3, type: 'failure', text: p.src, issues: finalIssues, candidate }
    : { ok: false, schemaVersion: 3, type: 'failure', text: p.src, issues: finalIssues }
}

export function exampleFor(p: ParserState): string {
  // Prefer the field's own unit — a meters field should suggest "5 m".
  if (p.opts.unit) {
    const kind = p.opts.kind
    const u = kind ? p.reg.unitByRef(kind, p.opts.unit) : p.reg.findUnitByRef(p.opts.unit)?.unit
    if (u) {
      return `"5 ${u.symbol}"`
    }
  }
  const kind = p.opts.kind
  if (!kind) {
    return '"5 kg" or "2 ft"'
  }
  const units = p.reg.unitsOf(kind).filter((u) => u.best !== undefined)
  const u = units[Math.floor(units.length / 2)] ?? p.reg.unitsOf(kind)[0]
  return u ? `"5 ${u.symbol}"` : '"5"'
}

export function confidence(p: ParserState, approximate: boolean | undefined): number {
  return confidenceForIssues(p.issues, approximate)
}

export function confidenceForIssues(
  issues: readonly LingoIssue[],
  approximate: boolean | undefined,
): number {
  let c = 1
  for (const it of issues) {
    const pen = PENALTY[it.code]
    if (pen) {
      c -= pen
    }
  }
  if (approximate) {
    c -= 0.1
  }
  return Math.max(0.05, Math.round(c * 100) / 100)
}
