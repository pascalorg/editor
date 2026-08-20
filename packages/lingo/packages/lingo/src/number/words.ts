import { EN_NUMBER_WORDS } from '../locale/en-core'
import type { NumberWordTables } from '../locale/types'
import type { Token } from '../parse/tokenize'

/**
 * English number words (plan 002). All vocabulary lives in data so locale
 * packs can swap it (plan 013). The parser walks the token stream directly —
 * hyphenated compounds arrive as word/sym/word triples.
 */

export interface WordNumberResult {
  approximate?: boolean
  /**
   * 'a'/'an' alone ("an hour") — callers must require a following unit.
   * 'half a'/'half an' sets this too ("half an hour").
   */
  needsUnit?: boolean
  /** Token index just past the consumed words. */
  next: number
  spread?: [number, number]
  value: number
}

const word = (t: Token | undefined): string | null =>
  t && t.type === 'word' ? t.text.toLowerCase() : null

/**
 * Parse a number-word expression starting at token `i`.
 * Handles: one…nineteen, tens (+ hyphen/space ones), scales with optional
 * 'and', 'a'/'an' (needsUnit), 'a hundred', minus/negative, half/quarter
 * forms, 'X and a half', dozen forms, fuzzy amounts ('a few').
 */
export function parseNumberWords(
  tokens: Token[],
  i: number,
  tables: NumberWordTables = EN_NUMBER_WORDS,
  noAnd = false,
): WordNumberResult | null {
  let pos = i
  let negative = false
  const w0 = word(tokens[pos])
  if (w0 && tables.negativeWords.has(w0)) {
    negative = true
    pos++
  }

  const result = parseCore(tokens, pos, tables, noAnd)
  if (!result) {
    return null
  }
  if (negative) {
    result.value = -result.value
    if (result.spread) {
      result.spread = [-result.spread[1], -result.spread[0]]
    }
  }
  return result
}

function parseCore(
  tokens: Token[],
  i: number,
  tables: NumberWordTables,
  noAnd: boolean,
): WordNumberResult | null {
  const pos = i
  const w = word(tokens[pos])
  if (w === null) {
    return null
  }

  // "a"/"an" — one, but only meaningful before a scale, dozen/fraction, or unit.
  if (tables.articles.has(w)) {
    const nextW = word(tokens[pos + 1])
    if (nextW && tables.scales[nextW] !== undefined) {
      return finishScaled(tokens, pos + 1, 1, tables, noAnd)
    }
    if (nextW && tables.dozenWords.has(nextW)) {
      return withHalfDozenTail(tokens, pos + 2, 12, tables)
    }
    if (nextW && tables.fuzzyAmounts[nextW]) {
      const fuzz = tables.fuzzyAmounts[nextW]!
      let next = pos + 2
      const ofWord = word(tokens[next])
      if (ofWord && tables.ofWords.has(ofWord)) {
        next++
      }
      return { value: fuzz.value, next, approximate: true, spread: fuzz.spread }
    }
    if (nextW && tables.fractionWords[nextW] !== undefined) {
      // "a half", "a quarter", "a quarter of a mile", "a third of an hour"
      return fractionOfTail(tokens, tables.fractionWords[nextW]!, pos + 2, tables)
    }
    return { value: 1, next: pos + 1, needsUnit: true }
  }

  // "half" / "half a(n)" / "half a dozen"
  if (tables.fractionWords[w] === 1 / 2) {
    const nextW = word(tokens[pos + 1])
    if (nextW && tables.articles.has(nextW)) {
      const afterArticle = word(tokens[pos + 2])
      if (afterArticle && tables.dozenWords.has(afterArticle)) {
        return withHalfDozenTail(tokens, pos + 3, 6, tables)
      }
      return { value: 0.5, next: pos + 2, needsUnit: true }
    }
    return { value: tables.fractionWords[w]!, next: pos + 1 }
  }

  // "dozens of"
  if (tables.fuzzyAmounts[w]) {
    let next = pos + 1
    const ofWord = word(tokens[next])
    if (ofWord && tables.ofWords.has(ofWord)) {
      next++
    }
    const fuzz = tables.fuzzyAmounts[w]!
    return { value: fuzz.value, next, approximate: true, spread: fuzz.spread }
  }

  // Fraction lead: "three quarters (of)"
  const lead = tables.ones[w] ?? tables.tens[w]
  if (lead !== undefined) {
    const nextW = word(tokens[pos + 1])
    if (nextW && tables.fractionWords[nextW] !== undefined && lead >= 1 && lead <= 99) {
      // "two thirds", "three quarters", "two thirds of a meter"
      return fractionOfTail(tokens, lead * tables.fractionWords[nextW]!, pos + 2, tables)
    }
  }

  // Composed table: longest-match phrase lookup (quinientos, quatre-vingt-dix, etc.)
  const comp = tryComposed(tokens, pos, tables)
  if (comp) {
    return cardinalLoop(tokens, comp.next, 0, comp.value, true, tables, noAnd)
  }

  // Bare scale words: "cien gramos", "mil metros". A thousand and up seeds the
  // total so a following hundreds group stays its own term ("mille cinq
  // cents" = 1000 + 500, not 1005 × 100).
  const bare = tables.bareScales?.[w]
  if (bare !== undefined) {
    const next = eatAndLink(tokens, pos + 1, tables, noAnd)
    return bare >= 1000
      ? cardinalLoop(tokens, next, bare, 0, true, tables, noAnd)
      : cardinalLoop(tokens, next, 0, bare, true, tables, noAnd)
  }

  // Standard cardinal grammar.
  return cardinalLoop(tokens, pos, 0, 0, false, tables, noAnd)
}

/** Longest-match against composed table; hyphens transparent. */
function tryComposed(
  tokens: Token[],
  pos: number,
  tables: NumberWordTables,
): { next: number; value: number } | null {
  const c = tables.composed
  if (!c) {
    return null
  }
  let best: number | undefined
  let bestNext = pos
  let key = ''
  let scan = pos
  let end = pos
  while (scan < tokens.length) {
    const t = tokens[scan]!
    if (t.type === 'word') {
      key = key ? `${key} ${t.text.toLowerCase()}` : t.text.toLowerCase()
      end = ++scan
    } else if (t.type === 'sym' && t.text === '-' && word(tokens[scan + 1]) !== null) {
      scan++
      continue
    } else {
      break
    }
    if (c[key] !== undefined) {
      best = c[key]!
      bestNext = end
    }
  }
  return best === undefined ? null : { value: best, next: bestNext }
}

function cardinalLoop(
  tokens: Token[],
  startPos: number,
  total: number,
  current: number,
  any: boolean,
  tables: NumberWordTables,
  noAnd: boolean,
): WordNumberResult | null {
  let pos = startPos
  let t_ = total
  let c_ = current
  let dozen = false
  while (pos < tokens.length) {
    const tw = word(tokens[pos])
    if (tw === null) {
      break
    }

    if (any && tables.composed) {
      const m = tryComposed(tokens, pos, tables)
      if (m) {
        c_ += m.value
        pos = m.next
        continue
      }
    }
    if (tables.ones[tw] !== undefined) {
      c_ += tables.ones[tw]!
      pos++
      any = true
      continue
    }
    if (tables.tens[tw] !== undefined) {
      c_ += tables.tens[tw]!
      pos++
      any = true
      // hyphen+ones OR and-word+ones after tens
      const nxt = tokens[pos]
      const skip =
        nxt && nxt.type === 'sym' && nxt.text === '-'
          ? 1
          : !noAnd && word(tokens[pos]) && tables.andWords.has(word(tokens[pos])!)
            ? 1
            : 0
      if (skip) {
        const o = word(tokens[pos + skip])
        if (o && tables.ones[o] !== undefined && tables.ones[o]! < 10) {
          c_ += tables.ones[o]!
          pos += skip + 1
        }
      }
      continue
    }
    if (tables.dozenWords.has(tw) && any) {
      c_ *= 12
      dozen = true
      pos++
      continue
    }
    if (tables.scales[tw] !== undefined && any) {
      const scale = tables.scales[tw]!
      if (scale === 100) {
        // Hundreds multiply only the 1..99 group in front of them; anything
        // already accumulated above that is a separate term.
        const group = c_ % 100
        c_ += group === 0 ? 100 : group * 99
      } else if (c_ === 0 && t_ > 0 && t_ < scale) {
        // Scale chaining: "mil millones" (10^9), "dos mil millones" — the
        // smaller scale already banked in the total is the multiplicand.
        t_ *= scale
      } else {
        t_ += (c_ === 0 ? 1 : c_) * scale
        c_ = 0
      }
      pos = eatAndLink(tokens, eatScaleLink(tokens, pos + 1, scale, tables), tables, noAnd)
      continue
    }
    break
  }
  if (!any) {
    return null
  }
  let value = t_ + c_

  // Spoken decimal separator — parse post-decimal as digit sequence
  if (tables.decimalWords) {
    const dw = word(tokens[pos])
    if (dw && tables.decimalWords.has(dw)) {
      let d = ''
      let dp = pos + 1
      while (dp < tokens.length) {
        const tw = word(tokens[dp])
        if (!tw) {
          break
        }
        const v = tables.ones[tw]
        if (v !== undefined && v <= 99) {
          d += String(v)
          dp++
        } else if (tables.composed) {
          const c = tryComposed(tokens, dp, tables)
          if (c && c.value <= 99) {
            d += String(c.value)
            dp = c.next
          } else {
            break
          }
        } else {
          break
        }
      }
      if (!d && tokens[pos + 1]?.type === 'digits') {
        const tx = tokens[pos + 1]!.text
        d = tx
        dp = pos + 2
      }
      if (d) {
        const frac = +d / 10 ** d.length
        return { value: value + (value < 0 ? -1 : 1) * frac, next: dp }
      }
    }
  }

  if (dozen) {
    return withHalfDozenTail(tokens, pos, value, tables)
  }
  // The fraction tail keeps the and-word even under `noAnd`: in "between five
  // and a half and ten kg" the first join builds 5.5, the second is the range.
  const tail = parseAndFractionTail(tokens, pos, tables)
  if (tail) {
    value += tail.add
    pos = tail.next
  }
  return { value, next: pos }
}

function finishScaled(
  tokens: Token[],
  scalePos: number,
  multiplier: number,
  tables: NumberWordTables,
  noAnd: boolean,
): WordNumberResult {
  const scaleWord = word(tokens[scalePos])!
  const scale = tables.scales[scaleWord]!
  const pos = eatScaleLink(tokens, scalePos + 1, scale, tables)
  // Continue into cardinalLoop to consume further composed/scale chains.
  // E.g. "un millon quinientos mil" seeds total with 1,000,000, then
  // cardinalLoop picks up "quinientos mil" (500*1000).
  return cardinalLoop(tokens, pos, multiplier * scale, 0, true, tables, noAnd)!
}

/**
 * Romance languages link big scales to the noun they count with "of": "un
 * millón de euros", "un million de kilos", "um milhão de quilos". Smaller
 * scales do not ("mil euros"), and below a million "de" is far more likely to
 * be opening a range ("de 5 a 10"), so the link is only eaten from 10^6 up and
 * only when something follows it.
 */
function eatScaleLink(
  tokens: Token[],
  pos: number,
  scale: number,
  tables: NumberWordTables,
): number {
  if (scale < 1_000_000) {
    return pos
  }
  const link = word(tokens[pos])
  return link && tables.ofWords.has(link) && word(tokens[pos + 1]) !== null ? pos + 1 : pos
}

/**
 * "two hundred and five", "mil e quinhentos", "cento e vinte" — the and-word
 * joining a scale to its remainder is punctuation. It is only skipped when a
 * plain number word follows: "and a half" belongs to the fraction tail, and a
 * following scale word ("entre cien y mil") is a range side, not a remainder.
 */
function eatAndLink(
  tokens: Token[],
  pos: number,
  tables: NumberWordTables,
  noAnd: boolean,
): number {
  const j = word(tokens[pos])
  if (noAnd || !(j && tables.andWords.has(j))) {
    return pos
  }
  const a = word(tokens[pos + 1])
  const known =
    a !== null &&
    (tables.ones[a] !== undefined ||
      tables.tens[a] !== undefined ||
      tables.composed?.[a] !== undefined)
  return known ? pos + 1 : pos
}

/**
 * After a fraction value, optionally consume a linking "of" and an "a"/"an"
 * article ("a quarter of a mile", "two thirds of a meter", "a third of an
 * hour"). When either is present the value points at a following unit, so
 * `needsUnit` is set — bare "a quarter"/"two thirds" stay plain numbers.
 */
function fractionOfTail(
  tokens: Token[],
  value: number,
  next: number,
  tables: NumberWordTables,
): WordNumberResult {
  let pos = next
  let pointsAtUnit = false
  const ofWord = word(tokens[pos])
  if (ofWord && tables.ofWords.has(ofWord)) {
    pos++
    pointsAtUnit = true
  }
  const article = word(tokens[pos])
  if (article && tables.articles.has(article)) {
    pos++
    pointsAtUnit = true
  }
  return pointsAtUnit ? { value, next: pos, needsUnit: true } : { value, next: pos }
}

/** "…dozen and a half" → +6. */
function withHalfDozenTail(
  tokens: Token[],
  pos: number,
  value: number,
  tables: NumberWordTables,
): WordNumberResult {
  if (
    word(tokens[pos]) &&
    tables.andWords.has(word(tokens[pos])!) &&
    word(tokens[pos + 1]) &&
    tables.articles.has(word(tokens[pos + 1])!) &&
    word(tokens[pos + 2]) &&
    tables.fractionWords[word(tokens[pos + 2])!] === 1 / 2
  ) {
    return { value: value + 6, next: pos + 3 }
  }
  return { value, next: pos }
}

/** "and a half" / "and a quarter" / "and three quarters" after a number. */
export function parseAndFractionTail(
  tokens: Token[],
  i: number,
  tables: NumberWordTables = EN_NUMBER_WORDS,
): { add: number; next: number } | null {
  const join = word(tokens[i])
  if (!(join && tables.andWords.has(join))) {
    return null
  }
  const pos = i + 1
  const a = word(tokens[pos])
  if (a && tables.fractionWords[a] !== undefined) {
    return { add: tables.fractionWords[a]!, next: pos + 1 }
  }
  if (a && tables.articles.has(a)) {
    const frac = word(tokens[pos + 1])
    if (frac && tables.fractionWords[frac] !== undefined) {
      return { add: tables.fractionWords[frac]!, next: pos + 2 }
    }
    return null
  }
  const count = a === null ? undefined : tables.ones[a]
  if (count !== undefined && count >= 1) {
    const frac = word(tokens[pos + 1])
    if (frac && tables.fractionWords[frac] !== undefined) {
      return { add: count * tables.fractionWords[frac]!, next: pos + 2 }
    }
  }
  return null
}
