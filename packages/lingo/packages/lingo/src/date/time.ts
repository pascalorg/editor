import type { LingoIssue } from '../core/types'
import type { DateGrain } from './parse'
import { issue, type P, trimRange } from './state'
import { parseSuffixClock } from './suffix'
import { TIME_ALIASES, type TimeAlias, UNIT_WORDS } from './vocab'
import { type DateZone, stripTrailingZone } from './zone'

export interface TimeCore {
  grain: DateGrain
  hour: number
  issues: LingoIssue[]
  minute: number
  second: number
  zone?: DateZone
}

export function parseTimeOnly(p: P, start: number, end: number): TimeCore | null {
  const { start: trimStart, end: trimEnd } = trimRange(p.text, start, end)
  if (trimStart === trimEnd) {
    return null
  }
  let source = p.text.slice(trimStart, trimEnd)
  const issues: LingoIssue[] = []
  // Detect and peel a trailing timezone. The zone is EXPOSED on the result
  // (`zone` field); `applyZone` converts to a real UTC instant, otherwise the
  // civil time is kept and a TZ_IGNORED (detected-not-applied) issue rides along.
  let zone: DateZone | undefined
  const stripped = stripTrailingZone(source, p.now)
  if (stripped && stripped.source.trim() !== '') {
    zone = { ...stripped.zone, applied: Boolean(p.opts.applyZone) }
    const zoneStart = trimEnd - zone.text.length
    if (!zone.applied) {
      issues.push(issue(p, 'TZ_IGNORED', { tz: zone.text }, zoneStart, trimEnd))
    }
    if (zone.ambiguous) {
      issues.push(issue(p, 'AMBIGUOUS_TIMEZONE', { tz: zone.text }, zoneStart, trimEnd))
    }
    source = stripped.source
  }
  const core = parseTimeCore(p, source, issues)
  if (core && zone) {
    core.zone = zone
  }
  return core
}

export function parseTimeCore(p: P, source: string, issues: LingoIssue[]): TimeCore | null {
  const lower = source.toLowerCase().replace(/^(?:at|@)\s+/, '')
  const alias = timeAliases(p)[lower]
  if (alias) {
    return aliasTime(alias, issues)
  }

  const suffixed = parseSuffixClock(p, source, issues)
  if (suffixed) {
    return suffixed
  }

  const meridiem = /^(?:(?:at|@)\s*)?(\d{1,2})(?:[:.](\d{2})(?::(\d{2}))?)?\s*(am|pm)$/i.exec(
    source,
  )
  if (meridiem) {
    let hour = Number(meridiem[1])
    if (hour < 1 || hour > 12) {
      return null
    }
    const minute = meridiem[2] === undefined ? 0 : Number(meridiem[2])
    const second = meridiem[3] === undefined ? 0 : Number(meridiem[3])
    if (minute > 59 || second > 59) {
      return null
    }
    const pm = meridiem[4]!.toLowerCase() === 'pm'
    if (pm && hour < 12) {
      hour += 12
    }
    if (!pm && hour === 12) {
      hour = 0
    }
    return {
      hour,
      minute,
      second,
      grain: meridiem[3] ? 'second' : meridiem[2] ? 'minute' : 'hour',
      issues,
    }
  }
  const clock = /^(?:(?:at|@)\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(source)
  if (clock) {
    const hour = Number(clock[1])
    const minute = Number(clock[2])
    const second = clock[3] === undefined ? 0 : Number(clock[3])
    if (hour > 23 || minute > 59 || second > 59) {
      return null
    }
    return { hour, minute, second, grain: clock[3] ? 'second' : 'minute', issues }
  }
  const hClock = /^(?:(?:at|@)\s*)?(\d{1,2})h(\d{2})?$/i.exec(source)
  if (hClock) {
    const hour = Number(hClock[1])
    const minute = hClock[2] === undefined ? 0 : Number(hClock[2])
    if (hour > 23 || minute > 59) {
      return null
    }
    // Bare "17h" is grain hour; "17h30" is grain minute.
    return { hour, minute, second: 0, grain: hClock[2] === undefined ? 'hour' : 'minute', issues }
  }
  // 24-hour dot separator, unambiguous only when hour ≥ 13 ("17.30"); bare
  // "5.30" stays a decimal (Codex: never reinterpret it as a time).
  const dotClock = /^(?:(?:at|@)\s*)?(1\d|2[0-3])\.(\d{2})$/.exec(source)
  if (dotClock) {
    const hour = Number(dotClock[1])
    const minute = Number(dotClock[2])
    if (minute > 59) {
      return null
    }
    return { hour, minute, second: 0, grain: 'minute', issues }
  }
  // "5 o'clock", "5 o'clock pm".
  const oclock = /^(?:(?:at|@)\s*)?(\d{1,2})\s*o'?clock(?:\s*(am|pm))?$/i.exec(source)
  if (oclock) {
    let hour = Number(oclock[1])
    if (hour < 1 || hour > 12) {
      return null
    }
    const mer = oclock[2]?.toLowerCase()
    if (mer === 'pm' && hour < 12) {
      hour += 12
    }
    if (mer === 'am' && hour === 12) {
      hour = 0
    }
    return { hour, minute: 0, second: 0, grain: 'hour', issues }
  }
  // Military "0900 hours", "1730 hrs" — REQUIRE the suffix so bare 4-digit
  // numbers (years/counts) are never read as times.
  const military = /^(\d{1,2})(\d{2})\s*(?:hours|hrs|hr)$/i.exec(source)
  if (military) {
    const hour = Number(military[1])
    const minute = Number(military[2])
    if (hour > 23 || minute > 59) {
      return null
    }
    return { hour, minute, second: 0, grain: 'minute', issues }
  }
  const relative = parseRelativeMinutes(p, lower, issues)
  if (relative) {
    return relative
  }
  const phrase = /^(?:(?:at|@)\s*)?(\d{1,2})\s+in\s+the\s+(morning|afternoon|evening|night)$/i.exec(
    source,
  )
  if (phrase) {
    let hour = Number(phrase[1])
    if (hour < 1 || hour > 12) {
      return null
    }
    const part = phrase[2]!.toLowerCase()
    if ((part === 'afternoon' || part === 'evening' || part === 'night') && hour < 12) {
      hour += 12
    }
    if (part === 'morning' && hour === 12) {
      hour = 0
    }
    return { hour, minute: 0, second: 0, grain: 'hour', issues }
  }
  return null
}

function timeAliases(p: P): Record<string, TimeAlias> {
  return p.profile.date?.timeAliases ?? TIME_ALIASES
}

function aliasTime(alias: TimeAlias, issues: LingoIssue[]): TimeCore {
  return {
    hour: alias.hour,
    minute: alias.minute ?? 0,
    second: alias.second ?? 0,
    grain: alias.grain ?? 'hour',
    issues,
  }
}

const EN_CLOCK_MINUTES = { half: 30, quarter: 15 }
const EN_CLOCK_PAST = ['past', 'after']
const EN_CLOCK_TO = ['to', 'till', 'til', 'before', 'of']

interface ClockRead {
  digit?: boolean
  next: number
  value: number
}

function parseRelativeMinutes(p: P, lower: string, issues: LingoIssue[]): TimeCore | null {
  const words = lower.split(/\s+/).filter(Boolean)
  const pos = skipClockFillers(p, words, 0)
  const first = words[pos]
  if (first && clockMinuteWords(p)[first] === 30) {
    const hour = readClockHour(p, words, pos + 1)
    if (hour && atEnd(p, words, hour.next)) {
      return clock(hour.value, 30, issues)
    }
  }

  const minute = readClockMinute(p, words, pos)
  if (minute) {
    const past = readPhrase(words, minute.next, clockPastWords(p))
    if (past >= 0) {
      const hour = readClockHour(p, words, past)
      if (hour && atEnd(p, words, hour.next)) {
        return clock(hour.value, minute.value, issues)
      }
    }
    const to = readPhrase(words, minute.next, clockToWords(p))
    if (to >= 0 && !minute.digit) {
      const hour = readClockHour(p, words, to)
      if (hour && atEnd(p, words, hour.next)) {
        return clock((hour.value + 23) % 24, 60 - minute.value, issues)
      }
    }
  }

  const hour = readClockHour(p, words, pos)
  if (!hour) {
    return null
  }
  const next = skipHourUnit(p, words, hour.next)
  if (words[next] === "o'clock" || words[next] === 'oclock') {
    return atEnd(p, words, next + 1) ? clock(hour.value, 0, issues, 'hour') : null
  }
  const past = readPhrase(words, next, clockPastWords(p))
  if (past >= 0) {
    const amount = readClockMinute(p, words, past)
    return amount && atEnd(p, words, amount.next) ? clock(hour.value, amount.value, issues) : null
  }
  const to = readPhrase(words, next, clockToWords(p))
  if (to >= 0) {
    const amount = readClockMinute(p, words, to)
    return amount && !amount.digit && atEnd(p, words, amount.next)
      ? clock((hour.value + 23) % 24, 60 - amount.value, issues)
      : null
  }
  if (next > hour.next) {
    const amount = readClockMinute(p, words, next)
    if (amount && atEnd(p, words, amount.next)) {
      return clock(hour.value, amount.value, issues)
    }
  }
  return null
}

function clock(
  hour: number,
  minute: number,
  issues: LingoIssue[],
  grain: TimeCore['grain'] = 'minute',
): TimeCore {
  return { hour: hour % 24, minute, second: 0, grain, issues }
}

function readClockMinute(p: P, words: readonly string[], pos: number): ClockRead | null {
  pos = skipClockFillers(p, words, pos)
  const named = readRecord(words, pos, clockMinuteWords(p))
  if (named && named.value >= 1 && named.value <= 59) {
    return named
  }
  const n = readClockNumber(p, words, pos, 59)
  return n && n.value >= 1 ? n : null
}

function readClockHour(p: P, words: readonly string[], pos: number): ClockRead | null {
  pos = skipClockFillers(p, words, pos)
  const alias = readAlias(p, words, pos)
  return alias ?? readClockNumber(p, words, pos, 23)
}

function readClockNumber(
  p: P,
  words: readonly string[],
  pos: number,
  max: number,
): ClockRead | null {
  const phrase = words[pos]
  const value = phrase ? clockNumber(p, phrase) : null
  return value !== null && value >= 0 && value <= max
    ? { value, next: pos + 1, digit: /^\d/.test(phrase!) }
    : null
}

function clockNumber(p: P, phrase: string): number | null {
  if (/^\d{1,2}$/.test(phrase)) {
    return Number(phrase)
  }
  const n = p.profile.numberWords
  const direct = n.composed?.[phrase] ?? n.ones[phrase] ?? n.tens[phrase]
  if (direct !== undefined) {
    return direct
  }
  const parts = phrase.split('-')
  if (parts.length === 2) {
    const ten = n.tens[parts[0]!]
    const one = n.ones[parts[1]!]
    if (ten !== undefined && one !== undefined && one < 10) {
      return ten + one
    }
  }
  return null
}

function readAlias(p: P, words: readonly string[], pos: number): ClockRead | null {
  const aliases = timeAliases(p)
  for (const key of Object.keys(aliases)) {
    const len = matchPhrase(words, pos, key)
    if (len > 0) {
      return { value: aliases[key]!.hour, next: pos + len }
    }
  }
  return null
}

function readRecord(
  words: readonly string[],
  pos: number,
  record: Record<string, number>,
): ClockRead | null {
  for (const key of Object.keys(record)) {
    const len = matchPhrase(words, pos, key)
    if (len > 0) {
      return { value: record[key]!, next: pos + len }
    }
  }
  return null
}

function readPhrase(words: readonly string[], pos: number, phrases: readonly string[]): number {
  for (const phrase of phrases) {
    const len = matchPhrase(words, pos, phrase)
    if (len > 0) {
      return pos + len
    }
  }
  return -1
}

function matchPhrase(words: readonly string[], pos: number, phrase: string): number {
  const parts = phrase.split(/\s+/)
  return parts.every((word, index) => words[pos + index] === word) ? parts.length : 0
}

function skipClockFillers(p: P, words: readonly string[], pos: number): number {
  while (words[pos] && p.profile.date?.fillerWords?.includes(words[pos]!)) {
    pos++
  }
  return pos
}

function skipHourUnit(p: P, words: readonly string[], pos: number): number {
  pos = skipClockFillers(p, words, pos)
  return dateUnitWords(p)[words[pos]!] === 'hour' ? skipClockFillers(p, words, pos + 1) : pos
}

function atEnd(p: P, words: readonly string[], pos: number): boolean {
  return skipClockFillers(p, words, pos) === words.length
}

function clockMinuteWords(p: P): Record<string, number> {
  return p.profile.date?.clockMinuteWords ?? EN_CLOCK_MINUTES
}

function clockPastWords(p: P): readonly string[] {
  return p.profile.date?.clockPastWords ?? EN_CLOCK_PAST
}

function clockToWords(p: P): readonly string[] {
  return p.profile.date?.clockToWords ?? EN_CLOCK_TO
}

function dateUnitWords(p: P): Record<string, string> {
  return p.profile.date?.unitWords ?? UNIT_WORDS
}
