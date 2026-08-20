import { toBase } from '../core/convert'
import { hasError, makeIssue } from '../core/errors'
import { Quantity, QuantityRange } from '../core/quantity'
import type { Kind } from '../core/types'
import { consumeCjkPostUnitHalf, prepareCjkValueTokens } from '../number/cjk'
import { parseValue } from '../number/value'
import {
  type Alternative,
  confidence,
  exampleFor,
  fail,
  issue,
  type NumberResult,
  type Parsed,
  type ParserState,
  type QuantityResult,
  type RangeResult,
  symAt,
  valueCtx,
  valueStarts,
  wordAt,
} from './config'
import { toSourceSpan } from './normalize'
import {
  ensureUnit,
  isCurrencyPrefixHit,
  matchCurrencyMinor,
  minorCurrencyScale,
  parseQty as parseQtyBase,
  parseQualifiers,
  parseTrailingBound,
  type QtyFlags,
  type QtyNode,
  type QualifiedQty,
  resolveImplied,
} from './quantity'
import { matchUnit } from './unit-match'

export function parseRangeOrQty(p: ParserState, i: number, atStart: boolean): Parsed | null {
  // between A and B
  const firstWord = wordAt(p, i)
  if (firstWord && p.profile.grammar.rangeBetweenWords.has(firstWord)) {
    const a = parseQtyWithQuals(p, i + 1, false, { noAnd: true })
    const andWord = a ? wordAt(p, a.nextToken) : null
    if (a && andWord && p.profile.grammar.rangeAndWords.has(andWord)) {
      const b = parseQtyWithQuals(p, a.nextToken + 1, false)
      if (b) {
        const range = buildRange(p, a, b, i)
        if (range) {
          return range
        }
      }
    }
    // fall through: "between" that doesn't pan out re-parses below
  }

  // from A to B  (symmetric to "between A and B")
  if (firstWord && p.profile.grammar.rangeFromWords.has(firstWord)) {
    const a = parseQtyWithQuals(p, i + 1, false)
    if (a) {
      const sep = rangeSeparator(p, a.nextToken)
      if (sep >= 0) {
        const b = parseQtyWithQuals(p, sep, false)
        if (b) {
          const range = buildRange(p, a, b, i)
          if (range) {
            return range
          }
        }
      }
    }
    // fall through: a "from" that doesn't pan out re-parses below
  }

  const quals = parseQualifiers(p, i)
  const a = parseQty(p, quals.next, atStart && quals.next === i)
  if (!a) {
    return null
  }
  if (hasError(p.issues)) {
    return { result: fail(p), nextToken: a.nextToken }
  }

  // Open bound, from a leading qualifier ("under 10 min") or a trailing one
  // ("5キロ未満") — the same range either way, only the word order differs.
  const trailing = quals.bound ? null : parseTrailingBound(p, a.nextToken)
  const openBound = quals.bound ?? trailing?.bound
  if (openBound) {
    const withUnit = ensureUnit(p, a)
    if (!withUnit) {
      return numberish(p, a, quals.approximate)
    }
    const { kind, base, unitId } = withUnit
    const end = trailing ? p.tokens[trailing.next - 1]!.end : a.normEnd
    const range = new QuantityRange(p.reg, kind, {
      min: openBound.bound === 'min' ? { base, unit: unitId } : undefined,
      max: openBound.bound === 'max' ? { base, unit: unitId } : undefined,
      exclusiveMin: openBound.bound === 'min' ? openBound.exclusive : false,
      exclusiveMax: openBound.bound === 'max' ? openBound.exclusive : false,
      approximate: quals.approximate || a.approximate,
    })
    return {
      result: okRange(p, range, i, end),
      nextToken: trailing?.next ?? a.nextToken,
    }
  }

  // ± tolerance
  const pm = tryPlusMinus(p, a)
  if (pm) {
    return pm
  }

  // A – B range
  const sep = rangeSeparator(p, a.nextToken)
  if (sep >= 0) {
    const b = parseQtyWithQuals(p, sep, false)
    if (b) {
      const range = buildRange(p, a, b, i)
      if (range) {
        return range
      }
    }
  }

  const adjacent = tryAdjacentCjkRange(p, a, i)
  if (adjacent) {
    return adjacent
  }

  // Spread from fuzzy amounts ("a few minutes" → 2–4 min).
  if (a.spread && a.kind && a.headUnit) {
    const unit = p.reg.unit(a.kind, a.headUnit)!
    const range = new QuantityRange(p.reg, a.kind, {
      min: { base: toBase(unit, a.spread[0]), unit: a.headUnit },
      max: { base: toBase(unit, a.spread[1]), unit: a.headUnit },
      approximate: true,
    })
    return { result: okRange(p, range, i, a.normEnd), nextToken: a.nextToken }
  }

  // Single quantity / bare number.
  return singleResult(p, a, quals.approximate)
}

function parseQty(
  p: ParserState,
  i: number,
  atStart: boolean,
  expectKind?: Kind,
  flags?: QtyFlags,
): QtyNode | null {
  prepareCjkValueTokens(p.tokens, i, p.profile.numberWords)
  const q = parseQtyBase(p, i, atStart, expectKind, flags)
  return q ? withCjkPostUnitHalf(p, q) : null
}

function parseQtyWithQuals(
  p: ParserState,
  i: number,
  atStart: boolean,
  flags?: QtyFlags,
): QualifiedQty | null {
  const quals = parseQualifiers(p, i)
  const q = parseQty(p, quals.next, atStart, undefined, flags)
  if (!q) {
    return null
  }
  const qualified = q as QualifiedQty
  qualified.quals = quals
  if (quals.approximate) {
    qualified.approximate = true
  }
  return qualified
}

function withCjkPostUnitHalf(p: ParserState, q: QtyNode): QtyNode {
  const half =
    q.kind && q.headUnit && consumeCjkPostUnitHalf(p.tokens, q.nextToken, p.profile.numberWords)
  if (!half) {
    return q
  }
  const part = q.parts[q.parts.length - 1]
  const unit = p.reg.unit(q.kind!, part?.unit ?? q.headUnit!)
  if (!unit) {
    return q
  }
  q.base += 0.5 * unit.factor
  if (part?.unit === unit.id) {
    part.value += 0.5
  } else {
    q.parts.push({ unit: unit.id, value: 0.5 })
  }
  q.normEnd = half.end
  q.nextToken = half.next
  return q
}

function tryAdjacentCjkRange(p: ParserState, a: QtyNode, exprStart: number): Parsed | null {
  const next = p.tokens[a.nextToken]
  if (!next || next.spaceBefore || a.value.value < 1 || a.value.value >= 9) {
    return null
  }
  const b = parseQty(p, a.nextToken, false)
  if (!b || b.value.value !== a.value.value + 1) {
    return null
  }
  return buildRange(p, a as QualifiedQty, b as QualifiedQty, exprStart)
}

/** "-", "–", "—", "to", "..", "..." between two values. */
function rangeSeparator(p: ParserState, i: number): number {
  const t = p.tokens[i]
  if (!t) {
    return -1
  }
  if (t.type === 'word' && p.profile.grammar.rangeSeparatorWords.has(t.text.toLowerCase())) {
    return i + 1
  }
  // "5 or 6 kg" — alternative range. The "5 kg or so" hedge is guarded: the
  // separator only fires when a value (never "so") follows.
  if (t.type === 'word' && p.profile.grammar.rangeAlternativeWords.has(t.text.toLowerCase())) {
    const next = p.tokens[i + 1]
    if (!next || (next.type === 'word' && next.text.toLowerCase() === 'so')) {
      return -1
    }
    if (valueStarts(p, i + 1) || currencyPrefixStarts(p, i + 1)) {
      return i + 1
    }
    return -1
  }
  if (t.type === 'sym') {
    if (t.text === '–' || t.text === '—') {
      return i + 1
    }
    if (t.text === '-') {
      // spaced hyphen, or digits on both sides ("5-10")
      const prev = p.tokens[i - 1]
      const next = p.tokens[i + 1]
      if (!next) {
        return -1
      }
      const spaced = t.spaceBefore && next.spaceBefore
      const tight =
        !(t.spaceBefore || next.spaceBefore) &&
        prev !== undefined &&
        (prev.type === 'digits' || prev.type === 'vulgar' || prev.type === 'word') &&
        (next.type === 'digits' ||
          next.type === 'vulgar' ||
          valueStarts(p, i + 1) ||
          currencyPrefixStarts(p, i + 1))
      if (spaced || tight) {
        return i + 1
      }
      return -1
    }
    // ".." / "..."
    if (t.text === '.' && symAt(p, i + 1) === '.' && !p.tokens[i + 1]!.spaceBefore) {
      let j = i + 2
      if (symAt(p, j) === '.' && !p.tokens[j]!.spaceBefore) {
        j++
      }
      return j
    }
  }
  return -1
}

function currencyPrefixStarts(p: ParserState, i: number): boolean {
  const hit = matchUnit(p, i, 'currency', { allowTypo: false })
  return !!hit && hit.kind === 'currency' && isCurrencyPrefixHit(hit)
}

function tryPlusMinus(p: ParserState, a: QtyNode): Parsed | null {
  const i = a.nextToken
  let consumed = 0
  if (symAt(p, i) === '±') {
    consumed = 1
  } else if (
    symAt(p, i) === '+' &&
    symAt(p, i + 1) === '/' &&
    !p.tokens[i + 1]!.spaceBefore &&
    symAt(p, i + 2) === '-' &&
    !p.tokens[i + 2]!.spaceBefore
  ) {
    consumed = 3
  }
  if (consumed === 0) {
    return null
  }

  const d = parseValue(valueCtx(p, a.kind ?? p.opts.kind), i + consumed)
  if (!d || hasError(d.issues)) {
    return null
  }
  let pos = d.next
  let unitId = a.headUnit
  let kind = a.kind
  const hit = matchUnit(p, pos, kind ?? undefined, { allowTypo: false })
  if (hit) {
    if (kind && hit.kind !== kind) {
      return null
    }
    kind = hit.kind
    unitId = unitId ?? hit.unit.id
    // delta expressed in the hit unit
    pos = hit.nextToken
  }
  const resolved = kind && unitId ? { kind, unitId } : resolveImplied(p)
  if (!resolved) {
    return null
  }
  const centerUnit = p.reg.unit(resolved.kind, resolved.unitId)!
  let unit = p.reg.unit(resolved.kind, hit?.unit.id ?? resolved.unitId)!
  let deltaValue = d.value
  if (!hit && resolved.kind === 'currency') {
    const minor = matchCurrencyMinor(p, pos, centerUnit)
    if (minor) {
      if (minor.unit.id !== centerUnit.id) {
        issue(
          p,
          'RATE_REQUIRED',
          { from: centerUnit.id, to: minor.unit.id },
          a.normStart,
          minor.normEnd,
        )
        return { result: fail(p), nextToken: minor.nextToken }
      }
      unit = centerUnit
      deltaValue /= minorCurrencyScale(centerUnit)
      pos = minor.nextToken
    }
  }
  if (p.reg.kind(resolved.kind)?.rateBased && unit.id !== centerUnit.id) {
    issue(
      p,
      'RATE_REQUIRED',
      { from: centerUnit.id, to: unit.id },
      a.normStart,
      hit?.normEnd ?? d.end,
    )
    return { result: fail(p), nextToken: hit?.nextToken ?? d.next }
  }
  const centerBase = a.kind ? a.base : toBase(centerUnit, a.base)
  const deltaBase = deltaValue * unit.factor // delta semantics: no offset
  const range = new QuantityRange(p.reg, resolved.kind, {
    min: { base: centerBase - deltaBase, unit: resolved.unitId },
    max: { base: centerBase + deltaBase, unit: resolved.unitId },
    plusMinus: { centerBase, deltaBase, unit: resolved.unitId },
    approximate: a.approximate,
  })
  const end = p.tokens[pos - 1]?.end ?? a.normEnd
  return { result: okRange(p, range, a.normStart, end), nextToken: pos }
}

function buildRange(
  p: ParserState,
  a: QualifiedQty,
  b: QualifiedQty,
  exprStart: number,
): Parsed | null {
  // Kind reconciliation: bare sides inherit the other side's unit.
  let kind: Kind | null = a.kind ?? b.kind
  if (a.kind && b.kind && a.kind !== b.kind) {
    issue(p, 'RANGE_KIND_MISMATCH', { left: a.kind, right: b.kind }, a.normStart, b.normEnd)
    return { result: fail(p), nextToken: b.nextToken }
  }
  let aBase = a.base
  let bBase = b.base
  let aUnit = a.headUnit
  let bUnit = b.headUnit
  if (!kind) {
    const implied = resolveImplied(p)
    if (!implied) {
      return null
    }
    kind = implied.kind
    const unit = p.reg.unit(kind, implied.unitId)!
    issue(p, 'UNIT_ASSUMED', { unit: unit.plural ?? `${unit.name}s` }, a.normStart, b.normEnd)
    aBase = toBase(unit, aBase)
    bBase = toBase(unit, bBase)
    aUnit = bUnit = implied.unitId
  } else if (!a.kind) {
    // "5-10 kg": distribute B's head unit to A. Use the unit the number sits
    // next to (b head), honoring compound heads.
    const unit = p.reg.unit(kind, (bUnit ?? b.parts[0]?.unit)!)!
    aBase = toBase(unit, aBase)
    aUnit = unit.id
  } else if (!b.kind) {
    const unit = p.reg.unit(kind, (aUnit ?? a.parts[0]?.unit)!)!
    bBase = toBase(unit, bBase)
    bUnit = unit.id
  }

  if (p.reg.kind(kind)?.rateBased && aUnit && bUnit && aUnit !== bUnit) {
    issue(p, 'RATE_REQUIRED', { from: aUnit, to: bUnit }, a.normStart, b.normEnd)
    return { result: fail(p), nextToken: b.nextToken }
  }

  const reversed = aBase > bBase
  if (reversed) {
    ;[aBase, bBase] = [bBase, aBase]
    ;[aUnit, bUnit] = [bUnit, aUnit]
  }
  const approximate = a.approximate || b.approximate
  const range = new QuantityRange(p.reg, kind, {
    min: { base: aBase, unit: aUnit! },
    max: { base: bBase, unit: bUnit! },
    approximate,
  })
  if (reversed) {
    issue(p, 'RANGE_REVERSED', { fixed: range.format() }, a.normStart, b.normEnd)
  }
  return {
    result: okRange(
      p,
      range,
      exprStart === 0 ? a.normStart : p.tokens[exprStart]!.start,
      b.normEnd,
    ),
    nextToken: b.nextToken,
  }
}

function singleResult(p: ParserState, a: QtyNode, approxQual: boolean): Parsed {
  const approximate = approxQual || a.approximate

  if (a.kind && a.headUnit) {
    // Expected-kind validation.
    if (p.opts.kind && a.kind !== p.opts.kind) {
      issue(
        p,
        'KIND_MISMATCH',
        { found: a.kind, expected: p.opts.kind, example: exampleFor(p) },
        a.normStart,
        a.normEnd,
      )
      return { result: fail(p), nextToken: a.nextToken }
    }
    const quantity = new Quantity(p.reg, a.kind, a.base, a.headUnit, {
      approximate,
      parts: a.parts.length > 1 ? a.parts : undefined,
    })
    const alternatives = buildAlternatives(p, a)
    const result: QuantityResult = {
      ok: true,
      schemaVersion: 3,
      type: 'quantity',
      quantity,
      text: p.src,
      span: toSourceSpan(p.n, a.normStart, a.normEnd),
      issues: p.issues,
      confidence: confidence(p, approximate),
    }
    if (alternatives.length > 0) {
      result.alternatives = alternatives
    }
    return { result, nextToken: a.nextToken }
  }

  // No unit in the text: implied unit / kind, else plain number.
  const implied = resolveImplied(p)
  if (implied) {
    if (!p.config.bareNumbers) {
      if (p.tokens[a.nextToken]) {
        return numberish(p, a, approximate)
      }
      const unit = p.reg.unit(implied.kind, implied.unitId)!
      issue(p, 'UNIT_ASSUMED', { unit: unit.plural ?? `${unit.name}s` }, a.normStart, a.normEnd)
      const span = toSourceSpan(p.n, a.normStart, a.normEnd)
      const candidate: QuantityResult = {
        ok: true,
        schemaVersion: 3,
        type: 'quantity',
        quantity: new Quantity(p.reg, implied.kind, toBase(unit, a.base), implied.unitId, {
          approximate,
        }),
        text: p.src,
        span,
        issues: p.issues,
        confidence: confidence(p, approximate),
      }
      const it = makeIssue('UNIT_REQUIRED', { example: exampleFor(p) }, span, p.opts.messages)
      return {
        result: fail(p, candidate, [it]),
        nextToken: a.nextToken,
      }
    }
    if (p.tokens[a.nextToken] && p.config.typos !== 'fix') {
      return numberish(p, a, approximate)
    }
    const unit = p.reg.unit(implied.kind, implied.unitId)!
    issue(p, 'UNIT_ASSUMED', { unit: unit.plural ?? `${unit.name}s` }, a.normStart, a.normEnd)
    const quantity = new Quantity(p.reg, implied.kind, toBase(unit, a.base), implied.unitId, {
      approximate,
    })
    return {
      result: {
        ok: true,
        schemaVersion: 3,
        type: 'quantity',
        quantity,
        text: p.src,
        span: toSourceSpan(p.n, a.normStart, a.normEnd),
        issues: p.issues,
        confidence: confidence(p, approximate),
      },
      nextToken: a.nextToken,
    }
  }
  return numberish(p, a, approximate)
}

function numberish(p: ParserState, a: QtyNode, approximate: boolean): Parsed {
  const result: NumberResult = {
    ok: true,
    schemaVersion: 3,
    type: 'number',
    value: a.base,
    text: p.src,
    span: toSourceSpan(p.n, a.normStart, a.normEnd),
    issues: p.issues,
    confidence: confidence(p, approximate),
  }
  if (approximate) {
    result.approximate = true
  }
  return { result, nextToken: a.nextToken }
}

function okRange(
  p: ParserState,
  range: QuantityRange,
  normStart: number,
  normEnd: number,
): RangeResult {
  return {
    ok: true,
    schemaVersion: 3,
    type: 'range',
    range,
    text: p.src,
    span: toSourceSpan(p.n, normStart, normEnd),
    issues: p.issues,
    confidence: confidence(p, range.approximate),
  }
}

function buildAlternatives(p: ParserState, a: QtyNode): Alternative[] {
  const out: Alternative[] = []
  if (a.altValue !== undefined && a.kind && a.headUnit) {
    const unit = p.reg.unit(a.kind, a.headUnit)!
    out.push({
      type: 'quantity',
      quantity: new Quantity(p.reg, a.kind, toBase(unit, a.altValue), a.headUnit),
      confidence: 0.4,
      reason: 'AMBIGUOUS_NUMBER',
    })
  }
  return out
}
