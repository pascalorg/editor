import type { NumberWordTables } from '../locale/types'
import type { Token } from '../parse/tokenize'

export interface CjkNumberResult {
  adjacentRange?: boolean
  end: number
  sawScale: boolean
  value: number
}

export function parseCjkNumberText(text: string, tables: NumberWordTables): CjkNumberResult | null {
  if (!hasCjk(text)) {
    return null
  }
  let pos = 0
  let total = 0
  let group = 0
  let pending: number | null = null
  let lastSmall = 0
  let lastGroup = 0
  let zeroBreak = false
  let consumed = false
  let sawScale = false
  let bare: { end: number; value: number } | null = null
  let largeScaleWithoutInterveningDigit = false

  while (pos < text.length) {
    const digits = /^[0-9]+/.exec(text.slice(pos))
    if (digits) {
      pending = Number(digits[0])
      bare = null
      largeScaleWithoutInterveningDigit = false
      consumed = true
      pos += digits[0].length
      continue
    }

    const ch = text[pos]!
    if (!hasCjk(ch)) {
      break
    }
    const scale = tables.scales[ch]
    if (scale !== undefined) {
      if (scale >= 10_000) {
        if (largeScaleWithoutInterveningDigit) {
          return null
        }
        const value = finishGroup(group, pending, lastSmall, total, lastGroup, zeroBreak)
        total += (value === 0 ? 1 : value) * scale
        group = 0
        pending = null
        lastSmall = 0
        lastGroup = scale
        largeScaleWithoutInterveningDigit = true
      } else {
        group += (pending ?? 1) * scale
        pending = null
        lastSmall = scale
      }
      zeroBreak = false
      bare = null
      consumed = true
      sawScale = true
      pos++
      continue
    }

    const one = tables.ones[ch]
    if (one === 10) {
      group += (pending ?? 1) * 10
      pending = null
      lastSmall = 10
      zeroBreak = false
      bare = null
      consumed = true
      sawScale = true
      pos++
      continue
    }
    if (one === undefined || one < 0 || one > 9) {
      break
    }
    if (bare && group === 0 && total === 0 && lastSmall === 0) {
      return one === bare.value + 1 && one <= 9
        ? { value: bare.value, end: bare.end, sawScale: false, adjacentRange: true }
        : null
    }
    if (one === 0) {
      pending = 0
      zeroBreak = true
      bare = null
    } else if (pending === 0 && zeroBreak) {
      pending = one
    } else if (pending !== null && group === 0 && total === 0 && lastSmall === 0) {
      return null
    } else {
      pending = one
      zeroBreak = false
      bare = lastSmall === 0 && total === 0 && group === 0 ? { value: one, end: pos + 1 } : null
    }
    largeScaleWithoutInterveningDigit = false
    consumed = true
    pos++
  }

  return consumed
    ? {
        value: total + finishGroup(group, pending, lastSmall, total, lastGroup, zeroBreak),
        end: pos,
        sawScale,
      }
    : null
}

export function prepareCjkValueTokens(tokens: Token[], i: number, tables: NumberWordTables): void {
  const t = tokens[i]
  if (!t) {
    return
  }
  if (t.type === 'word') {
    const parsed = parseCjkNumberText(t.text, tables)
    if (parsed && parsed.end > 0) {
      splitPrefix(tokens, i, t.start + parsed.end, String(parsed.value), tables)
    }
    return
  }
  if (t.type !== 'digits') {
    return
  }
  splitHalfSuffix(tokens, i + 1, tables)
  const next = tokens[i + 1]
  if (next?.type !== 'word' || next.spaceBefore) {
    return
  }
  const parsed = parseCjkNumberText(contiguousText(tokens, i), tables)
  if (parsed?.sawScale && parsed.end > t.text.length) {
    splitPrefix(tokens, i, t.start + parsed.end, String(parsed.value), tables)
  }
}

export function consumeCjkPostUnitHalf(
  tokens: Token[],
  i: number,
  tables: NumberWordTables,
): { end: number; next: number } | null {
  const t = tokens[i]
  return t && (t.type === 'word' || t.type === 'sym') && isHalf(t.text, tables)
    ? { end: t.end, next: i + 1 }
    : null
}

function finishGroup(
  group: number,
  pending: number | null,
  lastSmall: number,
  total: number,
  lastGroup: number,
  zeroBreak: boolean,
): number {
  if (pending === null) {
    return group
  }
  if (!zeroBreak && pending > 0 && pending < 10 && lastSmall > 10) {
    return group + pending * (lastSmall / 10)
  }
  if (
    !zeroBreak &&
    pending > 0 &&
    pending < 10 &&
    group === 0 &&
    total > 0 &&
    lastGroup >= 10_000
  ) {
    return pending * (lastGroup / 10)
  }
  return group + pending
}

function splitPrefix(
  tokens: Token[],
  i: number,
  end: number,
  value: string,
  tables: NumberWordTables,
): void {
  const first = tokens[i]
  if (!first || end <= first.start) {
    return
  }
  let cursor = i
  while (tokens[cursor] && tokens[cursor]!.start < end) {
    cursor++
  }
  const pieces: Token[] = [
    { type: 'digits', text: value, start: first.start, end, spaceBefore: first.spaceBefore },
  ]
  const last = tokens[cursor - 1]
  if (last && end < last.end) {
    pushWord(pieces, last.text.slice(end - last.start), end, last.end, tables)
  }
  tokens.splice(i, cursor - i, ...pieces)
}

function splitHalfSuffix(tokens: Token[], i: number, tables: NumberWordTables): void {
  const t = tokens[i]
  if (t?.type !== 'word' || t.spaceBefore) {
    return
  }
  const pieces: Token[] = []
  pushWord(pieces, t.text, t.start, t.end, tables)
  if (pieces.length > 1) {
    tokens.splice(i, 1, ...pieces)
  }
}

function pushWord(
  out: Token[],
  text: string,
  start: number,
  end: number,
  tables: NumberWordTables,
): void {
  const half = text[text.length - 1]!
  if (text.length > 1 && isHalf(half, tables)) {
    out.push({ type: 'word', text: text.slice(0, -1), start, end: end - 1, spaceBefore: false })
    out.push({ type: 'sym', text: half, start: end - 1, end, spaceBefore: false })
  } else {
    out.push({ type: 'word', text, start, end, spaceBefore: false })
  }
}

function contiguousText(tokens: Token[], i: number): string {
  let text = ''
  for (let pos = i; tokens[pos] && (pos === i || !tokens[pos]!.spaceBefore); pos++) {
    text += tokens[pos]!.text
  }
  return text
}

function isHalf(text: string, tables: NumberWordTables): boolean {
  return hasCjk(text) && tables.fractionWords[text] === 1 / 2
}

function hasCjk(text: string): boolean {
  return /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uf900-\ufaff]/.test(text)
}
