/**
 * Offset-mapped input normalization.
 *
 * Parsing works on `text`, but every span we report must index the ORIGINAL
 * string — NFKC changes lengths (℃ → °C, ½ → 1⁄2) and we drop invisible
 * characters entirely. For normalized char i, `start[i]`/`end[i]` give the
 * original code-point span that produced it.
 */
import type { Span } from '../core/types'

/**
 * Result of `normalizeInput()`: the folded text plus the offset map back to
 * the original string, used by `toSourceSpan()`.
 * @example
 * ```ts
 * import { normalizeInput } from '@pascal-app/lingo/core'
 * const n = normalizeInput('72°')
 * n.text // "72°"
 * ```
 */
export interface Normalized {
  end: number[]
  sourceLength: number
  start: number[]
  text: string
}

const INVISIBLES = new Set([
  0x20_0b,
  0x20_0c,
  0x20_0d,
  0x20_60,
  0xfe_ff, // zero-width space/joiners/BOM
  0x20_0e,
  0x20_0f,
  0x06_1c, // directional marks
  0x20_2a,
  0x20_2b,
  0x20_2c,
  0x20_2d,
  0x20_2e, // embedding controls
  0x20_66,
  0x20_67,
  0x20_68,
  0x20_69, // isolate controls
])

const SPACES = new Set([
  0x00_09, 0x00_a0, 0x20_00, 0x20_01, 0x20_02, 0x20_03, 0x20_04, 0x20_05, 0x20_06, 0x20_07, 0x20_08,
  0x20_09, 0x20_0a, 0x20_2f, 0x20_5f, 0x30_00,
])

const ROMANCE_FOLDS = {
  À: 'A',
  Á: 'A',
  Â: 'A',
  Ã: 'A',
  Ç: 'C',
  È: 'E',
  É: 'E',
  Ê: 'E',
  Ì: 'I',
  Í: 'I',
  Î: 'I',
  Ñ: 'N',
  Ò: 'O',
  Ó: 'O',
  Ô: 'O',
  Õ: 'O',
  Ù: 'U',
  Ú: 'U',
  Û: 'U',
  à: 'a',
  á: 'a',
  â: 'a',
  ã: 'a',
  ç: 'c',
  è: 'e',
  é: 'e',
  ê: 'e',
  ì: 'i',
  í: 'i',
  î: 'i',
  ñ: 'n',
  ò: 'o',
  ó: 'o',
  ô: 'o',
  õ: 'o',
  ù: 'u',
  ú: 'u',
  û: 'u',
} as const

/** Single-code-point folds applied before NFKC. */
function foldChar(cp: number): string | null {
  if (SPACES.has(cp)) {
    return ' '
  }
  if (cp === 0x22_12) {
    return '-' // minus sign
  }
  if (cp === 0x30_1c || cp === 0xff_5e) {
    return '–'
  }
  // Apostrophe-alikes → ' (incl. prime U+2032, which NFKC would leave alone,
  // and acute/backtick, which people type for feet).
  if (
    cp === 0x20_18 ||
    cp === 0x20_19 ||
    cp === 0x02_bc ||
    cp === 0x20_32 ||
    cp === 0x20_35 ||
    cp === 0x02_b9 ||
    cp === 0x00_b4 ||
    cp === 0x00_60
  ) {
    return "'"
  }
  // Double-quote-alikes → " (incl. double prime U+2033, which NFKC decomposes
  // into TWO primes — folding first keeps 5′11″ intact).
  if (cp === 0x20_1c || cp === 0x20_1d || cp === 0x20_33 || cp === 0x20_36 || cp === 0x02_ba) {
    return '"'
  }
  // Degree look-alikes: masculine ordinal º (NFKC would fold it to 'o'!),
  // ring above ˚, ring operator ∘.
  if (cp === 0x00_ba || cp === 0x02_da || cp === 0x22_18) {
    return '°'
  }
  return null
}

/** Folds applied to NFKC output characters. */
function foldOut(ch: string): string {
  if (ch === '⁄') {
    return '/' // fraction slash (from ½ → 1⁄2)
  }
  const cp = ch.codePointAt(0)!
  if (SPACES.has(cp)) {
    return ' '
  }
  return ROMANCE_FOLDS[ch as keyof typeof ROMANCE_FOLDS] ?? ch
}

/**
 * Fold unicode look-alikes (curly quotes, NFKC forms, invisible characters)
 * into the ASCII the grammar expects, tracking an offset map back to the
 * original string for every issue span. Parsing internals only — most
 * callers should use `parse*()`/`lingo()`.
 * @example
 * ```ts
 * import { normalizeInput } from '@pascal-app/lingo/core'
 * normalizeInput('5′11″').text // `5'11"` — curly primes folded to ASCII
 * ```
 */
export function normalizeInput(input: string): Normalized {
  let i = 0
  for (; i < input.length; i++) {
    const cp = input.charCodeAt(i)
    if (cp < 0x20 || cp > 0x7e || cp === 0x60) {
      break
    }
  }
  if (i === input.length) {
    return { text: input, start: [], end: [], sourceLength: input.length }
  }

  let text = ''
  const start: number[] = []
  const end: number[] = []
  let origIndex = 0
  for (const ch of input) {
    const cp = ch.codePointAt(0)!
    const width = ch.length
    // ASCII fast path (the overwhelmingly common case): no NFKC needed.
    if (cp >= 0x20 && cp <= 0x7e) {
      text += cp === 0x60 ? "'" : ch // backtick → apostrophe
      start.push(origIndex)
      end.push(origIndex + 1)
      origIndex += 1
      continue
    }
    if (cp === 0x09) {
      text += ' '
      start.push(origIndex)
      end.push(origIndex + 1)
      origIndex += 1
      continue
    }
    if (!INVISIBLES.has(cp)) {
      const folded = foldChar(cp)
      const out = folded ?? ch.normalize('NFKC')
      for (const outCh of out) {
        for (const finalCh of foldOut(outCh)) {
          text += finalCh
          start.push(origIndex)
          end.push(origIndex + width)
        }
      }
    }
    origIndex += width
  }
  return { text, start, end, sourceLength: input.length }
}

/**
 * Translate a `[from, to)` span over normalized text into a span over the
 * original input. Empty spans map to a caret position.
 * @example
 * ```ts
 * import { normalizeInput, toSourceSpan } from '@pascal-app/lingo/core'
 * const n = normalizeInput('72°')
 * toSourceSpan(n, 0, 2) // { start: 0, end: 2 }
 * ```
 */
export function toSourceSpan(n: Normalized, from: number, to: number): Span {
  if (n.start.length === 0 && n.text.length === n.sourceLength) {
    return { start: from, end: to }
  }
  const len = n.start.length
  const s = from < len ? n.start[from]! : n.sourceLength
  if (to <= from) {
    return { start: s, end: s }
  }
  const e = to - 1 < len ? n.end[to - 1]! : n.sourceLength
  return { start: s, end: Math.max(s, e) }
}
