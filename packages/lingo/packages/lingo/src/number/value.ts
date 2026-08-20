import { makeIssue } from '../core/errors'
import type { Kind, LingoIssue, NumberFormatPolicy } from '../core/types'
import type { LanguageProfile } from '../locale/types'
import type { Normalized } from '../parse/normalize'
import { toSourceSpan } from '../parse/normalize'
import type { Token } from '../parse/tokenize'
import { parseAndFractionTail, parseNumberWords } from './words'

/**
 * Numeric value expressions (plan 002): literals with separator policy,
 * fractions (ASCII, unicode, mixed), scientific notation, number words,
 * fuzzy amounts, suffix multipliers.
 */

export interface ValueCtx {
  kind?: Kind
  n: Normalized
  /**
   * Inside "between A and B" the and-word belongs to the range, so the A-side
   * must not read it as number composition ("between one thousand and two
   * thousand").
   */
  noAnd?: boolean
  numberFormat: NumberFormatPolicy
  numberWords?: boolean
  profile?: LanguageProfile
  /** Original source (superscript-exponent detection reads it). */
  src: string
  tokens: Token[]
}

export interface ValueNode {
  /** Alternative reading for ambiguous separators (already a full value). */
  altValue?: number
  approximate?: boolean
  end: number
  issues: LingoIssue[]
  /** 'an hour' — only valid if a unit follows. */
  needsUnit?: boolean
  /** Token index just past the value. */
  next: number
  spread?: [number, number]
  /** Normalized-text span. */
  start: number
  value: number
}

const isSep = (t: Token | undefined, ch: string): boolean =>
  !!t && t.type === 'sym' && t.text === ch && !t.spaceBefore

const attached = (t: Token | undefined): boolean => !!t && !t.spaceBefore

export function parseValue(ctx: ValueCtx, i: number, atStart = false): ValueNode | null {
  const { tokens } = ctx
  const t = tokens[i]
  if (!t) {
    return null
  }

  // Sign.
  if (t.type === 'sym' && (t.text === '-' || t.text === '+')) {
    const next = tokens[i + 1]
    const signOk = next && (!next.spaceBefore || atStart)
    if (!signOk) {
      return null
    }
    const inner = parseValue(ctx, i + 1)
    if (!inner || inner.needsUnit) {
      return null
    }
    const sign = t.text === '-' ? -1 : 1
    return {
      ...inner,
      value: sign * inner.value,
      spread: inner.spread && sign === -1 ? [-inner.spread[1], -inner.spread[0]] : inner.spread,
      start: t.start,
    }
  }

  // Leading dot: ".5"
  if (t.type === 'sym' && t.text === '.' && isDigits(tokens[i + 1]) && attached(tokens[i + 1])) {
    const digits = tokens[i + 1]!
    const node: ValueNode = {
      value: Number(`0.${digits.text}`),
      next: i + 2,
      start: t.start,
      end: digits.end,
      issues: [],
    }
    return withNumericTails(ctx, withWordTail(ctx, node))
  }

  // Vulgar fraction alone ("½ cup").
  if (t.type === 'vulgar') {
    return withWordTail(ctx, {
      value: t.num! / t.den!,
      next: i + 1,
      start: t.start,
      end: t.end,
      issues: [],
    })
  }

  if (t.type === 'digits') {
    const node = assembleNumeric(ctx, i)
    return node ? withNumericTails(ctx, withFractionTail(ctx, node)) : null
  }

  if (t.type === 'word') {
    if (ctx.numberWords === false) {
      return null
    }
    // Word sign before a non-word numeric literal: "minus 5 kg", "negative 5".
    // Spelled negation ("minus five") stays inside parseNumberWords below.
    const lower = t.text.toLowerCase()
    if ((lower === 'minus' || lower === 'negative') && tokens[i + 1]?.type !== 'word') {
      const inner = parseValue(ctx, i + 1)
      if (inner && !inner.needsUnit) {
        return {
          ...inner,
          value: -inner.value,
          spread: inner.spread ? [-inner.spread[1], -inner.spread[0]] : inner.spread,
          start: t.start,
        }
      }
    }
    const wn = parseNumberWords(tokens, i, ctx.profile?.numberWords, ctx.noAnd)
    if (!wn) {
      return null
    }
    const last = tokens[wn.next - 1]!
    const node: ValueNode = {
      value: wn.value,
      next: wn.next,
      start: t.start,
      end: last.end,
      issues: [],
    }
    if (wn.approximate) {
      node.approximate = true
    }
    if (wn.spread) {
      node.spread = wn.spread
    }
    if (wn.needsUnit) {
      node.needsUnit = true
    }
    return node
  }

  return null
}

function isDigits(t: Token | undefined): t is Token {
  return !!t && t.type === 'digits'
}

/**
 * Assemble digits + separators into a number per the separator policy
 * (plan 002). Handles grouped forms, decimal comma/dot, space grouping,
 * multipliers (k / bn — suppressed for temperature where K means kelvin).
 */
function assembleNumeric(ctx: ValueCtx, i: number): ValueNode | null {
  const { tokens } = ctx
  const first = tokens[i]!
  const issues: LingoIssue[] = []

  // Collect the chain: digits (sep digits)* with no spaces around seps.
  const groups: string[] = [first.text]
  const seps: string[] = []
  let pos = i + 1
  while (
    tokens[pos] &&
    tokens[pos]!.type === 'sym' &&
    (tokens[pos]!.text === ',' || tokens[pos]!.text === '.') &&
    !tokens[pos]!.spaceBefore &&
    isDigits(tokens[pos + 1]) &&
    attached(tokens[pos + 1])
  ) {
    seps.push(tokens[pos]!.text)
    groups.push(tokens[pos + 1]!.text)
    pos += 2
  }

  // Space grouping: "1 234 567" (all follow-on groups exactly 3 digits).
  if (seps.length === 0 && groups[0]!.length <= 3) {
    let spacePos = pos
    const spaceGroups: string[] = []
    while (
      isDigits(tokens[spacePos]) &&
      tokens[spacePos]!.spaceBefore &&
      tokens[spacePos]!.text.length === 3
    ) {
      spaceGroups.push(tokens[spacePos]!.text)
      spacePos++
    }
    // Require the run to end cleanly (not "5 100 more digits…" mid-run).
    if (spaceGroups.length > 0 && !(isDigits(tokens[spacePos]) && tokens[spacePos]!.spaceBefore)) {
      const intPart = groups[0]! + spaceGroups.join('')
      let value = Number(intPart)
      // Optional decimal after space groups: "1 234,56" / "1 234.56"
      if (
        tokens[spacePos] &&
        tokens[spacePos]!.type === 'sym' &&
        (tokens[spacePos]!.text === ',' || tokens[spacePos]!.text === '.') &&
        !tokens[spacePos]!.spaceBefore &&
        isDigits(tokens[spacePos + 1]) &&
        attached(tokens[spacePos + 1])
      ) {
        value = Number(`${intPart}.${tokens[spacePos + 1]!.text}`)
        spacePos += 2
      }
      if (Number.isInteger(value) && value > Number.MAX_SAFE_INTEGER) {
        value = Number.POSITIVE_INFINITY
      }
      const last = tokens[spacePos - 1]!
      return guardFinite(ctx, { value, next: spacePos, start: first.start, end: last.end, issues })
    }
  }

  const last = tokens[pos - 1]!
  const span: ValueNode = { value: 0, next: pos, start: first.start, end: last.end, issues }
  const text = (): string => renderChain(groups, seps)

  if (seps.length === 0) {
    span.value = Number(groups[0])
    if (span.value > Number.MAX_SAFE_INTEGER) {
      span.value = Number.POSITIVE_INFINITY
    }
    return guardFinite(ctx, span)
  }

  const distinct = new Set(seps)
  if (distinct.size === 2) {
    // Both separators: the LAST one is the decimal.
    const decimal = seps[seps.length - 1]!
    const groupSep = decimal === '.' ? ',' : '.'
    for (let s = 0; s < seps.length - 1; s++) {
      if (seps[s] !== groupSep) {
        issues.push(numberFormatIssue(ctx, span, text()))
        return span
      }
    }
    if (!validGroups(groups.slice(0, -1), false)) {
      issues.push(numberFormatIssue(ctx, span, text()))
      return span
    }
    span.value = Number(`${groups.slice(0, -1).join('')}.${groups[groups.length - 1]}`)
    return guardFinite(ctx, span)
  }

  const sep = seps[0]!
  if (seps.length > 1) {
    // Repeated single separator ⇒ grouping ("1.234.567", "12,34,567").
    if (!validGroups(groups, sep === ',')) {
      issues.push(numberFormatIssue(ctx, span, text()))
      return span
    }
    span.value = Number(groups.join(''))
    if (span.value > Number.MAX_SAFE_INTEGER) {
      span.value = Number.POSITIVE_INFINITY
    }
    return guardFinite(ctx, span)
  }

  // Single separator, single occurrence — the ambiguous zone.
  const tail = groups[1]!
  const decimalRead = Number(`${groups[0]}.${tail}`)
  const groupedRead = Number(groups[0]! + tail)
  const groupable = tail.length === 3 && groups[0]!.length <= 3 && groups[0]![0] !== '0'
  const policy = ctx.numberFormat

  const decide = (preferDecimal: boolean, ambiguous: boolean): void => {
    span.value = preferDecimal ? decimalRead : groupedRead
    if (ambiguous) {
      span.altValue = preferDecimal ? groupedRead : decimalRead
      issues.push(
        makeIssue(
          'AMBIGUOUS_NUMBER',
          { text: text(), a: String(span.value), b: String(span.altValue) },
          toSourceSpan(ctx.n, span.start, span.end),
        ),
      )
    }
  }

  if (!groupable) {
    // "1,23" / "1.2345" / "0,5" — grouping impossible, must be a decimal.
    decide(true, false)
  } else if (policy === 'dot-decimal') {
    decide(sep === '.', false)
  } else if (policy === 'comma-decimal') {
    decide(sep === ',', false)
  } else {
    // auto: dot reads as decimal, comma reads as grouping; both flagged.
    decide(sep === '.', true)
  }
  return guardFinite(ctx, span)
}

function renderChain(groups: string[], seps: string[]): string {
  let out = groups[0]!
  for (let k = 0; k < seps.length; k++) {
    out += seps[k]! + groups[k + 1]!
  }
  return out
}

function numberFormatIssue(ctx: ValueCtx, span: ValueNode, text: string): LingoIssue {
  return makeIssue('NUMBER_FORMAT', { text }, toSourceSpan(ctx.n, span.start, span.end))
}

/** Internal groups must be exactly 3 digits (Indian 2s allowed for comma). */
function validGroups(groups: string[], allowIndian: boolean): boolean {
  const inner = groups.slice(1)
  if (groups[0]!.length === 0 || groups[0]!.length > 3) {
    return false
  }
  if (inner.every((g) => g.length === 3)) {
    return true
  }
  if (allowIndian && groups[0]!.length <= 2) {
    const lastOk = inner[inner.length - 1]!.length === 3
    const middleOk = inner.slice(0, -1).every((g) => g.length === 2)
    return lastOk && middleOk && inner.length >= 1
  }
  return false
}

/** Mixed fractions: "1 1/2", "2-3/4", "1½"; standalone "3/4" via digits path. */
function withFractionTail(ctx: ValueCtx, node: ValueNode): ValueNode {
  const { tokens } = ctx
  if (node.issues.length > 0) {
    return node
  }
  if (!Number.isInteger(node.value) || node.value < 0) {
    return maybePlainFraction(ctx, node)
  }

  let pos = node.next
  let joiner = false
  const sym = tokens[pos]
  // lumber style "2-3/4" — only if a fraction follows attached
  if (
    sym &&
    sym.type === 'sym' &&
    sym.text === '-' &&
    !sym.spaceBefore &&
    isFractionAt(ctx, pos + 1, false)
  ) {
    pos++
    joiner = true
  }
  const t = tokens[pos]
  if (t?.type === 'vulgar') {
    node.value += t.num! / t.den!
    node.next = pos + 1
    node.end = t.end
    return node
  }
  if (isFractionAt(ctx, pos, !joiner)) {
    const num = Number(tokens[pos]!.text)
    const den = Number(tokens[pos + 2]!.text)
    node.value += num / den
    node.next = pos + 3
    node.end = tokens[pos + 2]!.end
    return node
  }
  return maybePlainFraction(ctx, node)
}

/** "3/4" where the leading digits themselves are the numerator. */
function maybePlainFraction(ctx: ValueCtx, node: ValueNode): ValueNode {
  const { tokens } = ctx
  const slash = tokens[node.next]
  const den = tokens[node.next + 1]
  if (
    isSep(slash, '/') &&
    isDigits(den) &&
    attached(den) &&
    Number.isInteger(node.value) &&
    node.value >= 0 &&
    fractionDenOk(den.text) &&
    !isSep(tokens[node.next + 2], '/') // "5/3/2026" is a date, not a fraction
  ) {
    node.value = node.value / Number(den.text)
    node.next = node.next + 2
    node.end = den.end
  }
  return node
}

function isFractionAt(ctx: ValueCtx, pos: number, needSpace: boolean): boolean {
  const { tokens } = ctx
  const num = tokens[pos]
  const slash = tokens[pos + 1]
  const den = tokens[pos + 2]
  if (!(isDigits(num) && isSep(slash, '/') && isDigits(den) && attached(den))) {
    return false
  }
  if (needSpace && !num.spaceBefore) {
    return false
  }
  if (isSep(tokens[pos + 3], '/')) {
    return false // date-like
  }
  return fractionDenOk(den.text) && num.text.length <= 2
}

function fractionDenOk(den: string): boolean {
  const d = Number(den)
  return d >= 2 && d <= 64
}

/**
 * Tails that extend an assembled numeric: scientific/×10^n exponents (which
 * return early — an exponent excludes further tails), suffix multipliers
 * (70k, 1.5bn; suppressed for temperature where K means kelvin), and word
 * tails ("2 and a half").
 */
function withNumericTails(ctx: ValueCtx, node: ValueNode): ValueNode {
  const { tokens } = ctx

  // Exponent detection runs BEFORE the issue bail-out: an exponent immediately
  // following a digit.digitdigitdigit coefficient disambiguates it as decimal
  // (not thousands-grouped), so any AMBIGUOUS_NUMBER issue is cleared.
  const eTok = tokens[node.next]
  if (
    eTok &&
    eTok.type === 'word' &&
    (eTok.text === 'e' || eTok.text === 'E') &&
    !eTok.spaceBefore
  ) {
    let pos = node.next + 1
    let sign = 1
    if (tokens[pos] && tokens[pos]!.type === 'sym' && !tokens[pos]!.spaceBefore) {
      if (tokens[pos]!.text === '-') {
        sign = -1
        pos++
      } else if (tokens[pos]!.text === '+') {
        pos++
      }
    }
    if (isDigits(tokens[pos]) && attached(tokens[pos])) {
      node.value = node.value * 10 ** (sign * Number(tokens[pos]!.text))
      node.next = pos + 1
      node.end = tokens[pos]!.end
      node.issues = []
      node.altValue = undefined
      return guardFinite(ctx, node)
    }
  }

  // "3 × 10^5" / "3x10^5" / "3×10⁵" (superscripts detected via source map).
  const times = tokens[node.next]
  const isTimes =
    times &&
    ((times.type === 'sym' && (times.text === '×' || times.text === '*')) ||
      (times.type === 'word' && times.text.toLowerCase() === 'x'))
  if (isTimes) {
    const tenTok = tokens[node.next + 1]
    if (isDigits(tenTok) && tenTok.text.startsWith('10')) {
      if (tenTok.text === '10') {
        const mark = tokens[node.next + 2]
        let pos = node.next + 3
        let sign = 0
        if (mark?.type === 'sym' && mark.text === '^') {
          sign = 1
          if (tokens[pos]?.type === 'sym' && tokens[pos]!.text === '-') {
            sign = -1
            pos++
          }
        } else if (mark?.type === 'sym' && !mark.spaceBefore) {
          sign =
            ctx.src[ctx.n.start[mark.start]!] === '⁻'
              ? -1
              : ctx.src[ctx.n.start[mark.start]!] === '⁺'
                ? 1
                : 0
        }
        if (sign && isDigits(tokens[pos])) {
          node.value *= 10 ** (sign * Number(tokens[pos]!.text))
          node.next = pos + 1
          node.end = tokens[pos]!.end
          node.issues = []
          node.altValue = undefined
          return guardFinite(ctx, node)
        }
      }
      // superscript exponent folded into the digits token ("105" from 10⁵)
      if (tenTok.text.length > 2) {
        const expStart = tenTok.start + 2
        if (
          /^[⁰¹²³⁴⁵⁶⁷⁸⁹]+$/.test(ctx.src.slice(ctx.n.start[expStart], ctx.n.end[tenTok.end - 1]))
        ) {
          const exp = Number(tenTok.text.slice(2))
          node.value *= 10 ** exp
          node.next = node.next + 2
          node.end = tenTok.end
          node.issues = []
          node.altValue = undefined
          return guardFinite(ctx, node)
        }
      }
    }
  }

  if (node.issues.length > 0) {
    return node
  }

  // Suffix multipliers: 70k, 1.5bn (never for temperature — 5K is kelvin).
  const suffix = tokens[node.next]
  if (suffix && suffix.type === 'word' && !suffix.spaceBefore && ctx.kind !== 'temperature') {
    if (suffix.text === 'k' || suffix.text === 'K') {
      node.value *= 1e3
      node.next += 1
      node.end = suffix.end
    } else if (suffix.text.toLowerCase() === 'bn') {
      node.value *= 1e9
      node.next += 1
      node.end = suffix.end
    }
  }

  return guardFinite(ctx, withWordTail(ctx, node))
}

function withWordTail(ctx: ValueCtx, node: ValueNode): ValueNode {
  const tail = parseAndFractionTail(ctx.tokens, node.next, ctx.profile?.numberWords)
  if (tail) {
    node.value += tail.add
    node.next = tail.next
    node.end = ctx.tokens[tail.next - 1]!.end
  }
  return node
}

function guardFinite(ctx: ValueCtx, node: ValueNode): ValueNode {
  if (!Number.isFinite(node.value)) {
    node.issues.push(makeIssue('NONFINITE', {}, toSourceSpan(ctx.n, node.start, node.end)))
  }
  return node
}
