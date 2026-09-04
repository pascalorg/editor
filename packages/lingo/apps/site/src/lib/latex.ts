import type { LingoResult, Quantity, QuantityRange } from '@pascal-app/lingo'

/**
 * Canonical readings rendered as LaTeX. The unit ID is already the machine
 * form — "m/s2" carries its own solidus and exponent — so the notation is
 * derived from the parse rather than kept in a lookup table that could drift.
 */

/** Thin space between value and unit, per SI typesetting. */
const THIN = '\\,'

function escapeText(text: string): string {
  return text.replace(/[&%$#_{}]/g, (c) => `\\${c}`)
}

/** "s2" -> "\mathrm{s}^{2}", "km" -> "\mathrm{km}". */
function factorLatex(factor: string): string {
  const m = /^([^\d]+)(\d+)$/.exec(factor)
  if (!m) {
    return `\\mathrm{${escapeText(factor)}}`
  }
  return `\\mathrm{${escapeText(m[1] as string)}}^{${m[2]}}`
}

/** Unit ID to LaTeX. Handles the degree sign, currencies, and solidus units. */
export function unitLatex(unit: string, kind?: string): string {
  if (kind === 'temperature') {
    return unit === 'K' ? '\\mathrm{K}' : `{}^{\\circ}\\mathrm{${escapeText(unit)}}`
  }
  if (kind === 'currency') {
    return `\\mathrm{${escapeText(unit)}}`
  }
  if (unit === '%') {
    return '\\%'
  }
  const [numerator, ...rest] = unit.split('/')
  const top = factorLatex(numerator as string)
  if (rest.length === 0) {
    return top
  }
  return `\\frac{${top}}{${rest.map(factorLatex).join(THIN)}}`
}

function numberLatex(value: number, significant = 6): string {
  if (!Number.isFinite(value)) {
    return String(value)
  }
  const rounded = Number(value.toPrecision(significant))
  if (rounded !== 0 && (Math.abs(rounded) >= 1e6 || Math.abs(rounded) < 1e-4)) {
    const [mantissa, exponent] = rounded.toExponential().split('e')
    return `${mantissa} \\times 10^{${Number(exponent)}}`
  }
  return String(rounded)
}

function quantityLatex(q: Quantity): string {
  // A compound quantity keeps its parts — 5'11" is two terms, not 5.9166 ft.
  if (q.parts && q.parts.length > 1) {
    return q.parts
      .map((part) => `${numberLatex(part.value)}${THIN}${unitLatex(part.unit, q.kind)}`)
      .join('\\;')
  }
  // Percent sets tight against its number; SI units take a thin space.
  const gap = q.unit === '%' ? '' : THIN
  return `${numberLatex(q.value)}${gap}${unitLatex(q.unit, q.kind)}`
}

function rangeLatex(range: QuantityRange): string {
  const min = range.min()
  const max = range.max()
  const center = range.plusMinus ? range.center() : null
  if (center && max) {
    return `${numberLatex(center.value)} \\pm ${numberLatex(max.value - center.value)}${THIN}${unitLatex(center.unit, range.kind)}`
  }
  if (min && max) {
    const unit = unitLatex(max.unit, range.kind)
    const sameUnit = min.unit === max.unit
    const left = sameUnit
      ? numberLatex(min.value)
      : `${numberLatex(min.value)}${THIN}${unitLatex(min.unit, range.kind)}`
    const leOrLt = range.exclusiveMin ? '<' : '\\le'
    const geOrGt = range.exclusiveMax ? '<' : '\\le'
    return `${left} ${leOrLt} x ${geOrGt} ${numberLatex(max.value)}${THIN}${unit}`
  }
  if (min) {
    return `x ${range.exclusiveMin ? '>' : '\\ge'} ${quantityLatex(min)}`
  }
  if (max) {
    return `x ${range.exclusiveMax ? '<' : '\\le'} ${quantityLatex(max)}`
  }
  return ''
}

/** A conversion side is a quantity or, for "between 5 and 10 kg in lb", a range. */
function sideLatex(side: Quantity | QuantityRange): string {
  return 'value' in side ? quantityLatex(side) : rangeLatex(side)
}

/**
 * A successful reading as a LaTeX expression. Conversions render as equations
 * so the source value survives — the arithmetic is the interesting part.
 */
export function resultToLatex(result: LingoResult | null): string | null {
  if (!result?.ok) {
    return null
  }
  switch (result.type) {
    case 'number':
      return numberLatex(result.value)
    case 'quantity':
      return `${result.quantity.approximate ? '\\approx ' : ''}${quantityLatex(result.quantity)}`
    case 'range':
      return rangeLatex(result.range)
    case 'conversion':
      return `${sideLatex(result.source)} = ${sideLatex(result.converted)}`
    default:
      return null
  }
}
