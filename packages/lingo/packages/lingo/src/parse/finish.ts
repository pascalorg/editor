import { toBase } from '../core/convert'
import { hasError, makeIssue } from '../core/errors'
import { Quantity, QuantityRange } from '../core/quantity'
import {
  applySeverity,
  confidenceForIssues,
  eatAnyPhrase,
  eatPhrase,
  exampleFor,
  type FailResult,
  fail,
  issue,
  type LingoResult,
  type Parsed,
  type ParseOptions,
  type ParserState,
  prepare,
  type QuantityResult,
  type RangeResult,
  symAt,
  wordAt,
} from './config'
import { tryConversion } from './conversion'
import { toSourceSpan } from './normalize'
import { parseRangeOrQty } from './range'
import type { Token } from './tokenize'
import { suggestUnits, topTypo } from './unit-match'

/**
 * The engine behind `lingo()`: parse a quantity, range, conversion, or bare
 * number. Prefer the main entry's `lingo()`/`createLingo().parse()`, which
 * bind the default registry and messages for you.
 * @example
 * ```ts
 * import { parseExpression } from '@pascal-app/lingo/core'
 * import { defaultRegistry } from '@pascal-app/lingo'
 * parseExpression('5 kg', { registry: defaultRegistry }).ok // true
 * ```
 */
export function parseExpression(input: string, options: ParseOptions): LingoResult {
  const p = prepare(input, options)
  const result = parsePreparedExpression(p)
  if (!(result.ok || options.locale) && p.profile.locale !== 'en') {
    const english = parseExpression(input, { ...options, locale: 'en' })
    if (english.ok) {
      return english
    }
  }
  return result
}

export function parsePreparedExpression(p: ParserState, startToken = 0): LingoResult {
  if (p.tokens.length === 0) {
    issue(p, 'EMPTY', {}, 0, p.text.length)
    return fail(p)
  }
  const start = p.tokens[startToken]?.start ?? 0
  const parsed = parseRangeOrQty(p, startToken, true)
  if (!parsed) {
    const gated = startToken === 0 ? disabledInterpretation(p) : null
    if (gated) {
      return gated
    }
    const fuzzy = p.config.fuzzy ? tryFuzzy(p, startToken) : null
    if (fuzzy) {
      return finish(p, finishTrailing(p, fuzzy))
    }
    const ex = exampleFor(p)
    issue(p, 'NO_VALUE', { example: ex }, start, p.text.length)
    return fail(p)
  }
  // Conversion request?
  const conv = tryConversion(p, parsed, start)
  return finish(p, finishTrailing(p, conv ?? parsed))
}

function finish(p: ParserState, r: LingoResult): LingoResult {
  if (!r.ok) {
    return r
  }
  const issues = applySeverity(p, r.issues)
  if (r.type === 'range' && p.opts.kind && r.range.kind !== p.opts.kind) {
    const it = makeIssue(
      'KIND_MISMATCH',
      { found: r.range.kind, expected: p.opts.kind, example: exampleFor(p) },
      r.span,
      p.opts.messages,
    )
    return fail(p, r, [...issues, it])
  }
  if (
    !p.config.ranges &&
    (r.type === 'range' || (r.type === 'conversion' && r.source instanceof QuantityRange))
  ) {
    const it = makeIssue('SINGLE_VALUE_EXPECTED', {}, r.span, p.opts.messages)
    return fail(p, r, [...issues, it])
  }
  if (!p.config.conversions && r.type === 'conversion') {
    const it = makeIssue('CONVERSION_NOT_ALLOWED', {}, r.span, p.opts.messages)
    return fail(p, r, [...issues, it])
  }
  if (!p.config.approximations && approximateResult(r)) {
    const it = makeIssue('APPROX_NOT_ALLOWED', {}, r.span, p.opts.messages)
    return fail(p, r, [...issues, it])
  }
  return hasError(issues) ? fail(p, r, issues) : { ...r, issues, locale: p.profile.locale }
}

function approximateResult(r: Exclude<LingoResult, FailResult>): boolean {
  if (r.type === 'quantity') {
    return r.quantity.approximate
  }
  if (r.type === 'range') {
    return r.range.approximate
  }
  if (r.type === 'conversion') {
    return r.converted.approximate
  }
  return r.approximate ?? false
}

function suggestionCandidate(
  p: ParserState,
  t: Token,
  kind: import('../core/types').Kind | undefined,
  r: Exclude<LingoResult, FailResult>,
): QuantityResult | undefined {
  if (t.type !== 'word') {
    return
  }
  const top = topTypo(p, t.text, kind)
  if (!top) {
    return
  }
  const unit = p.reg.unit(kind!, top.unitId)!
  const value =
    r.type === 'quantity' ? r.quantity.value : r.type === 'number' ? r.value : Number.NaN
  if (!Number.isFinite(value)) {
    return
  }
  const issueSpan = toSourceSpan(p.n, t.start, t.end)
  const issues = [
    makeIssue(
      'TYPO_CORRECTED',
      { unit: t.text, corrected: unit.symbol },
      issueSpan,
      p.opts.messages,
    ),
  ]
  return {
    ok: true,
    schemaVersion: 3,
    type: 'quantity',
    quantity: new Quantity(p.reg, kind!, toBase(unit, value), unit.id),
    text: p.src,
    span: { start: r.span.start, end: issueSpan.end },
    issues,
    confidence: confidenceForIssues(issues, false),
    locale: p.profile.locale,
  }
}

function candidateWith(
  p: ParserState,
  accept: Partial<NonNullable<ParseOptions['accept']>>,
): Exclude<LingoResult, FailResult> | null {
  const r = parseExpression(p.src, {
    ...p.opts,
    strictness: 'forgiving',
    tolerance: undefined,
    escalate: undefined,
    accept: { ...p.opts.accept, ...accept },
  })
  return r.ok ? r : null
}

function disabledInterpretation(p: ParserState): LingoResult | null {
  if (!p.config.numberWords) {
    const candidate = candidateWith(p, { numberWords: true })
    if (candidate) {
      const it = makeIssue('NO_VALUE', { example: exampleFor(p) }, candidate.span, p.opts.messages)
      return fail(p, candidate, [it])
    }
  }
  if (!p.config.fuzzy) {
    const candidate = candidateWith(p, { fuzzy: true })
    if (candidate) {
      const it = makeIssue('APPROX_NOT_ALLOWED', {}, candidate.span, p.opts.messages)
      return fail(p, candidate, [it])
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Fuzzy vocabulary ("hot", "freezing")

function tryFuzzy(p: ParserState, i: number): Parsed | null {
  const vocabs = p.reg.fuzzyVocabs(p.opts.kind)
  if (vocabs.length === 0) {
    return null
  }
  // strip fillers
  let pos = i
  while (pos < p.tokens.length) {
    const w = wordAt(p, pos)
    if (w && (p.profile.grammar.globalFillers.has(w) || w === "'")) {
      pos++
    } else if (symAt(p, pos) === "'" || symAt(p, pos) === ',') {
      pos++
    } else {
      break
    }
  }
  const t = p.tokens[pos]
  if (t?.type !== 'word') {
    return null
  }

  const preferred = p.opts.profile
  const ordered = preferred
    ? [...vocabs].sort(
        (a, b) => Number(b.vocab.profile === preferred) - Number(a.vocab.profile === preferred),
      )
    : vocabs
  for (const { kind, vocab } of ordered) {
    // Longest term match over the remaining words.
    let bestTerm: string | null = null
    let bestNext = pos
    for (const term of Object.keys(vocab.terms)) {
      const nx = eatPhrase(p, pos, term)
      if (nx >= 0 && (bestTerm === null || term.length > bestTerm.length)) {
        bestTerm = term
        bestNext = nx
      }
    }
    if (!bestTerm) {
      continue
    }
    const [lo, hi] = vocab.terms[bestTerm]!
    const unit = p.reg.unit(kind, vocab.unit)!
    const range = new QuantityRange(p.reg, kind, {
      min: { base: toBase(unit, lo), unit: vocab.unit },
      max: { base: toBase(unit, hi), unit: vocab.unit },
      approximate: true,
      fuzzy: { term: bestTerm, profile: vocab.profile },
    })
    const start = t.start
    const end = p.tokens[bestNext - 1]!.end
    const result: RangeResult = {
      ok: true,
      schemaVersion: 3,
      type: 'range',
      range,
      text: p.src,
      span: toSourceSpan(p.n, start, end),
      issues: p.issues,
      confidence: 0.5,
    }
    return { result, nextToken: bestNext }
  }
  return null
}

// ---------------------------------------------------------------------------
// Trailing input

const TRAILING_OK = new Set(['.', '!', '?', ')', ','])

function finishTrailing(p: ParserState, parsed: Parsed): LingoResult {
  if (!parsed.result.ok) {
    return parsed.result
  }
  let i = parsed.nextToken
  let approximate = false
  for (;;) {
    const t = p.tokens[i]
    if (!t) {
      break
    }
    const w = t.type === 'word' ? t.text.toLowerCase() : null
    const approxPhrase = eatAnyPhrase(p, i, p.profile.grammar.trailingApproxPhrases)
    if (approxPhrase >= 0) {
      approximate = true
      i = approxPhrase
      continue
    }
    if (w && p.profile.grammar.trailingApproxWords.has(w)) {
      approximate = true
      i++
      continue
    }
    if (w && p.profile.grammar.trailingOkWords.has(w)) {
      i++
      continue
    }
    if (
      t.type === 'sym' &&
      t.text === '-' &&
      wordAt(p, i + 1) &&
      p.profile.grammar.trailingApproxWords.has(wordAt(p, i + 1)!)
    ) {
      approximate = true
      i += 2
      continue
    }
    if (t.type === 'sym' && TRAILING_OK.has(t.text)) {
      i++
      continue
    }
    // Unconsumed content.
    if (p.opts.extract) {
      break
    }
    const end = p.tokens[p.tokens.length - 1]!.end
    // A bare value followed by ONE unresolvable word is almost always a unit
    // the user misspelled (or one we don't know) — say THAT, with candidates.
    const rest = p.tokens.slice(i + 1)
    const singleWordTail =
      t.type === 'word' && rest.every((x) => x.type === 'sym' && TRAILING_OK.has(x.text))
    const resultType = parsed.result.type
    const looksLikeUnitSlot =
      singleWordTail &&
      (resultType === 'number' ||
        (resultType === 'quantity' && p.issues.some((x) => x.code === 'UNIT_ASSUMED')))
    if (looksLikeUnitSlot) {
      const sourceKind =
        parsed.result.type === 'quantity' ? parsed.result.quantity.kind : p.opts.kind
      issue(
        p,
        'UNKNOWN_UNIT',
        { unit: t.text, suggestions: suggestUnits(p, t.text, sourceKind) },
        t.start,
        t.end,
      )
      const candidate = suggestionCandidate(p, t, sourceKind, parsed.result)
      return fail(p, candidate)
    }
    if (!p.config.compounds) {
      const candidate = candidateWith(p, { compounds: true })
      if (candidate) {
        const it = makeIssue('SINGLE_VALUE_EXPECTED', {}, candidate.span, p.opts.messages)
        return fail(p, candidate, [it])
      }
    }
    issue(p, 'TRAILING_INPUT', { text: p.text.slice(t.start, end) }, t.start, end)
    return { ok: false, schemaVersion: 3, type: 'failure', text: p.src, issues: p.issues }
  }
  if (approximate) {
    return applyApproximate(p, parsed.result)
  }
  return parsed.result
}

function applyApproximate(p: ParserState, r: LingoResult): LingoResult {
  if (!r.ok) {
    return r
  }
  if (r.type === 'quantity') {
    const q = r.quantity
    const quantity = new Quantity(p.reg, q.kind, q.base, q.unit, {
      approximate: true,
      parts: q.parts,
    })
    return { ...r, quantity, confidence: Math.max(0.05, r.confidence - 0.1) }
  }
  if (r.type === 'range') {
    const range = QuantityRange.fromJSON(p.reg, { ...r.range.toJSON(), approximate: true })
    return { ...r, range, confidence: Math.max(0.05, r.confidence - 0.1) }
  }
  if (r.type === 'number') {
    return { ...r, approximate: true }
  }
  return r
}

// ---------------------------------------------------------------------------
// Public narrow wrappers

/**
 * Parse expecting a single quantity — ranges/conversions/bare numbers that
 * don't reduce to one are `FailResult`s. Prefer the main entry's
 * `parseQuantity()`.
 * @example
 * ```ts
 * import { parseQuantityExpr } from '@pascal-app/lingo/core'
 * import { defaultRegistry } from '@pascal-app/lingo'
 * const r = parseQuantityExpr(`5'11"`, { registry: defaultRegistry })
 * r.ok && r.quantity.to('m').value // 1.8034
 * ```
 */
export function parseQuantityExpr(
  input: string,
  options: ParseOptions,
): QuantityResult | FailResult {
  const r = parseExpression(input, options)
  if (!r.ok) {
    return r
  }
  if (r.type === 'quantity') {
    return r
  }
  if (r.type === 'conversion' && r.converted instanceof Quantity) {
    // "72 in to cm" in a quantity slot: honor the requested target unit.
    return {
      ok: true,
      schemaVersion: 3,
      type: 'quantity',
      quantity: r.converted,
      text: r.text,
      span: r.span,
      issues: r.issues,
      confidence: r.confidence,
      locale: r.locale,
    }
  }
  if (r.type === 'number') {
    const it = makeIssue('NO_VALUE', { example: '"5 kg"' }, r.span, options.messages)
    return { ok: false, schemaVersion: 3, type: 'failure', text: r.text, issues: [...r.issues, it] }
  }
  const it = makeIssue('SINGLE_VALUE_EXPECTED', {}, r.span, options.messages)
  return { ok: false, schemaVersion: 3, type: 'failure', text: r.text, issues: [...r.issues, it] }
}

/**
 * `partialState()`'s tri(+)-state verdict for as-you-type UIs: `'incomplete'`
 * means "a valid prefix, don't show an error yet" — distinct from `'invalid'`.
 * @example
 * ```ts
 * import { partialState } from '@pascal-app/lingo'
 * partialState('2 me') // 'incomplete' (prefix of "meter")
 * partialState('abc')  // 'invalid'
 * ```
 */
export type PartialState = 'empty' | 'incomplete' | 'valid' | 'invalid'

const OPEN_SYMS = new Set([
  '.',
  ',',
  '/',
  '-',
  '+',
  '±',
  '×',
  '*',
  '^',
  '(',
  '<',
  '>',
  '≤',
  '≥',
  '~',
  '=',
])

/**
 * The engine behind the main entry's `partialState()` (not re-exported from
 * `lingo/core` — internal to the grammar). Quad-state partial parsing for
 * as-you-type UIs (react-aria's isValidPartialNumber generalized): "2 f"
 * is *incomplete* — a prefix of "2 ft" — never *invalid*. Error styling
 * should be suppressed while incomplete.
 * @example
 * ```ts
 * import { partialState } from '@pascal-app/lingo'
 * partialState('2 me') // 'incomplete'
 * ```
 */
export function partialQuantityState(input: string, options: ParseOptions): PartialState {
  if (input.trim() === '') {
    return 'empty'
  }
  const p = prepare(input, options)
  const r = parsePreparedExpression(p)
  if (r.ok) {
    return 'valid'
  }
  if (r.candidate) {
    return 'invalid'
  }
  const reg = options.registry!
  const tokens = p.tokens
  const last = tokens[tokens.length - 1]
  if (!last) {
    return 'empty'
  }
  if (last.type === 'sym' && OPEN_SYMS.has(last.text)) {
    return 'incomplete'
  }
  if (last.type === 'word') {
    const w = last.text.toLowerCase()
    if (reg.hasAliasPrefix(last.text, options.kind)) {
      return 'incomplete'
    }
    if (p.profile.grammar.phraseWords.some((phrase) => phrase.startsWith(w))) {
      return 'incomplete'
    }
    if (w === 'e') {
      return 'incomplete' // scientific in progress
    }
  }
  // A lone sign or a "between 5" style prefix: ends in a value with an
  // unfinished phrase before it.
  if (last.type === 'digits' || last.type === 'vulgar') {
    const first = tokens[0]!
    if (
      first.type === 'word' &&
      p.profile.grammar.rangeBetweenWords.has(first.text.toLowerCase())
    ) {
      return 'incomplete'
    }
  }
  return 'invalid'
}

/**
 * Parse expecting a range — a single quantity is accepted as a degenerate
 * `[v, v]` range. Prefer the main entry's `parseRange()`.
 * @example
 * ```ts
 * import { parseRangeExpr } from '@pascal-app/lingo/core'
 * import { defaultRegistry } from '@pascal-app/lingo'
 * const r = parseRangeExpr('5-10 kg', { registry: defaultRegistry })
 * r.ok && r.range.min()?.value // 5
 * ```
 */
export function parseRangeExpr(input: string, options: ParseOptions): RangeResult | FailResult {
  const r = parseExpression(input, options)
  if (!r.ok) {
    return r
  }
  if (r.type === 'range') {
    return r
  }
  if (r.type === 'quantity') {
    // A single value is a degenerate range [v, v].
    const q = r.quantity
    const range = new QuantityRange(options.registry!, q.kind, {
      min: { base: q.base, unit: q.unit },
      max: { base: q.base, unit: q.unit },
      approximate: q.approximate,
    })
    return {
      ok: true,
      schemaVersion: 3,
      type: 'range',
      range,
      text: r.text,
      span: r.span,
      issues: r.issues,
      confidence: r.confidence,
      locale: r.locale,
    }
  }
  const it = makeIssue('NO_VALUE', { example: '"5–10 kg"' }, r.span, options.messages)
  return { ok: false, schemaVersion: 3, type: 'failure', text: r.text, issues: [...r.issues, it] }
}
