import { toBase } from '../core/convert'
import { hasError } from '../core/errors'
import type { QuantityPart } from '../core/quantity'
import type { Kind, UnitDef } from '../core/types'
import { parseValue, type ValueCtx, type ValueNode } from '../number/value'
import { parseAndFractionTail } from '../number/words'
import {
  eatAnyPhrase,
  eatPhrase,
  issue,
  type ParserState,
  symAt,
  valueCtx,
  valueStarts,
  withMessages,
  wordAt,
} from './config'
import { matchUnit, systemRemap, type UnitHit } from './unit-match'

const AMBIGUOUS_OUNCE_ALIASES = new Set(['oz', 'oz.', 'ounce', 'ounces'])
const CENT_CURRENCY_CANDIDATES = ['USD', 'EUR', 'CAD', 'AUD', 'SGD', 'HKD', 'NZD', 'MXN']

export interface BoundQual {
  bound: 'min' | 'max'
  exclusive: boolean
}

export interface Quals {
  approximate: boolean
  bound: BoundQual | null
  next: number
}

/** True when a bound phrase ("under", "over", "at least"…) begins at `pos`. */
function startsBound(p: ParserState, pos: number): boolean {
  for (const phrase of p.profile.grammar.boundPhrases) {
    if (phrase.suffix) {
      continue
    }
    const nx = eatPhrase(p, pos, phrase.phrase)
    if (nx >= 0) {
      // "min"/"max" only count as bounds when a value follows.
      if ((phrase.phrase === 'min' || phrase.phrase === 'max') && !valueStarts(p, nx)) {
        continue
      }
      return true
    }
  }
  return false
}

/**
 * A bound phrase that FOLLOWS the quantity (`5キロ未満`, `5公斤以上`). Only
 * phrases the pack marks `suffix` are read here, so a leading-only phrase can
 * never be mistaken for a postposition.
 */
export function parseTrailingBound(
  p: ParserState,
  pos: number,
): { bound: BoundQual; next: number } | null {
  for (const phrase of p.profile.grammar.boundPhrases) {
    if (!phrase.suffix) {
      continue
    }
    const next = eatPhrase(p, pos, phrase.phrase)
    if (next >= 0) {
      return { bound: { bound: phrase.bound, exclusive: phrase.exclusive }, next }
    }
  }
  return null
}

export function parseQualifiers(p: ParserState, i: number): Quals {
  let pos = i
  let approximate = false
  let bound: BoundQual | null = null
  for (;;) {
    const w = wordAt(p, pos)
    const s = symAt(p, pos)
    if (s === '~' || s === '≈') {
      approximate = true
      pos++
      continue
    }
    if (s === '<' || s === '>' || s === '≤' || s === '≥') {
      const eq = symAt(p, pos + 1) === '=' && !p.tokens[pos + 1]!.spaceBefore
      if (s === '<') {
        bound = { bound: 'max', exclusive: !eq }
      }
      if (s === '>') {
        bound = { bound: 'min', exclusive: !eq }
      }
      if (s === '≤') {
        bound = { bound: 'max', exclusive: false }
      }
      if (s === '≥') {
        bound = { bound: 'min', exclusive: false }
      }
      pos += eq ? 2 : 1
      continue
    }
    if (w !== null) {
      const filler = eatAnyPhrase(p, pos, p.profile.grammar.qualifierFillers)
      if (filler >= 0) {
        pos = filler
        continue
      }
      if (
        w === 'ca' &&
        p.tokens[pos + 1]?.type === 'sym' &&
        p.tokens[pos + 1]!.text === '$' &&
        !p.tokens[pos + 1]!.spaceBefore
      ) {
        break
      }
      // Softeners before a bound word: "just under", "slightly over",
      // "a bit over", "a little under". Only a softener when a bound actually
      // follows, so "a bit" (= 1 bit) and bare "just"/"a little" are untouched.
      if (p.profile.grammar.qualifierSoftenerWords.has(w) && startsBound(p, pos + 1)) {
        approximate = true
        pos++
        continue
      }
      const softener = eatAnyPhrase(p, pos, p.profile.grammar.qualifierSoftenerPhrases)
      if (softener >= 0 && startsBound(p, softener)) {
        approximate = true
        pos = softener
        continue
      }
      // Multi-word approximate phrases ("más o menos", "à peu près") —
      // matched longest-first before single-word approximateWords.
      const approxPhrase = eatAnyPhrase(p, pos, p.profile.grammar.approximatePhrases)
      if (approxPhrase >= 0) {
        approximate = true
        pos = approxPhrase
        const skipWord = wordAt(p, pos)
        if (skipWord && p.profile.grammar.qualifierSkipAfterApprox.has(skipWord)) {
          pos++
        }
        continue
      }
      if (p.profile.grammar.approximateWords.has(w)) {
        approximate = true
        pos++
        if (w === 'approx' && symAt(p, pos) === '.' && !p.tokens[pos]!.spaceBefore) {
          pos++
        }
        if (w === 'ca' && symAt(p, pos) === '.' && !p.tokens[pos]!.spaceBefore) {
          pos++
        }
        const skipWord = wordAt(p, pos)
        if (skipWord && p.profile.grammar.qualifierSkipAfterApprox.has(skipWord)) {
          pos++ // "around the"
        }
        continue
      }
      if (p.profile.grammar.exactWords.has(w)) {
        pos++
        continue
      }
      let matched = false
      for (const phrase of p.profile.grammar.boundPhrases) {
        if (phrase.suffix) {
          continue
        }
        const nx = eatPhrase(p, pos, phrase.phrase)
        if (nx >= 0) {
          // "min"/"max" only count as qualifiers when a value follows.
          if ((phrase.phrase === 'min' || phrase.phrase === 'max') && !valueStarts(p, nx)) {
            break
          }
          bound = { bound: phrase.bound, exclusive: phrase.exclusive }
          pos = nx
          matched = true
          break
        }
      }
      if (matched) {
        continue
      }
    }
    break
  }
  return { approximate, bound, next: pos }
}

export interface QtyNode {
  altValue?: number
  approximate: boolean
  /** Base-unit total when kind known; raw number otherwise. */
  base: number
  headUnit: string | null
  kind: Kind | null
  nextToken: number
  normEnd: number
  normStart: number
  parts: QuantityPart[]
  spread?: [number, number]
  value: ValueNode
}

export interface QtyFlags {
  /** Inside "between A and B" the A-side must not eat 'and' as a sum joiner. */
  noAnd?: boolean
}

export function isCurrencyPrefixHit(hit: UnitHit): boolean {
  return (
    hit.alias === hit.unit.id.toLowerCase() ||
    (!hit.alias.includes(' ') && /[^a-z]/.test(hit.alias))
  )
}

function parseCurrencyPrefixQty(
  p: ParserState,
  i: number,
  atStart: boolean,
  expectKind: Kind | undefined,
  ctx: ValueCtx,
): QtyNode | null {
  if (expectKind && expectKind !== 'currency') {
    return null
  }
  const t = p.tokens[i]
  if (!t) {
    return null
  }

  let sign = 1
  let prefixToken = i
  let normStart = t.start
  if (t.type === 'sym' && (t.text === '-' || t.text === '+')) {
    const next = p.tokens[i + 1]
    if (!next || (next.spaceBefore && !atStart)) {
      return null
    }
    sign = t.text === '-' ? -1 : 1
    prefixToken = i + 1
    normStart = t.start
  }

  const hit = matchUnit(p, prefixToken, 'currency', { allowTypo: false })
  if (hit?.kind !== 'currency' || !isCurrencyPrefixHit(hit)) {
    return null
  }

  const v = parseValue({ ...ctx, kind: 'currency' }, hit.nextToken, true)
  if (!v || v.needsUnit) {
    return null
  }
  for (const it of v.issues) {
    p.issues.push(withMessages(p, it))
  }
  if (hasError(v.issues)) {
    return {
      kind: null,
      base: sign * v.value,
      headUnit: null,
      parts: [],
      value: v,
      normStart,
      normEnd: v.end,
      nextToken: v.next,
      approximate: v.approximate ?? false,
    }
  }

  const value = sign * v.value
  let unit = hit.unit
  const candidates =
    hit.alias === '$' ? 'USD CAD AUD SGD HKD NZD MXN' : hit.alias === '¥' ? 'JPY CNY' : ''
  const preferredCurrency = p.opts.currency ?? p.profile.defaults.currency
  const preferred = preferredCurrency ? p.reg.unitByRef('currency', preferredCurrency) : undefined
  if (preferred && candidates.includes(preferred.id)) {
    unit = preferred
  } else if (candidates) {
    issue(
      p,
      'AMBIGUOUS_UNIT',
      {
        unit: hit.alias,
        assumed: unit.id,
        suggestions: candidates.split(' ').slice(1),
      },
      hit.normStart,
      hit.normEnd,
    )
  }
  return {
    kind: 'currency',
    base: toBase(unit, value),
    headUnit: unit.id,
    parts: [{ unit: unit.id, value }],
    value: v,
    normStart,
    normEnd: v.end,
    nextToken: v.next,
    approximate: v.approximate ?? false,
    spread: v.spread && sign === -1 ? [-v.spread[1], -v.spread[0]] : v.spread,
    altValue: v.altValue === undefined ? undefined : sign * v.altValue,
  }
}

/** A `QtyNode` plus its parsed qualifiers ("about", "at least", "~"). */
export interface QualifiedQty extends QtyNode {
  quals?: Quals
}

export function parseQty(
  p: ParserState,
  i: number,
  atStart: boolean,
  expectKind?: Kind,
  flags?: QtyFlags,
): QtyNode | null {
  const ctx = valueCtx(p, expectKind ?? p.opts.kind, flags?.noAnd)
  const prefix = parseCurrencyPrefixQty(p, i, atStart, expectKind, ctx)
  if (prefix) {
    return prefix
  }

  const v = parseValue(ctx, i, atStart)
  if (!v) {
    return null
  }
  for (const it of v.issues) {
    p.issues.push(withMessages(p, it))
  }
  if (hasError(v.issues)) {
    return {
      kind: null,
      base: v.value,
      headUnit: null,
      parts: [],
      value: v,
      normStart: v.start,
      normEnd: v.end,
      nextToken: v.next,
      approximate: v.approximate ?? false,
    }
  }

  let pos = v.next
  // "5ish kg" / "5 ish kg" — "ish" between the value and a unit marks the
  // value approximate (the trailing "5 kg ish" form is handled downstream).
  if (
    wordAt(p, pos) === 'ish' &&
    matchUnit(p, pos + 1, expectKind, { allowTypo: false }) !== null
  ) {
    v.approximate = true
    pos++
  }
  const minor = expectKind && expectKind !== 'currency' ? null : matchCurrencyMinor(p, pos)
  if (minor) {
    const scale = minorCurrencyScale(minor.unit)
    const value = v.value / scale
    return {
      kind: 'currency',
      base: toBase(minor.unit, value),
      headUnit: minor.unit.id,
      parts: [{ unit: minor.unit.id, value }],
      value: v,
      normStart: v.start,
      normEnd: minor.normEnd,
      nextToken: minor.nextToken,
      approximate: v.approximate ?? false,
      spread: v.spread ? [v.spread[0] / scale, v.spread[1] / scale] : undefined,
      altValue: v.altValue === undefined ? undefined : v.altValue / scale,
    }
  }
  // Optional hyphen between value and unit ("5-foot-11").
  let hyphenSkipped = false
  if (symAt(p, pos) === '-' && !p.tokens[pos]!.spaceBefore && p.tokens[pos + 1]?.type === 'word') {
    hyphenSkipped = true
  }
  const unitTok = p.tokens[hyphenSkipped ? pos + 1 : pos]
  const hit = matchUnit(p, hyphenSkipped ? pos + 1 : pos, expectKind, {
    glued: !hyphenSkipped && unitTok !== undefined && !unitTok.spaceBefore,
  })
  if (!hit) {
    if (v.needsUnit) {
      return null // "an" with no unit is not a value
    }
    return {
      kind: null,
      base: v.value,
      headUnit: null,
      parts: [],
      value: v,
      normStart: v.start,
      normEnd: v.end,
      nextToken: v.next,
      approximate: v.approximate ?? false,
      spread: v.spread,
      altValue: v.altValue,
    }
  }

  const kind = hit.kind
  let unit = hit.unit
  // System remap (imperial gal/cup/pint/quart/floz; ton by system).
  unit = systemRemap(p, unit, kind, hit)
  warnBareOunceDefault(p, kind, hit, expectKind)
  warnBareCelsiusDefault(p, kind, unit.id, hit, Boolean(unitTok?.spaceBefore), expectKind)
  const parts: QuantityPart[] = [{ unit: unit.id, value: v.value }]
  let base = toBase(unit, v.value)
  let lastUnit = unit
  let normEnd = hit.normEnd
  let pos2 = hit.nextToken

  // Compound & additive tails. Juxtaposition ("5 ft 11 in") requires strictly
  // descending units; an explicit joiner ("20in and 10cm", "2m + 3ft",
  // "1 day, 3 hours", "2 m minus 10 cm") lifts that restriction — same-kind
  // terms sum in any order. Tail terms always add as deltas (factor-only),
  // which keeps temperature compounds sane.
  while (p.config.compounds) {
    let cursor = pos2
    // "and a half" after the unit: 1.5 of the last unit (delta semantics).
    const fracTail = parseAndFractionTail(p.tokens, cursor, p.profile.numberWords)
    if (fracTail) {
      base += fracTail.add * lastUnit.factor
      const lastPart = parts[parts.length - 1]!
      lastPart.value += fracTail.add
      pos2 = fracTail.next
      normEnd = p.tokens[fracTail.next - 1]!.end
      break
    }
    // Joiners. NOTE: spaced "-" stays a range separator ("2m - 10cm" is a
    // range); subtraction is the word "minus" only.
    let explicitJoin = false
    let sign = 1
    const jw = wordAt(p, cursor)
    const js = symAt(p, cursor)
    if (
      js === '-' &&
      !p.tokens[cursor]!.spaceBefore &&
      (p.tokens[cursor + 1]?.type === 'word' || p.tokens[cursor + 1]?.type === 'digits')
    ) {
      cursor++ // hyphen-joined compound ("5-foot-11" tail, "5ft-11in")
    } else if (jw && p.profile.grammar.compoundJoinWords.has(jw) && !flags?.noAnd) {
      explicitJoin = true
      cursor++
    } else if ((jw && p.profile.grammar.compoundPlusWords.has(jw)) || js === '+') {
      explicitJoin = true
      cursor++
    } else if (jw && p.profile.grammar.compoundMinusWords.has(jw)) {
      explicitJoin = true
      sign = -1
      cursor++
    } else if (js === ',') {
      explicitJoin = true
      cursor++
    }
    const t = p.tokens[cursor]
    if (!t) {
      break
    }
    const tailCtx: ValueCtx = { ...ctx, kind }
    const tv = parseValue(tailCtx, cursor)
    if (!tv || tv.needsUnit || hasError(tv.issues)) {
      break
    }
    const minorTail = kind === 'currency' ? matchCurrencyMinor(p, tv.next, unit) : null
    if (minorTail && minorTail.unit.id === unit.id) {
      for (const it of tv.issues) {
        p.issues.push(withMessages(p, it))
      }
      const value = (sign * tv.value) / minorCurrencyScale(unit)
      base += toBase(unit, value)
      addCurrencyPart(parts, unit, value)
      normEnd = minorTail.normEnd
      pos2 = minorTail.nextToken
      continue
    }
    const nextAfterBareMinor = p.tokens[tv.next]
    const bareCurrencyMinor =
      kind === 'currency' &&
      hit.alias !== unit.id.toLowerCase() &&
      hit.alias !== unit.symbol &&
      Number.isInteger(tv.value) &&
      tv.value >= 0 &&
      (nextAfterBareMinor === undefined ||
        (nextAfterBareMinor.type === 'sym' && nextAfterBareMinor.text === '.'))
    if (bareCurrencyMinor) {
      const scale = minorCurrencyScale(unit)
      if (tv.value >= scale) {
        issue(
          p,
          'COMPOUND_OVERFLOW',
          { value: tv.value, unit: `${unit.id} minor units` },
          tv.start,
          tv.end,
        )
        break
      }
      for (const it of tv.issues) {
        p.issues.push(withMessages(p, it))
      }
      const value = (sign * tv.value) / scale
      base += toBase(unit, value)
      addCurrencyPart(parts, unit, value)
      normEnd = nextAfterBareMinor ? nextAfterBareMinor.start : p.text.length
      pos2 = tv.next
      continue
    }
    let tailHyphen = 0
    if (
      symAt(p, tv.next) === '-' &&
      !p.tokens[tv.next]!.spaceBefore &&
      p.tokens[tv.next + 1]?.type === 'word'
    ) {
      tailHyphen = 1
    }
    const tailHit = matchUnit(p, tv.next + tailHyphen, kind, { allowTypo: false })
    if (tailHit && tailHit.kind === kind) {
      const tailUnit = systemRemap(p, tailHit.unit, kind, tailHit)
      const canCompound =
        explicitJoin ||
        (tailUnit.factor < lastUnit.factor &&
          lastUnit.offset === undefined &&
          tailUnit.offset === undefined)
      if (!canCompound) {
        break
      }
      if (
        !explicitJoin &&
        lastUnit.subunit?.unit === tailUnit.id &&
        tv.value >= lastUnit.subunit.per &&
        tv.value >= 0
      ) {
        issue(
          p,
          'COMPOUND_OVERFLOW',
          { value: tv.value, unit: tailUnit.plural ?? `${tailUnit.name}s` },
          tv.start,
          tailHit.normEnd,
        )
        normEnd = tailHit.normEnd
        pos2 = tailHit.nextToken
        break
      }
      parts.push({ unit: tailUnit.id, value: sign * tv.value })
      base += sign * (toBase(tailUnit, tv.value) - (tailUnit.offset ?? 0))
      lastUnit = tailUnit
      normEnd = tailHit.normEnd
      pos2 = tailHit.nextToken
      continue
    }
    // Bare trailing number → subunit hint ("5'11", "1m80", "5 ft and 11").
    if (!tailHit && sign === 1 && lastUnit.subunit) {
      const sub = p.reg.unit(kind, lastUnit.subunit.unit)
      if (sub && tv.value >= 0) {
        if (tv.value < lastUnit.subunit.per) {
          parts.push({ unit: sub.id, value: tv.value })
          base += toBase(sub, tv.value) - (sub.offset ?? 0)
          normEnd = tv.end
          pos2 = tv.next
        } else {
          issue(
            p,
            'COMPOUND_OVERFLOW',
            { value: tv.value, unit: sub.plural ?? `${sub.name}s` },
            tv.start,
            tv.end,
          )
          normEnd = tv.end
          pos2 = tv.next
        }
        break // bare tail is always final
      }
    }
    break
  }

  return {
    kind,
    base,
    headUnit: unit.id,
    parts,
    value: v,
    normStart: v.start,
    normEnd,
    nextToken: pos2,
    approximate: v.approximate ?? false,
    spread: v.spread,
    altValue: v.altValue,
  }
}

export interface MinorCurrencyHit {
  nextToken: number
  normEnd: number
  unit: UnitDef
}

export function matchCurrencyMinor(
  p: ParserState,
  i: number,
  majorUnit?: UnitDef,
): MinorCurrencyHit | null {
  const t = p.tokens[i]
  if (!t) {
    return null
  }
  const w = t.type === 'word' ? t.text.toLowerCase() : null
  const s = t.type === 'sym' ? t.text : null
  const pence = w === 'p' || w === 'pence'
  if (!(w === 'cent' || w === 'cents' || s === '¢' || pence)) {
    return null
  }
  const unit = pence ? p.reg.unit('currency', 'GBP') : minorCurrencyUnit(p, majorUnit)
  if (!unit) {
    return null
  }
  if (!(pence || majorUnit || p.opts.currency || p.profile.defaults.currency)) {
    issue(
      p,
      'AMBIGUOUS_UNIT',
      {
        unit: t.text,
        assumed: `${unit.id} cents`,
        suggestions: minorCurrencySuggestions(p, unit.id),
      },
      t.start,
      t.end,
    )
  }
  return {
    unit,
    nextToken: i + 1,
    normEnd: t.end,
  }
}

function addCurrencyPart(parts: QuantityPart[], unit: UnitDef, value: number): void {
  const last = parts[parts.length - 1]
  if (last?.unit === unit.id) {
    last.value += value
  } else {
    parts.push({ unit: unit.id, value })
  }
}

function minorCurrencyUnit(p: ParserState, majorUnit?: UnitDef): UnitDef | null {
  if (!p.reg.kind('currency')) {
    return null
  }
  if (majorUnit && hasMinorCurrencyUnit(majorUnit)) {
    return majorUnit
  }
  const preferredCurrency = p.opts.currency ?? p.profile.defaults.currency
  const preferred = preferredCurrency ? p.reg.unitByRef('currency', preferredCurrency) : undefined
  if (preferred && hasMinorCurrencyUnit(preferred)) {
    return preferred
  }
  const usd = p.reg.unit('currency', 'USD')
  if (usd && hasMinorCurrencyUnit(usd)) {
    return usd
  }
  const base = p.reg.baseUnit('currency')
  return hasMinorCurrencyUnit(base) ? base : null
}

function hasMinorCurrencyUnit(unit: UnitDef): boolean {
  return (unit.minorUnit ?? 2) > 0
}

export function minorCurrencyScale(unit: UnitDef): number {
  return 10 ** (unit.minorUnit ?? 2)
}

function minorCurrencySuggestions(p: ParserState, assumed: string): string[] {
  return CENT_CURRENCY_CANDIDATES.filter((code) => {
    if (code === assumed) {
      return false
    }
    const unit = p.reg.unit('currency', code)
    return unit ? hasMinorCurrencyUnit(unit) : false
  }).map((code) => `${code} cents`)
}

function warnBareOunceDefault(p: ParserState, kind: Kind, hit: UnitHit, expectKind?: Kind): void {
  if (kind !== 'mass' || expectKind || p.opts.kind || !AMBIGUOUS_OUNCE_ALIASES.has(hit.alias)) {
    return
  }
  issue(
    p,
    'AMBIGUOUS_UNIT',
    { unit: hit.alias, assumed: 'ounce (mass)', suggestions: ['fluid ounce (volume)'] },
    hit.normStart,
    hit.normEnd,
  )
}

function warnBareCelsiusDefault(
  p: ParserState,
  kind: Kind,
  unitId: string,
  hit: UnitHit,
  spaced: boolean,
  expectKind?: Kind,
): void {
  if (
    kind !== 'temperature' ||
    unitId !== 'C' ||
    expectKind ||
    p.opts.kind ||
    hit.alias !== 'c' ||
    !spaced
  ) {
    return
  }
  issue(
    p,
    'AMBIGUOUS_UNIT',
    { unit: 'C', assumed: 'degree Celsius', suggestions: ['coulomb (charge)'] },
    hit.normStart,
    hit.normEnd,
  )
}

export function parseQtyWithQuals(
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

export function resolveImplied(p: ParserState): { kind: Kind; unitId: string } | null {
  if (p.opts.unit) {
    if (p.opts.kind && p.reg.unit(p.opts.kind, p.opts.unit)) {
      return { kind: p.opts.kind, unitId: p.opts.unit }
    }
    const found = p.reg.findUnit(p.opts.unit)
    if (found) {
      return { kind: found.kind, unitId: found.unit.id }
    }
  }
  if (p.opts.kind && p.reg.kind(p.opts.kind)) {
    return { kind: p.opts.kind, unitId: p.reg.baseUnit(p.opts.kind).id }
  }
  return null
}

export function ensureUnit(
  p: ParserState,
  q: QtyNode,
): { kind: Kind; base: number; unitId: string } | null {
  if (q.kind && q.headUnit) {
    return { kind: q.kind, base: q.base, unitId: q.headUnit }
  }
  const implied = resolveImplied(p)
  if (!implied) {
    return null
  }
  const unit = p.reg.unit(implied.kind, implied.unitId)!
  issue(p, 'UNIT_ASSUMED', { unit: unit.plural ?? `${unit.name}s` }, q.normStart, q.normEnd)
  return { kind: implied.kind, base: toBase(unit, q.base), unitId: implied.unitId }
}
