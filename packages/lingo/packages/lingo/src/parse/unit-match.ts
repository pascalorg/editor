import type { UnitMatch } from '../core/registry'
import type { Kind, UnitDef } from '../core/types'
import { issue, type ParserState, symAt, tokenAfter } from './config'

export interface UnitHit {
  alias: string
  kind: Kind
  nextToken: number
  normEnd: number
  normStart: number
  unit: UnitDef
}

/** Kind-context slang: tokens that read differently inside a known kind. */
const KIND_SLANG: Record<string, Record<string, string>> = {
  currency: { pound: 'GBP', pounds: 'GBP' },
  duration: { m: 'min' },
}

const DEFERRED_TYPO_UNITS: Partial<Record<Kind, ReadonlySet<string>>> = {
  pressure: new Set(['psia', 'psig']),
}

const PUNCT_END = new Set(['.', ',', '!', '?', ';', ')', ':'])

/**
 * Try to read a unit reference starting at token `i`. Applies the "in"
 * unit-slot rule, kind slang (5m as minutes under duration), alias fallbacks
 * (kb → kB with a warning), and typo correction.
 */
export function matchUnit(
  p: ParserState,
  i: number,
  expectKind?: Kind,
  opts?: { allowTypo?: boolean; glued?: boolean },
): UnitHit | null {
  const t = p.tokens[i]
  if (!t) {
    return null
  }
  const kindCtx = expectKind ?? p.opts.kind

  // Kind slang first (exact single-token hits like "m" under duration).
  if (kindCtx && t.type === 'word') {
    const slangUnit = KIND_SLANG[kindCtx]?.[t.text.toLowerCase()]
    if (slangUnit) {
      const unit = p.reg.unit(kindCtx, slangUnit)!
      // "pound sterling"/"pounds sterling" is GBP's proper NAME, not slang:
      // absorb a trailing "sterling" so the full name parses cleanly (with no
      // SLANG_UNIT warning). Bare "pound"/"pounds" stays slang.
      const next = p.tokens[i + 1]
      if (
        kindCtx === 'currency' &&
        next?.type === 'word' &&
        next.text.toLowerCase() === 'sterling'
      ) {
        return {
          unit,
          kind: kindCtx,
          nextToken: i + 2,
          normStart: t.start,
          normEnd: next.end,
          alias: `${t.text.toLowerCase()} sterling`,
        }
      }
      issue(p, 'SLANG_UNIT', { alias: t.text, unit: unit.name }, t.start, t.end)
      return {
        unit,
        kind: kindCtx,
        nextToken: i + 1,
        normStart: t.start,
        normEnd: t.end,
        alias: t.text.toLowerCase(),
      }
    }
  }

  if (kindCtx === 'duration' && t.type === 'sym' && (t.text === "'" || t.text === '"')) {
    let alias = t.text
    let unitId = t.text === "'" ? 'min' : 's'
    let end = t.end
    if (t.text === "'" && symAt(p, i + 1) === "'" && !p.tokens[i + 1]!.spaceBefore) {
      alias = "''"
      unitId = 's'
      end = p.tokens[i + 1]!.end
    }
    const unit = p.reg.unit('duration', unitId)!
    issue(p, 'SLANG_UNIT', { alias, unit: unit.name }, t.start, end)
    return {
      unit,
      kind: 'duration',
      nextToken: tokenAfter(p, end),
      normStart: t.start,
      normEnd: end,
      alias,
    }
  }

  const matches = p.reg.matchUnitsAt(p.text, p.lower, t.start, kindCtx)
  const gated = matches.filter((m) => passesGates(p, i, m, kindCtx, opts))
  if (gated.length > 0) {
    let best = gated[0]!
    // Glued-digits demotion: "6ft2" is the height idiom (6′2″), not 6 ft².
    // When a digit-suffixed alias sits directly against the value, and its
    // prefix is a unit with a subunit hint that the digits fit into, prefer
    // the compound reading — for 'ft' always, otherwise only for 2+ digit
    // tails ("1m80" is 1 m 80 cm, but "2m2" stays 2 m²).
    if (opts?.glued) {
      const dm = /^(.*?)([0-9]+)$/.exec(best.alias)
      if (dm) {
        const alt = gated.find((g) => g.alias === dm[1] && g.unit.subunit)
        if (alt && Number(dm[2]) < alt.unit.subunit!.per) {
          const preferCompound = kindCtx
            ? kindCtx === alt.kind
            : dm[1] === 'ft' || dm[2]!.length >= 2
          if (preferCompound) {
            best = alt
          }
        }
      }
    }
    const nextToken = tokenAfter(p, t.start + best.length)
    return {
      unit: best.unit,
      kind: best.kind,
      nextToken,
      normStart: t.start,
      normEnd: t.start + best.length,
      alias: best.alias,
    }
  }

  // Bare "°" under temperature → assume the field's unit (or °C). This sits
  // after registry matching so explicit "°C" / "° F" aliases win.
  if (kindCtx === 'temperature' && t.type === 'sym' && t.text === '°') {
    const assumed = p.opts.unit && p.reg.unit('temperature', p.opts.unit) ? p.opts.unit : 'C'
    const unit = p.reg.unit('temperature', assumed)!
    issue(p, 'AMBIGUOUS_UNIT', { unit: '°', assumed: unit.symbol }, t.start, t.end)
    return {
      unit,
      kind: 'temperature',
      nextToken: i + 1,
      normStart: t.start,
      normEnd: t.end,
      alias: '°',
    }
  }

  // Alias fallbacks (lowercase byte-ish etc).
  if (t.type === 'word') {
    const fb = p.opts.aliasFallbacks?.[t.text.toLowerCase()]
    if (fb && (!kindCtx || kindCtx === fb.kind)) {
      const unit = p.reg.unit(fb.kind, fb.unit)
      if (unit) {
        issue(
          p,
          'AMBIGUOUS_UNIT',
          { unit: t.text, assumed: unit.plural ?? `${unit.name}s`, suggestions: [fb.alt] },
          t.start,
          t.end,
        )
        return {
          unit,
          kind: fb.kind,
          nextToken: i + 1,
          normStart: t.start,
          normEnd: t.end,
          alias: t.text.toLowerCase(),
        }
      }
    }
  }

  // Typo pass: auto-accept a unique distance-1 candidate under kind context;
  // otherwise the caller reports UNKNOWN_UNIT with the ranked suggestions.
  if (
    opts?.allowTypo !== false &&
    p.config.typos === 'fix' &&
    t.type === 'word' &&
    t.text.length >= 3 &&
    kindCtx
  ) {
    if (DEFERRED_TYPO_UNITS[kindCtx]?.has(t.text.toLowerCase())) {
      return null
    }
    const detailed = p.reg.suggestUnitsDetailed(t.text, kindCtx, 3)
    const top = detailed[0]
    const runnerUp = detailed[1]
    if (
      top &&
      top.kind === kindCtx &&
      top.distance === 1 &&
      (runnerUp === undefined || runnerUp.distance > 1)
    ) {
      const unit = p.reg.unit(top.kind, top.unitId)!
      issue(p, 'TYPO_CORRECTED', { unit: t.text, corrected: unit.symbol }, t.start, t.end)
      return {
        unit,
        kind: top.kind,
        nextToken: i + 1,
        normStart: t.start,
        normEnd: t.end,
        alias: t.text.toLowerCase(),
      }
    }
  }
  return null
}

export function suggestUnits(p: ParserState, token: string, kind?: Kind): string[] {
  return p.config.typos === 'off' ? [] : p.reg.suggestUnits(token, kind, 3)
}

export function topTypo(
  p: ParserState,
  token: string,
  kind?: Kind,
): { symbol: string; distance: number; unitId: string } | null {
  if (p.config.typos !== 'suggest' || !kind) {
    return null
  }
  const detailed = p.reg.suggestUnitsDetailed(token, kind, 2)
  const top = detailed[0]
  const runnerUp = detailed[1]
  return top && top.kind === kind && top.distance === 1 && (!runnerUp || runnerUp.distance > 1)
    ? top
    : null
}

function passesGates(
  p: ParserState,
  i: number,
  m: UnitMatch,
  kindCtx?: Kind,
  opts?: { glued?: boolean },
): boolean {
  if (opts?.glued && !kindCtx && m.kind === 'concentration' && m.alias === 'M') {
    return false
  }
  // The "in" preposition rule.
  if (m.alias === 'in' && m.kind === 'length') {
    if (kindCtx === 'length') {
      return true
    }
    const after = tokenAfter(p, p.tokens[i]!.start + m.length)
    const t = p.tokens[after]
    if (!t) {
      return true // terminal
    }
    if (t.type === 'sym' && PUNCT_END.has(t.text)) {
      return true
    }
    const w = t.type === 'word' ? t.text.toLowerCase() : null
    if (w && (p.profile.grammar.conversionWords.has(w) || w === 'in')) {
      return true
    }
    // additive joiners keep "in" a unit: "20in and 10cm", "3in + 2cm"
    if (
      w &&
      (p.profile.grammar.compoundJoinWords.has(w) ||
        p.profile.grammar.compoundPlusWords.has(w) ||
        p.profile.grammar.compoundMinusWords.has(w))
    ) {
      return true
    }
    if (
      t.type === 'sym' &&
      (t.text === '=' || t.text === '→' || t.text === '+' || t.text === ',')
    ) {
      return true
    }
    // compound tail: a value follows ("6 in 5 …" is odd; require digits)
    if (t.type === 'digits' || t.type === 'vulgar') {
      return true
    }
    return false
  }
  // Prime/quote marks resolve to arc units only in angle context.
  if (
    (m.alias === "'" ||
      m.alias === '"' ||
      m.alias === '′' ||
      m.alias === '″' ||
      m.alias === "''") &&
    m.kind === 'angle'
  ) {
    return kindCtx === 'angle'
  }
  return true
}

const IMPERIAL_REMAP: Record<string, string> = {
  gal: 'gal-imp',
  'gal/min': 'gal-imp/min',
  floz: 'floz-imp',
  cup: 'cup-imp',
  pt: 'pt-imp',
  qt: 'qt-imp',
}

export function systemRemap(p: ParserState, unit: UnitDef, kind: Kind, hit: UnitHit): UnitDef {
  const system = p.opts.system ?? p.profile.defaults.system ?? 'us'
  if ((kind === 'volume' || kind === 'flow_rate') && system === 'imperial') {
    const remapped = IMPERIAL_REMAP[unit.id]
    if (remapped) {
      const u = p.reg.unit(kind, remapped)
      if (u) {
        return u
      }
    }
  }
  if (kind === 'mass' && (hit.alias === 'ton' || hit.alias === 'tons')) {
    const target = system === 'imperial' ? 'ton-long' : 'ton-short'
    const u = p.reg.unit(kind, target)
    if (u) {
      issue(
        p,
        'AMBIGUOUS_UNIT',
        { unit: hit.alias, assumed: u.name, suggestions: ['tonne (metric)'] },
        hit.normStart,
        hit.normEnd,
      )
      return u
    }
  }
  return unit
}
