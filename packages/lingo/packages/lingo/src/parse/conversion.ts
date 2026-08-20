import { toBase } from '../core/convert'
import { Quantity, type QuantityRange } from '../core/quantity'
import type { Kind } from '../core/types'
import { confidence, fail, issue, type Parsed, type ParserState, symAt, wordAt } from './config'
import { toSourceSpan } from './normalize'
import { resolveImplied } from './quantity'
import { matchUnit, suggestUnits } from './unit-match'

function rateRequired(
  p: ParserState,
  kind: Kind,
  fromUnits: readonly (string | null | undefined)[],
  to: string,
  normStart: number,
  normEnd: number,
  nextToken: number,
): Parsed | null {
  if (!p.reg.kind(kind)?.rateBased) {
    return null
  }
  for (const from of fromUnits) {
    if (from && from !== to) {
      issue(p, 'RATE_REQUIRED', { from, to }, normStart, normEnd)
      return { result: fail(p), nextToken }
    }
  }
  return null
}

export function tryConversion(p: ParserState, parsed: Parsed, normStart = 0): Parsed | null {
  if (!parsed.result.ok) {
    return null
  }
  const r = parsed.result
  if (r.type !== 'quantity' && r.type !== 'range' && r.type !== 'number') {
    return null
  }

  let i = parsed.nextToken
  const w = wordAt(p, i)
  const s = symAt(p, i)
  let keyword = false
  if (w && (p.profile.grammar.conversionWords.has(w) || w === 'in')) {
    keyword = true
    i++
  } else if (s === '=' || s === '→') {
    keyword = true
    i++
  } else if (s === '-' && symAt(p, i + 1) === '>' && !p.tokens[i + 1]!.spaceBefore) {
    keyword = true
    i += 2
  }
  if (!keyword) {
    return null
  }

  const sourceKind: Kind | undefined =
    r.type === 'quantity' ? r.quantity.kind : r.type === 'range' ? r.range.kind : p.opts.kind
  const hit = matchUnit(p, i, sourceKind)
  if (!hit) {
    const t = p.tokens[i]
    if (
      t &&
      t.type === 'word' &&
      (w === 'in' || (w !== null && p.profile.grammar.conversionWords.has(w)))
    ) {
      const suggestions = suggestUnits(p, t.text, sourceKind)
      issue(p, 'UNKNOWN_UNIT', { unit: t.text, suggestions }, t.start, t.end)
      return { result: fail(p), nextToken: i + 1 }
    }
    return null
  }

  // Kind check.
  if (r.type === 'quantity' && hit.kind !== r.quantity.kind) {
    issue(
      p,
      'CONVERSION_KIND_MISMATCH',
      { found: r.quantity.kind, target: hit.unit.name },
      p.tokens[i]!.start,
      hit.normEnd,
    )
    return { result: fail(p), nextToken: hit.nextToken }
  }
  if (r.type === 'range' && hit.kind !== r.range.kind) {
    issue(
      p,
      'CONVERSION_KIND_MISMATCH',
      { found: r.range.kind, target: hit.unit.name },
      p.tokens[i]!.start,
      hit.normEnd,
    )
    return { result: fail(p), nextToken: hit.nextToken }
  }

  let source: Quantity | QuantityRange
  let converted: Quantity | QuantityRange
  if (r.type === 'quantity') {
    source = r.quantity
    const blocked = rateRequired(
      p,
      r.quantity.kind,
      [r.quantity.unit],
      hit.unit.id,
      normStart,
      hit.normEnd,
      hit.nextToken,
    )
    if (blocked) {
      return blocked
    }
    converted = r.quantity.to(hit.unit.id)
  } else if (r.type === 'range') {
    source = r.range
    const blocked = rateRequired(
      p,
      r.range.kind,
      [r.range.minUnit, r.range.maxUnit, r.range.plusMinus?.unit],
      hit.unit.id,
      normStart,
      hit.normEnd,
      hit.nextToken,
    )
    if (blocked) {
      return blocked
    }
    converted = r.range.to(hit.unit.id)
  } else {
    // bare number → implied unit first
    const implied = resolveImplied(p)
    if (!implied || implied.kind !== hit.kind) {
      // No implied source unit: the bare number reads AS the target unit —
      // no conversion happens, and UNIT_ASSUMED flags the guess.
      issue(
        p,
        'UNIT_ASSUMED',
        { unit: hit.unit.plural ?? `${hit.unit.name}s` },
        p.tokens[i]!.start,
        hit.normEnd,
      )
      const q = new Quantity(p.reg, hit.kind, toBase(hit.unit, r.value), hit.unit.id)
      return {
        result: {
          ok: true,
          schemaVersion: 3,
          type: 'quantity',
          quantity: q,
          text: p.src,
          span: r.span,
          issues: p.issues,
          confidence: confidence(p, false),
        },
        nextToken: hit.nextToken,
      }
    }
    const unit = p.reg.unit(implied.kind, implied.unitId)!
    const q = new Quantity(p.reg, implied.kind, toBase(unit, r.value), implied.unitId)
    source = q
    const blocked = rateRequired(
      p,
      implied.kind,
      [implied.unitId],
      hit.unit.id,
      normStart,
      hit.normEnd,
      hit.nextToken,
    )
    if (blocked) {
      return blocked
    }
    converted = q.to(hit.unit.id)
  }

  const spanEnd = hit.normEnd
  return {
    result: {
      ok: true,
      schemaVersion: 3,
      type: 'conversion',
      source,
      targetUnit: hit.unit.id,
      converted,
      text: p.src,
      span: toSourceSpan(p.n, normStart, spanEnd),
      issues: p.issues,
      confidence: confidence(p, false),
    },
    nextToken: hit.nextToken,
  }
}
