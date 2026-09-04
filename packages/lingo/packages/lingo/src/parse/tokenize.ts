import type { Normalized } from './normalize'

export type TokenType = 'digits' | 'word' | 'vulgar' | 'sym'

export interface Token {
  den?: number
  end: number
  /** Vulgar fraction value (½ → 1/2), pre-split from same-origin expansion. */
  num?: number
  spaceBefore: boolean
  /** Offsets into normalized text. */
  start: number
  /** Slice of normalized text. */
  text: string
  type: TokenType
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9'
}

function isLetter(ch: string): boolean {
  const c = ch.charCodeAt(0)
  return (c >= 97 && c <= 122) || (c >= 65 && c <= 90)
}

function isCjkWord(ch: string): boolean {
  const c = ch.charCodeAt(0)
  return (
    (c >= 0x34_00 && c <= 0x4d_bf) ||
    (c >= 0x4e_00 && c <= 0x9f_ff) ||
    (c >= 0x30_40 && c <= 0x30_9f) ||
    (c >= 0x30_a0 && c <= 0x30_ff) ||
    (c >= 0xf9_00 && c <= 0xfa_ff)
  )
}

/**
 * Scan normalized text into tokens. One subtlety: NFKC expands vulgar
 * fractions in place (`1½` → `11/2`), which would misread as eleven halves.
 * Expansion chars all share one original index, so a same-origin `d…/d…` run
 * becomes a dedicated 'vulgar' token instead.
 */
export function tokenize(n: Normalized): Token[] {
  const { text, start } = n
  const tokens: Token[] = []
  let i = 0
  let spaceBefore = false
  while (i < text.length) {
    const ch = text[i]!
    if (ch === ' ') {
      spaceBefore = true
      i++
      continue
    }
    const tokenStart = i
    // Same-origin vulgar fraction: digits '/' digits all mapping to one char.
    if (isDigit(ch) && sameOriginFraction(n, i)) {
      const origin = start[i]!
      let j = i
      while (j < text.length && start[j] === origin) {
        j++
      }
      const slice = text.slice(i, j)
      const slash = slice.indexOf('/')
      tokens.push({
        type: 'vulgar',
        text: slice,
        start: tokenStart,
        end: j,
        spaceBefore,
        num: Number(slice.slice(0, slash)),
        den: Number(slice.slice(slash + 1)),
      })
      i = j
    } else if (isDigit(ch)) {
      let j = i + 1
      // Digits from a vulgar expansion must not merge with typed digits.
      while (j < text.length && isDigit(text[j]!) && !sameOriginFraction(n, j)) {
        j++
      }
      tokens.push({
        type: 'digits',
        text: text.slice(i, j),
        start: tokenStart,
        end: j,
        spaceBefore,
      })
      i = j
    } else if (isLetter(ch)) {
      let j = i + 1
      while (j < text.length && isLetter(text[j]!)) {
        j++
      }
      tokens.push({ type: 'word', text: text.slice(i, j), start: tokenStart, end: j, spaceBefore })
      i = j
    } else if (isCjkWord(ch)) {
      let j = i + 1
      while (j < text.length && isCjkWord(text[j]!)) {
        j++
      }
      tokens.push({ type: 'word', text: text.slice(i, j), start: tokenStart, end: j, spaceBefore })
      i = j
    } else {
      tokens.push({ type: 'sym', text: ch, start: tokenStart, end: i + 1, spaceBefore })
      i++
    }
    spaceBefore = false
  }
  return tokens
}

/** How many characters of a unit alias start at this offset in the token. */
export type AliasLengthAt = (start: number) => number

/**
 * Scripts written without word spaces hand the tokenizer one long run
 * (`三至五公斤`, `5キロ未満`), which hides the grammar words inside it: the
 * range separator never matches, and a bound or approximant glued behind the
 * unit is silently swallowed with the rest of the token. Cutting the run at the
 * profile's own grammar words restores the token boundaries the grammar
 * expects, so no per-language parser branch is needed.
 *
 * Only non-Latin vocabulary splits, so spaced languages tokenize unchanged.
 */
export function splitGluedWords(
  tokens: Token[],
  vocabulary: readonly string[],
  aliasLengthAt: AliasLengthAt,
): Token[] {
  if (vocabulary.length === 0) {
    return tokens
  }
  let out: Token[] | null = null
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    const pieces = token.type === 'word' ? cutAtVocabulary(token, vocabulary, aliasLengthAt) : null
    if (pieces) {
      out ??= tokens.slice(0, i)
      out.push(...pieces)
    } else {
      out?.push(token)
    }
  }
  return out ?? tokens
}

function cutAtVocabulary(
  token: Token,
  vocabulary: readonly string[],
  aliasLengthAt: AliasLengthAt,
): Token[] | null {
  // A token that IS a grammar word stays whole: `不超过` must not be cut into
  // `不` + the `超过` nested inside it.
  if (token.text.length < 2 || isLetter(token.text[0]!) || vocabulary.includes(token.text)) {
    return null
  }
  const cuts: number[] = []
  for (let at = 0; at < token.text.length; ) {
    const hit = vocabulary.find(
      (word) => word.length <= token.text.length - at && token.text.startsWith(word, at),
    )
    // A unit alias is a word too: never cut inside one, or `一時間半` loses its
    // hour to the `間` that Japanese also uses as a range word.
    const alias = aliasLengthAt(token.start + at)
    if (hit && hit.length >= alias) {
      cuts.push(at, at + hit.length)
      at += hit.length
    } else {
      at += Math.max(alias, 1)
    }
  }
  if (cuts.length === 0) {
    return null
  }
  const bounds = [...new Set([0, ...cuts, token.text.length])].sort((a, b) => a - b)
  const pieces: Token[] = []
  for (let i = 1; i < bounds.length; i++) {
    const from = bounds[i - 1]!
    const to = bounds[i]!
    pieces.push({
      type: 'word',
      text: token.text.slice(from, to),
      start: token.start + from,
      end: token.start + to,
      spaceBefore: i === 1 ? token.spaceBefore : false,
    })
  }
  return pieces
}

function sameOriginFraction(n: Normalized, i: number): boolean {
  if (n.start.length === 0) {
    return false
  }
  const { text, start } = n
  const origin = start[i]
  if (origin === undefined) {
    return false
  }
  // Walk the same-origin run and check it matches d+ '/' d+.
  let j = i
  while (j > 0 && start[j - 1] === origin) {
    j--
  }
  let end = i
  while (end < text.length && start[end] === origin) {
    end++
  }
  if (end - j < 3) {
    return false
  }
  const slice = text.slice(j, end)
  return /^[0-9]+\/[0-9]+$/.test(slice)
}
