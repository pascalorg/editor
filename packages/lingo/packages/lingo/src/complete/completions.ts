import type { AliasCompletion, Registry, UnitMatch } from '../core/registry'
import type { Kind } from '../core/types'
import type { LingoOptions } from '../factory'
import {
  type ConversionResult,
  type LingoResult,
  type ParseOptions,
  prepare,
  type QuantityResult,
  type RangeResult,
} from '../parse/config'
import { parsePreparedExpression, partialQuantityState } from '../parse/finish'
import { attachSerialization } from '../parse/serialize'
import type { Token } from '../parse/tokenize'
import {
  detectRangeTail,
  inferKindFromRangeLeft,
  rangeRewriteWithUnit,
  resolveSuggestedUnits,
  SUGGEST_UNITS_BY_KIND,
} from './suggest-units'
import type {
  Completion,
  CompletionDateParser,
  CompletionDateResult,
  CompletionResult,
  CompletionSource,
} from './types'

export type {
  Completion,
  CompletionDateParser,
  CompletionDateResult,
  CompletionResult,
  CompletionSource,
} from './types'

export interface CompletionsOptions extends LingoOptions {
  /**
   * Inject `parseDate` / `parseDateRange` / `parseDuration` from
   * `@pascal-app/lingo/date` to add date completions without bundling the date
   * engine into `@pascal-app/lingo/complete`.
   */
  date?: CompletionDateParser
  /** Max implied / range-implied suggestions (default 8). */
  impliedLimit?: number
  limit?: number
  /**
   * Unit refs to fan out for bare numbers and range tails — overrides kind
   * defaults. Enables optimistic suggestions without `kind`.
   * @example completions('10', { units: ['kg', 'lb', 'm', 'ft'] })
   */
  units?: readonly string[]
}

const DEFAULT_LIMIT = 10
const PREFIX_CANDIDATE_LIMIT = 40

interface Draft {
  confidence: number
  result: CompletionResult
  source: CompletionSource
}

type CoreCompletionResult = QuantityResult | RangeResult | ConversionResult

function isCompletionResult(r: LingoResult): r is CoreCompletionResult {
  return r.ok && (r.type === 'quantity' || r.type === 'range' || r.type === 'conversion')
}

function isDateCompletionResult(r: ReturnType<CompletionDateParser>): r is CompletionDateResult {
  return r.ok
}

function completionText(result: CompletionResult): string {
  if (result.type === 'quantity') {
    return result.quantity.format()
  }
  if (result.type === 'range') {
    return result.range.format()
  }
  if (result.type === 'date') {
    return formatDate(result)
  }
  if (result.type === 'date-range') {
    return formatDateRange(result)
  }
  if (result.type === 'duration') {
    return result.text
  }
  return result.converted.format()
}

function localIso(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString()
}

function formatDate(result: CompletionDateResult & { type: 'date' }): string {
  const iso = localIso(result.date)
  return iso.slice(
    0,
    result.grain === 'second' ? 19 : result.grain === 'minute' || result.grain === 'hour' ? 16 : 10,
  )
}

/**
 * Anchored whole-day ranges get the same "N days starting YYYY-MM-DD" form
 * `humanizeDateRange()` emits (re-parses via `parseDateRange`); everything
 * else falls back to the input text.
 */
function formatDateRange(result: CompletionDateResult & { type: 'date-range' }): string {
  if (result.anchored && result.start && result.end) {
    const start = localIso(result.start.date)
    const days = (Date.parse(localIso(result.end.date)) - Date.parse(start)) / 86_400_000
    if (start.includes('T00:00:00') && Number.isInteger(days) && days > 0) {
      return `${days} day${days === 1 ? '' : 's'} starting ${start.slice(0, 10)}`
    }
  }
  return result.text
}

function parseRewritten(text: string, options: ParseOptions): CompletionResult | null {
  const prepared = prepare(text, options)
  const result = attachSerialization(parsePreparedExpression(prepared))
  return isCompletionResult(result) ? result : null
}

function rewriteUnitToken(text: string, unitToken: Token, alias: string): string {
  return `${text.slice(0, unitToken.start)}${alias}`
}

function addDraft(
  drafts: Draft[],
  result: CompletionResult | null,
  source: CompletionSource,
  confidence: number,
): void {
  if (!result) {
    return
  }
  drafts.push({ result, source, confidence })
}

function hasKindMismatch(result: LingoResult): boolean {
  return (
    !result.ok &&
    result.issues.some((it) => it.code === 'KIND_MISMATCH' || it.code === 'RANGE_KIND_MISMATCH')
  )
}

function collectCrossKind(
  drafts: Draft[],
  primary: LingoResult,
  input: string,
  options: ParseOptions,
): void {
  if (!(options.kind && hasKindMismatch(primary))) {
    return
  }
  const kindFreeOptions: ParseOptions = { ...options, kind: undefined }
  addDraft(drafts, parseRewritten(input, kindFreeOptions), 'cross-kind', 0.42)
}

function collectDate(drafts: Draft[], input: string, date: CompletionDateParser | undefined): void {
  if (!date) {
    return
  }
  const result = date(input)
  if (isDateCompletionResult(result)) {
    addDraft(drafts, result, 'date', result.confidence)
  }
}

function collectUnitAmbiguity(
  drafts: Draft[],
  primary: CompletionResult,
  options: ParseOptions,
  tokens: Token[],
  text: string,
  lower: string,
  reg: Registry,
  kind?: Kind,
): void {
  const ambiguous = primary.issues.some((it) => it.code === 'AMBIGUOUS_UNIT')
  if (!ambiguous) {
    return
  }
  const unitIndex = findTrailingUnitToken(tokens)
  if (unitIndex < 0) {
    return
  }
  const pos = tokens[unitIndex]!.start
  const matches = reg.matchUnitsAt(text, lower, pos, kind)
  fanOutMatches(drafts, matches, text, tokens[unitIndex]!, options, 'unit-ambiguity', 0.75)
}

function findTrailingUnitToken(tokens: Token[]): number {
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i]!
    if (t.type === 'word' || t.type === 'sym') {
      return i
    }
  }
  return -1
}

function fanOutMatches(
  drafts: Draft[],
  matches: UnitMatch[],
  text: string,
  unitToken: Token,
  options: ParseOptions,
  source: CompletionSource,
  baseConfidence: number,
): void {
  let rank = 0
  for (const match of matches) {
    const rewritten = rewriteUnitToken(text, unitToken, displayAlias(match))
    const parsed = parseRewritten(rewritten, options)
    const confidence = Math.max(0.05, baseConfidence - rank * 0.04)
    addDraft(drafts, parsed, source, confidence)
    rank++
  }
}

function displayAlias(match: UnitMatch): string {
  return match.unit.symbol.includes(match.alias) ? match.unit.symbol : match.alias
}

function hasExtendableUnitPrefix(reg: Registry, tokens: Token[], kind?: Kind): boolean {
  const last = tokens[tokens.length - 1]
  if (last?.type !== 'word') {
    return false
  }
  return reg.hasAliasPrefix(last.text, kind)
}

function everydayTier(hit: AliasCompletion): number {
  const ids = SUGGEST_UNITS_BY_KIND[hit.kind]
  return ids ? (ids.includes(hit.unit.id) || ids.includes(hit.unit.symbol) ? 0 : 1) : 2
}

function collectPrefixCompletions(
  drafts: Draft[],
  options: ParseOptions,
  tokens: Token[],
  text: string,
  reg: Registry,
  kind?: Kind,
): void {
  const last = tokens[tokens.length - 1]
  if (last?.type !== 'word') {
    return
  }
  const prefix = last.text
  const aliases = reg
    .aliasCompletions(prefix, kind, PREFIX_CANDIDATE_LIMIT)
    .sort((a, b) => everydayTier(a) - everydayTier(b))
    .slice(0, DEFAULT_LIMIT)
  let rank = 0
  for (const hit of aliases) {
    const rewritten = rewriteUnitToken(text, last, hit.alias)
    const parsed = parseRewritten(rewritten, options)
    const confidence = Math.max(0.05, 0.55 - rank * 0.03)
    addDraft(drafts, parsed, 'unit-prefix', confidence)
    rank++
  }
}

function collectBareNumberImplied(
  drafts: Draft[],
  options: ParseOptions,
  tokens: Token[],
  text: string,
  reg: Registry,
  opts: CompletionsOptions,
): void {
  if (tokens.length !== 1 || tokens[0]!.type !== 'digits') {
    return
  }
  const suggestions = resolveSuggestedUnits(reg, opts)
  if (!suggestions.length) {
    return
  }
  let rank = 0
  for (const { alias } of suggestions) {
    const rewritten = `${text} ${alias}`
    const parsed = parseRewritten(rewritten, options)
    const confidence = Math.max(0.05, 0.48 - rank * 0.03)
    addDraft(drafts, parsed, 'implied-unit', confidence)
    rank++
  }
}

function collectRangeImplied(
  drafts: Draft[],
  options: ParseOptions,
  tokens: Token[],
  text: string,
  lower: string,
  reg: Registry,
  opts: CompletionsOptions,
  tail: NonNullable<ReturnType<typeof detectRangeTail>>,
): void {
  const inferred = inferKindFromRangeLeft(reg, tokens, text, lower, tail.sepIndex)
  const suggestions = resolveSuggestedUnits(reg, opts, inferred)
  if (!suggestions.length) {
    return
  }
  const parseOpts: ParseOptions =
    inferred && inferred !== opts.kind ? { ...options, kind: inferred } : options
  let rank = 0
  for (const { alias } of suggestions) {
    const rewritten = rangeRewriteWithUnit(tokens, text, tail, alias)
    const parsed = parseRewritten(rewritten, parseOpts)
    const confidence = Math.max(0.05, 0.46 - rank * 0.03)
    addDraft(drafts, parsed, 'range-implied', confidence)
    rank++
  }
}

function finalize(drafts: Draft[], limit: number): Completion[] {
  const byText = new Map<string, Completion>()
  for (const draft of drafts) {
    const text = completionText(draft.result)
    const existing = byText.get(text)
    const next: Completion = {
      text,
      result: draft.result,
      confidence: draft.confidence,
      source: draft.source,
    }
    if (!existing || next.confidence > existing.confidence) {
      byText.set(text, next)
    }
  }
  return [...byText.values()]
    .sort((a, b) => b.confidence - a.confidence || a.text.localeCompare(b.text))
    .slice(0, limit)
}

/**
 * All plausible ranked interpretations of `input` — like search autocomplete
 * over canonical quantity readings. Partial prefixes ("2 f") fan out to "2 ft",
 * "2 °F", …; ambiguous units and number splits surface as separate items.
 * @example
 * ```ts
 * import { completions } from '@pascal-app/lingo/complete'
 * completions('2 f').map((c) => c.text)
 * // ['2 ft', '2 °F', '2 fl oz', …]
 * ```
 */
export function completions(input: string, opts?: CompletionsOptions): Completion[] {
  const limit = opts?.limit ?? DEFAULT_LIMIT
  if (input.trim() === '') {
    return []
  }

  const parseOptions: ParseOptions = {
    strictness: 'forgiving',
    tolerance: { typos: 'fix', ambiguity: 'assume' },
    ...opts,
    registry: opts?.registry,
  }
  if (!parseOptions.registry) {
    throw new Error(
      "lingo: completions() needs options.registry — import from '@pascal-app/lingo/complete' (binds defaultRegistry) or pass { registry }.",
    )
  }

  const reg = parseOptions.registry
  const prepared = prepare(input, parseOptions)
  const primary = attachSerialization(parsePreparedExpression(prepared))
  const drafts: Draft[] = []

  if (isCompletionResult(primary)) {
    addDraft(drafts, primary, 'parse', primary.confidence)
    if (primary.type === 'quantity' && primary.alternatives) {
      for (const alt of primary.alternatives) {
        const altResult: QuantityResult = {
          ...primary,
          quantity: alt.quantity,
          confidence: alt.confidence,
          alternatives: undefined,
        }
        addDraft(drafts, altResult, 'alternative', alt.confidence)
      }
    }
    collectUnitAmbiguity(
      drafts,
      primary,
      parseOptions,
      prepared.tokens,
      prepared.text,
      prepared.lower,
      reg,
      opts?.kind,
    )
  } else {
    collectCrossKind(drafts, primary, input, parseOptions)
  }

  collectDate(drafts, input, opts?.date)

  const tail = detectRangeTail(prepared.tokens, prepared.text)
  const rangeKind = tail
    ? inferKindFromRangeLeft(reg, prepared.tokens, prepared.text, prepared.lower, tail.sepIndex)
    : undefined
  const prefixKind = rangeKind ?? opts?.kind

  const partial = partialQuantityState(input, parseOptions)
  if (partial === 'incomplete' || hasExtendableUnitPrefix(reg, prepared.tokens, prefixKind)) {
    collectPrefixCompletions(drafts, parseOptions, prepared.tokens, prepared.text, reg, prefixKind)
  }

  if (opts?.kind || opts?.units?.length) {
    collectBareNumberImplied(drafts, parseOptions, prepared.tokens, prepared.text, reg, opts ?? {})
  }

  if (tail && (opts?.kind || opts?.units?.length || rangeKind)) {
    collectRangeImplied(
      drafts,
      parseOptions,
      prepared.tokens,
      prepared.text,
      prepared.lower,
      reg,
      opts ?? {},
      tail,
    )
  }

  return finalize(drafts, limit)
}
