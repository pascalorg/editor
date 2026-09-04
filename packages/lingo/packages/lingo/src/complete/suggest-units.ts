import type { Registry } from '../core/registry'
import type { Kind, UnitDef } from '../core/types'
import type { Token } from '../parse/tokenize'

/** Curated, interactive-first units per kind (not registration order). */
export const SUGGEST_UNITS_BY_KIND: Partial<Record<Kind, readonly string[]>> = {
  length: ['m', 'ft', 'cm', 'in', 'km', 'mi', 'mm'],
  mass: ['kg', 'lb', 'oz', 'g', 'mg'],
  temperature: ['°C', '°F', 'K'],
  volume: ['L', 'mL', 'gal', 'fl oz', 'cup'],
  area: ['m²', 'ft²', 'ha', 'acre'],
  speed: ['km/h', 'mph', 'm/s', 'kn'],
  duration: ['h', 'min', 's', 'd'],
  data: ['GB', 'MB', 'TB', 'KB'],
  angle: ['°', 'rad'],
  pressure: ['Pa', 'bar', 'psi', 'atm'],
  energy: ['J', 'kWh', 'cal', 'kcal'],
  power: ['W', 'kW', 'hp'],
  currency: ['USD', 'EUR', 'GBP'],
}

export interface SuggestedUnit {
  alias: string
  kind: Kind
  unit: UnitDef
}

export interface SuggestUnitsOptions {
  impliedLimit?: number
  kind?: Kind
  units?: readonly string[]
}

const DEFAULT_IMPLIED_LIMIT = 8

export function resolveSuggestedUnits(
  reg: Registry,
  opts: SuggestUnitsOptions,
  inferKind?: Kind,
): SuggestedUnit[] {
  const cap = opts.impliedLimit ?? DEFAULT_IMPLIED_LIMIT

  if (opts.units?.length) {
    const out: SuggestedUnit[] = []
    for (const ref of opts.units) {
      const hit = reg.findUnitByRef(ref)
      if (!hit) {
        continue
      }
      out.push({
        kind: hit.kind,
        unit: hit.unit,
        alias: hit.unit.symbol,
      })
    }
    return out.slice(0, cap)
  }

  const kind = inferKind ?? opts.kind
  if (!kind) {
    return []
  }

  const ids = SUGGEST_UNITS_BY_KIND[kind]
  if (ids) {
    const out: SuggestedUnit[] = []
    for (const id of ids) {
      const unit = reg.unit(kind, id) ?? reg.unitByRef(kind, id)
      if (unit) {
        out.push({ kind, unit, alias: unit.symbol })
      }
    }
    return out.slice(0, cap)
  }

  return reg
    .unitsOf(kind)
    .slice(0, cap)
    .map((unit) => ({ kind, unit, alias: unit.symbol }))
}

export interface RangeTail {
  rewriteWithUnit: (alias: string) => string
  sepIndex: number
}

const RANGE_SEP_WORDS = new Set(['to', 'or'])

function isRangeSepToken(t: Token): boolean {
  if (t.type === 'sym' && (t.text === '-' || t.text === '–' || t.text === '—')) {
    return true
  }
  if (t.type === 'word') {
    const w = t.text.toLowerCase()
    return RANGE_SEP_WORDS.has(w) || w === 'and'
  }
  return false
}

function findRangeSepBefore(tokens: Token[], valueIndex: number): number {
  for (let i = valueIndex - 1; i >= 0; i--) {
    const t = tokens[i]!
    if (isRangeSepToken(t)) {
      if (t.type === 'word' && t.text.toLowerCase() === 'and') {
        if (tokens[0]?.type === 'word' && tokens[0].text.toLowerCase() === 'between') {
          return i
        }
        continue
      }
      return i
    }
  }
  return -1
}

/** Detect a range whose trailing bound is a bare number or partial unit token. */
export function detectRangeTail(tokens: Token[], text: string): RangeTail | null {
  if (tokens.length < 3) {
    return null
  }

  const last = tokens[tokens.length - 1]!
  const prev = tokens[tokens.length - 2]

  if (last.type === 'word' && prev && (prev.type === 'digits' || prev.type === 'vulgar')) {
    const sepIndex = findRangeSepBefore(tokens, tokens.length - 2)
    if (sepIndex >= 0) {
      return {
        sepIndex,
        rewriteWithUnit: (alias) => `${text.slice(0, last.start)}${alias}`,
      }
    }
  }

  if (last.type === 'digits' || last.type === 'vulgar') {
    const sepIndex = findRangeSepBefore(tokens, tokens.length - 1)
    if (sepIndex >= 0) {
      return {
        sepIndex,
        rewriteWithUnit: (alias) => {
          const gap = text.slice(last.end).trim() === '' ? ' ' : ''
          return `${text.slice(0, last.end)}${gap}${alias}`
        },
      }
    }
  }

  return null
}

/** Kind from an explicit unit on the left side of a range separator. */
export function inferKindFromRangeLeft(
  reg: Registry,
  tokens: Token[],
  text: string,
  lower: string,
  sepIndex: number,
): Kind | undefined {
  for (let i = sepIndex - 1; i >= 0; i--) {
    const t = tokens[i]!
    if (t.type !== 'word' && t.type !== 'sym') {
      continue
    }
    const matches = reg.matchUnitsAt(text, lower, t.start)
    const hit = matches.find((m) => t.start + m.length === t.end)
    if (hit) {
      return hit.kind
    }
  }
  return
}

function isNumericRunToken(t: Token): boolean {
  return (
    t.type === 'digits' ||
    t.type === 'vulgar' ||
    (t.type === 'sym' && (t.text === '.' || t.text === ','))
  )
}

/** Full text of the numeric literal ending just before `sepIndex`, or null. */
function leftBoundText(tokens: Token[], text: string, sepIndex: number): string | null {
  let anchor = -1
  for (let i = sepIndex - 1; i >= 0; i--) {
    const t = tokens[i]!
    if (t.type === 'digits' || t.type === 'vulgar') {
      anchor = i
      break
    }
  }
  if (anchor < 0) {
    return null
  }
  let edge = anchor
  while (edge > 0 && !tokens[edge]!.spaceBefore && isNumericRunToken(tokens[edge - 1]!)) {
    edge--
  }
  // A word glued to the front ("1h30") is a compound, not a clean number.
  if (edge > 0 && !tokens[edge]!.spaceBefore && tokens[edge - 1]!.type === 'word') {
    return null
  }
  return text.slice(tokens[edge]!.start, tokens[anchor]!.end)
}

/** Full text of the numeric literal starting just after `sepIndex`, or null. */
function rightBoundText(tokens: Token[], text: string, sepIndex: number): string | null {
  let anchor = -1
  for (let i = sepIndex + 1; i < tokens.length; i++) {
    const t = tokens[i]!
    if (t.type === 'digits' || t.type === 'vulgar') {
      anchor = i
      break
    }
  }
  if (anchor < 0) {
    return null
  }
  let lo = anchor
  while (lo > sepIndex + 1 && !tokens[lo]!.spaceBefore && isNumericRunToken(tokens[lo - 1]!)) {
    lo--
  }
  let hi = anchor
  while (
    hi + 1 < tokens.length &&
    !tokens[hi + 1]!.spaceBefore &&
    isNumericRunToken(tokens[hi + 1]!)
  ) {
    hi++
  }
  // A word glued to either end ("1h30") is a compound, not a clean number.
  if (lo > sepIndex + 1 && !tokens[lo]!.spaceBefore && tokens[lo - 1]!.type === 'word') {
    return null
  }
  if (hi + 1 < tokens.length && !tokens[hi + 1]!.spaceBefore && tokens[hi + 1]!.type === 'word') {
    return null
  }
  return text.slice(tokens[lo]!.start, tokens[hi]!.end)
}

export function extractRangeBounds(
  tokens: Token[],
  text: string,
  sepIndex: number,
): { left: string; right: string } | null {
  const left = leftBoundText(tokens, text, sepIndex)
  const right = rightBoundText(tokens, text, sepIndex)
  return left !== null && right !== null ? { left, right } : null
}

/** Canonical hyphen-range rewrite when both bounds are clean numeric literals. */
export function rangeRewriteWithUnit(
  tokens: Token[],
  text: string,
  tail: RangeTail,
  alias: string,
): string {
  const bounds = extractRangeBounds(tokens, text, tail.sepIndex)
  if (bounds) {
    return `${bounds.left}-${bounds.right} ${alias}`
  }
  return tail.rewriteWithUnit(alias)
}
