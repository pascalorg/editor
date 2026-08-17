/**
 * TKGM reports a parcel's registered area as a *localised* string, and it does
 * not pick one localisation: the same parcel comes back as `"1,295.00"` from
 * one endpoint and `"1.295,00"` from another. `Number()` yields `NaN` for both,
 * so anything that reads the field raw either prints garbage or silently drops
 * the area — and printing the registry's own text instead would put two
 * different decimal conventions in front of one user.
 *
 * Returns square metres, or `undefined` when the registry gave nothing usable.
 */
export function parseRegisteredArea(raw: string | number | undefined | null): number | undefined {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : undefined
  if (typeof raw !== 'string') return undefined

  const text = raw.trim().replace(/\s/g, '')
  if (text === '' || !/^\d[\d.,]*$/.test(text)) return undefined

  const lastDot = text.lastIndexOf('.')
  const lastComma = text.lastIndexOf(',')

  let decimalAt = -1
  if (lastDot >= 0 && lastComma >= 0) {
    // Both present: whichever comes last is the decimal point, the other groups.
    decimalAt = Math.max(lastDot, lastComma)
  } else if (lastDot >= 0 || lastComma >= 0) {
    const only = Math.max(lastDot, lastComma)
    const separator = text[only]
    const trailing = text.length - only - 1
    // A single separator with exactly three digits behind it and no other
    // separator is a thousands group, not 1.295 m² — areas come back with two
    // decimals. More than one occurrence is unambiguously grouping.
    const occurrences = text.split(separator as string).length - 1
    if (occurrences === 1 && trailing !== 3) decimalAt = only
  }

  const grouped = decimalAt >= 0 ? text.slice(0, decimalAt) : text
  const fractionPart = decimalAt >= 0 ? text.slice(decimalAt + 1) : ''
  // Every separator left of the decimal point has to be grouping three digits.
  // Anything else ("1.29.5,00") is corruption, not a convention we don't know.
  if (/[.,]/.test(grouped) && !/^\d{1,3}(?:([.,])\d{3})(?:\1\d{3})*$/.test(grouped))
    return undefined
  if (/[.,]/.test(fractionPart)) return undefined
  const integerPart = grouped.replace(/[.,]/g, '')

  const value = Number(fractionPart ? `${integerPart}.${fractionPart}` : integerPart)
  return Number.isFinite(value) && value > 0 ? value : undefined
}
