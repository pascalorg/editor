import type { P } from './state'

/**
 * Read a bare number written with the pack's `numerals` table — Arabic digits
 * (`15`) or the locale's own digit characters composed positionally around the
 * ten mark (`十五`, `二十`, `二十五`). Returns null when the text is not a
 * number in this locale, so callers can fall through to other grammar.
 */
export function readLocaleNumber(p: P, text: string): number | null {
  if (/^\d+$/.test(text)) {
    return Number(text)
  }
  const numerals = p.profile.numerals
  if (!numerals) {
    return null
  }
  if (text === '十') {
    return 10
  }
  const ten = text.indexOf('十')
  if (ten >= 0) {
    const left = ten === 0 ? 1 : (numerals[text.slice(0, ten)] ?? Number.NaN)
    const right = ten === text.length - 1 ? 0 : (numerals[text.slice(ten + 1)] ?? Number.NaN)
    const value = left * 10 + right
    return Number.isFinite(value) ? value : null
  }
  const value = numerals[text]
  if (value !== undefined) {
    return value
  }
  // Years are spelled out digit by digit rather than positionally:
  // 二〇二六年 is 2026, not "two, zero, two, six" summed.
  return readDigitRun(text, numerals)
}

function readDigitRun(text: string, numerals: Record<string, number>): number | null {
  if ([...text].length < 2) {
    return null
  }
  let out = ''
  for (const ch of text) {
    const digit = numerals[ch]
    if (digit === undefined || digit > 9) {
      return null
    }
    out += String(digit)
  }
  return Number(out)
}

/**
 * Consume the longest number at `pos`, either Arabic digits or a run of the
 * pack's numeral characters. Digits are capped at four so a year and the month
 * that follows it never merge.
 */
export function readNumberAt(
  p: P,
  source: string,
  pos: number,
): { next: number; value: number } | null {
  const digits = /^\d{1,4}/.exec(source.slice(pos))
  if (digits) {
    return { value: Number(digits[0]), next: pos + digits[0].length }
  }
  const numerals = p.profile.numerals
  if (!numerals) {
    return null
  }
  let end = pos
  while (end < source.length && numerals[source[end]!] !== undefined) {
    end++
  }
  if (end === pos) {
    return null
  }
  const value = readLocaleNumber(p, source.slice(pos, end))
  return value === null ? null : { value, next: end }
}
