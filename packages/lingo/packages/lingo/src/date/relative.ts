import type { LingoIssue } from '../core/types'
import { parseValue } from '../number/value'
import { parseAndFractionTail } from '../number/words'
import type { Token } from '../parse/tokenize'
import { monthDayCore, parseAbsolute } from './absolute'
import {
  addCalendar,
  backwardDiff,
  closestWeekdayDiff,
  dateInWeek,
  forwardDiff,
  sameDay,
  startOfDay,
  startOfWeek,
  withTime,
} from './civil'
import { readLocaleNumber } from './numeral'
import type { DateAlternative, DateGrain } from './parse'
import {
  type CoreDate,
  core,
  issue,
  knownFor,
  needsNow,
  type P,
  stripDateFillers,
  trimRange,
} from './state'
import { matchAffix, trimLeadingFillers, trimTrailingFillers } from './suffix'
import {
  type DayTimePhrase,
  DAY_OFFSETS as EN_DAY_OFFSETS,
  DAY_TIME_PHRASES as EN_DAY_TIME_PHRASES,
  MODIFIERS as EN_MODIFIERS,
  MONTHS as EN_MONTHS,
  PERIOD_WORDS as EN_PERIOD_WORDS,
  RELATIVE_WORDS as EN_RELATIVE_WORDS,
  SUBUNIT as EN_SUBUNIT,
  UNIT_WORDS as EN_UNIT_WORDS,
  WEEKDAY_NAMES as EN_WEEKDAY_NAMES,
  WEEKDAYS as EN_WEEKDAYS,
  type OffsetUnit,
  type PeriodUnit,
  type RelativeModifier,
} from './vocab'

interface OffsetPart {
  unit: OffsetUnit
  value: number
}

const EN_DAY_PART_WORDS = {
  morning: { hour: 9 },
  afternoon: { hour: 15 },
  evening: { hour: 19 },
  night: { hour: 21 },
}

const EN_WEEKDAY_OFFSET_PHRASES = {
  'a week on': 7,
  'a week': 7,
  fortnight: 14,
  'week on': 7,
  week: 7,
}

const RELATIVE_MODIFIERS = ['this', 'next', 'last', 'afterNext', 'beforeLast'] as const
const PERIODS = ['week', 'month', 'year'] as const
const PERIOD_DELTAS: Record<RelativeModifier, number> = {
  this: 0,
  next: 1,
  last: -1,
  afterNext: 2,
  beforeLast: -2,
}

export function parseDateOnly(
  p: P,
  start: number,
  end: number,
  allowOffset: boolean,
): CoreDate | null {
  const { start: trimStart, end: trimEnd } = trimRange(p.text, start, end)
  if (trimStart === trimEnd) {
    return null
  }
  const source = p.text.slice(trimStart, trimEnd)
  const lower = source.toLowerCase()

  if (lower.startsWith('on ')) {
    const rest = parseDateOnly(p, trimStart + 3, trimEnd, allowOffset)
    if (rest) {
      return { ...rest, normStart: trimStart, normEnd: trimEnd }
    }
  }

  if (allowOffset) {
    const offset = parseOffset(p, trimStart, trimEnd)
    if (offset) {
      return offset
    }
  }

  const deictic = parseDeictic(p, trimStart, trimEnd)
  if (deictic) {
    return needsNow(deictic)
  }
  const weekday = parseWeekday(p, trimStart, trimEnd)
  if (weekday) {
    return needsNow(weekday)
  }
  const period = parseCalendarPeriod(p, trimStart, trimEnd)
  if (period) {
    return needsNow(period)
  }
  return parseAbsolute(p, trimStart, trimEnd)
}

function parseDeictic(p: P, start: number, end: number): CoreDate | null {
  const raw = p.text.slice(start, end).toLowerCase()
  const source = raw.endsWith('.') ? raw.slice(0, -1) : raw
  const today = startOfDay(p.now)
  const exactNow = ['now', 'right now', 'just now', 'a moment ago']
  if (exactNow.includes(source)) {
    return core(new Date(p.now.getTime()), 'second', knownFor('second'), start, end)
  }
  const dayTime = dateDayTimePhrases(p)[source]
  if (dayTime) {
    return dayTimeCore(p, today, dayTime, start, end)
  }
  const dayPart = parseDayPartCompound(p, source, today, start, end)
  if (dayPart) {
    return dayPart
  }
  const dayOffset = dateDayOffsets(p)[source]
  if (dayOffset !== undefined) {
    return core(addCalendar(today, { days: dayOffset }), 'day', knownFor('day'), start, end)
  }
  if (source === 'midnight') {
    const date = withTime(addCalendar(today, { days: p.now.getHours() > 2 ? 1 : 0 }), 0)
    const issues =
      p.now.getHours() > 2 ? [issue(p, 'UNIT_ASSUMED', { unit: 'next day' }, start, end)] : []
    return core(date, 'hour', [...knownFor('hour'), 'implied-day'], start, end, issues)
  }
  if (source === 'last night') {
    const date =
      p.now.getHours() < 6 ? withTime(today, 0) : withTime(addCalendar(today, { days: -1 }), 22)
    return core(date, 'hour', [...knownFor('hour'), 'implied-day'], start, end)
  }
  return null
}

function parseOffset(p: P, start: number, end: number): CoreDate | null {
  const first = tokenIndexAt(p, start, end)
  const last = tokenIndexBefore(p, end)
  if (first < 0 || last < first) {
    return null
  }
  const compact = parseCompactLocaleOffset(p, start, end)
  if (compact) {
    return needsNow(compact)
  }
  const pastPrefixEnd = eatPrefix(p, first, dateRelativeWords(p).pastPrefixes)
  if (pastPrefixEnd > first) {
    const parts = parseOffsetParts(p, pastPrefixEnd, last + 1)
    if (parts && parts.next === last + 1) {
      return needsNow(offsetCore(p, p.now, parts.parts, -1, start, end))
    }
  }
  if (isPrefixAt(p, first, dateRelativeWords(p).futurePrefixes)) {
    const prefixEnd = eatPrefix(p, first, dateRelativeWords(p).futurePrefixes)
    const shiftedParts = parseOffsetParts(p, prefixEnd, last + 1)
    if (shiftedParts && shiftedParts.next === last + 1) {
      return needsNow(offsetCore(p, p.now, shiftedParts.parts, 1, start, end))
    }
  }

  const parts = parseOffsetParts(p, first, last + 1)
  if (!parts) {
    return null
  }
  const nextWord = wordAt(p, parts.next)
  if (isPrefixAt(p, parts.next, dateRelativeWords(p).pastSuffixes) && parts.next === last) {
    return needsNow(offsetCore(p, p.now, parts.parts, -1, start, end))
  }
  if (nextWord === 'from' && wordAt(p, parts.next + 1) === 'now' && parts.next + 1 === last) {
    return needsNow(offsetCore(p, p.now, parts.parts, 1, start, end))
  }
  if (isPrefixAt(p, parts.next, dateRelativeWords(p).anchorWords)) {
    const anchorStart = p.tokens[parts.next + 1]?.start
    if (anchorStart === undefined) {
      return null
    }
    const anchor = parseDateOnly(p, anchorStart, end, false)
    if (anchor) {
      const date = anchor.date
      let borrowedTime = false
      if (
        !anchor.known.includes('hour') &&
        parts.parts.some(
          (part) => part.unit === 'hour' || part.unit === 'minute' || part.unit === 'second',
        )
      ) {
        date.setHours(p.now.getHours(), p.now.getMinutes())
        borrowedTime = true
      }
      const offset = offsetCore(p, date, parts.parts, 1, start, end)
      return anchor.ref || borrowedTime ? needsNow(offset) : offset
    }
  }
  return null
}

function parseOffsetParts(
  p: P,
  startToken: number,
  endToken: number,
): { parts: OffsetPart[]; next: number } | null {
  const parts: OffsetPart[] = []
  let pos = startToken
  while (pos < endToken) {
    const value = parseValue(
      {
        tokens: p.tokens,
        n: p.n,
        src: p.src,
        numberFormat: p.profile.defaults.numberFormat ?? 'auto',
        kind: 'duration',
        numberWords: true,
        profile: p.profile,
      },
      pos,
      pos === startToken,
    )
    if (!value) {
      break
    }
    const unitToken = p.tokens[value.next]
    const unit = unitFromToken(p, unitToken)
    if (!unit) {
      const previous = parts[parts.length - 1]
      const subunit = previous ? dateSubunit(p)[previous.unit] : undefined
      if (previous && subunit && value.value >= 0 && value.value < subunitLimit(subunit)) {
        parts.push({ unit: subunit, value: value.value })
        pos = value.next
        continue
      }
      break
    }
    let partValue =
      unitToken?.text.toLowerCase() === 'fortnight' ||
      unitToken?.text.toLowerCase() === 'fortnights'
        ? value.value * 2
        : value.value
    pos = value.next + 1
    const tail = parseAndFractionTail(p.tokens, pos, p.profile.numberWords)
    if (tail) {
      partValue += tail.add
      pos = tail.next
    }
    parts.push({ unit, value: partValue })
    if (isJoinWord(p, pos)) {
      pos++
      continue
    }
    if (p.tokens[pos]?.type === 'sym' && p.tokens[pos]!.text === ',') {
      pos++
      continue
    }
    if (valueStarts(p, pos)) {
      continue
    }
    break
  }
  return parts.length > 0 ? { parts, next: pos } : null
}

function offsetCore(
  p: P,
  anchor: Date,
  parts: readonly OffsetPart[],
  direction: 1 | -1,
  start: number,
  end: number,
): CoreDate {
  const totals = { years: 0, months: 0, weeks: 0, days: 0, hours: 0, minutes: 0, seconds: 0 }
  for (const part of parts) {
    const value = part.value * direction
    if (part.unit === 'year') {
      totals.years += value
    } else if (part.unit === 'month') {
      totals.months += value
    } else if (part.unit === 'week') {
      totals.weeks += value
    } else if (part.unit === 'day') {
      totals.days += value
    } else if (part.unit === 'hour') {
      totals.hours += value
    } else if (part.unit === 'minute') {
      totals.minutes += value
    } else {
      totals.seconds += value
    }
  }
  const date = addCalendar(anchor, totals)
  const grain = finestOffsetGrain(parts)
  return core(date, grain, knownFor(grain), start, end)
}

function parseWeekday(p: P, start: number, end: number): CoreDate | null {
  let source = stripDateFillers(p, p.text.slice(start, end).toLowerCase())
  const offset = extractWeekdayOffset(p, source)
  if (offset) {
    source = offset.source
  }
  const words = source.split(/\s+/)
  let modifier: 'bare' | RelativeModifier = 'bare'
  let dayWord = words[0]
  const withModifier = matchWordModifier(p, source)
  if (withModifier) {
    modifier = withModifier.modifier
    dayWord = withModifier.word
  } else if (words.length !== 1) {
    return null
  }
  if (!dayWord) {
    return null
  }
  const weekday = dateWeekdays(p)[dayWord]
  if (weekday === undefined) {
    return null
  }
  const today = startOfDay(p.now)
  const issues: LingoIssue[] = []
  const alternatives: DateAlternative[] = []
  let date: Date
  if (modifier === 'this') {
    date = dateInWeek(startOfWeek(today, p.weekStart), weekday, p.weekStart)
  } else if (modifier === 'next') {
    date = dateInWeek(
      addCalendar(startOfWeek(today, p.weekStart), { days: 7 }),
      weekday,
      p.weekStart,
    )
    const soonest = addCalendar(today, { days: forwardDiff(today.getDay(), weekday) })
    if (!sameDay(date, soonest)) {
      alternatives.push({
        type: 'date',
        date: soonest,
        reason: 'soonest-occurrence',
        confidence: 0.45,
      })
    }
  } else if (modifier === 'last') {
    const diff = backwardDiff(today.getDay(), weekday) || 7
    date = addCalendar(today, { days: -diff })
  } else if (modifier === 'afterNext' || modifier === 'beforeLast') {
    const days = modifier === 'afterNext' ? 14 : -14
    date = dateInWeek(addCalendar(startOfWeek(today, p.weekStart), { days }), weekday, p.weekStart)
  } else {
    const diff = p.forwardDates
      ? forwardDiff(today.getDay(), weekday)
      : closestWeekdayDiff(today.getDay(), weekday)
    date = addCalendar(today, { days: diff })
    issues.push(
      issue(p, 'WEEKDAY_ASSUMED_NEXT', { weekday: dateWeekdayNames(p)[weekday]! }, start, end),
    )
  }
  const result = core(
    date,
    'day',
    [...knownFor('day'), 'weekday'],
    start,
    end,
    issues,
    alternatives,
  )
  return offset ? applyWeekdayOffset(result, offset.days) : result
}

function extractWeekdayOffset(p: P, source: string): { days: number; source: string } | null {
  const phrases = dateWeekdayOffsetPhrases(p)
  for (const phrase of Object.keys(phrases)) {
    const trailing = matchAffix(source, phrase, 'end')
    if (trailing !== null) {
      return { source: trailing.trim(), days: phrases[phrase]! }
    }
    const leading = matchAffix(source, phrase, 'start')
    if (leading !== null) {
      return { source: leading.trim(), days: phrases[phrase]! }
    }
  }
  return null
}

function applyWeekdayOffset(result: CoreDate, days: number): CoreDate {
  result.date = addCalendar(result.date, { days })
  result.issues = result.issues.filter((it) => it.code !== 'WEEKDAY_ASSUMED_NEXT')
  if (result.alternatives) {
    result.alternatives = result.alternatives.map((alt) => ({
      ...alt,
      date: addCalendar(alt.date, { days }),
    }))
  }
  return result
}

function matchWordModifier(
  p: P,
  source: string,
): { modifier: RelativeModifier; word: string } | null {
  const modifiers = dateModifiers(p)
  for (const modifier of RELATIVE_MODIFIERS) {
    for (const modWord of modifiers[modifier]) {
      const leading = matchAffix(source, modWord, 'start')
      if (leading !== null) {
        return { modifier, word: trimLeadingFillers(p, leading) }
      }
      const trailing = matchAffix(source, modWord, 'end')
      if (trailing !== null) {
        return { modifier, word: trailing }
      }
    }
  }
  return null
}

function parseCalendarPeriod(p: P, start: number, end: number): CoreDate | null {
  const source = stripDateFillers(p, p.text.slice(start, end).toLowerCase())
  const phrase = p.profile.date?.calendarPeriodPhrases?.[source]
  if (phrase) {
    return periodCore(p, phrase.modifier, phrase.period, start, end)
  }
  const rel = /^(this|next|last)\s+(week|month|year)$/.exec(source)
  if (rel) {
    const mod = rel[1] as 'this' | 'next' | 'last'
    const period = rel[2] as 'week' | 'month' | 'year'
    return periodCore(p, mod, period, start, end)
  }
  const localePeriod = matchPeriodModifier(p, source)
  if (localePeriod) {
    return periodCore(p, localePeriod.modifier, localePeriod.period, start, end)
  }
  const periodEdge = matchPeriodEdge(p, source, start, end)
  if (periodEdge) {
    return periodEdge
  }
  const monthRel = matchMonthModifier(p, source)
  if (monthRel) {
    const { modifier: mod, monthWord } = monthRel
    const month = dateMonths(p)[monthWord]
    if (month !== undefined) {
      return monthPeriodCore(p, mod, month, start, end)
    }
  }
  // The weekend is named by its Saturday, at day grain — `parseDateRange` widens
  // it through Sunday. Bare "weekend" reads as "this weekend".
  const weekend = /^(?:(this|next|last)\s+)?weekend$/.exec(source)
  if (weekend) {
    const today = startOfDay(p.now)
    const weekday = today.getDay()
    // Sunday still belongs to the weekend that began the day before. Rounding
    // forward would put "this weekend" a week out and leave the weekend the
    // reader is standing in reachable only as "last weekend".
    const toSaturday = weekday === 0 ? -1 : forwardDiff(weekday, 6)
    const saturday = addCalendar(today, { days: toSaturday })
    const shift = weekend[1] === 'next' ? 7 : weekend[1] === 'last' ? -7 : 0
    return core(addCalendar(saturday, { days: shift }), 'day', knownFor('day'), start, end)
  }
  const edge =
    /^(?:the\s+)?(beginning|start|end|middle|mid)(?:\s+of)?(?:\s+the)?(?:\s+(this|next|last))?\s+(.+)$/.exec(
      source,
    )
  if (edge) {
    const kind = edge[1]!
    const mod = (edge[2] as 'this' | 'next' | 'last' | undefined) ?? 'this'
    const target = edge[3]!
    if (target === 'week' || target === 'month' || target === 'year') {
      if (kind === 'middle' || kind === 'mid') {
        return middlePeriodCore(p, mod, target, start, end)
      }
      const base = periodCore(p, mod, target, start, end)
      if (kind === 'end') {
        return endPeriodCore(p, base.date, target, start, end)
      }
      return base
    }
    const month = dateMonths(p)[target]
    if (month !== undefined && (kind === 'middle' || kind === 'mid')) {
      return monthDayCore(p, month, 15, undefined, 'day', start, end)
    }
  }
  const mid = /^mid-?\s*([a-z]+)$/.exec(source)
  if (mid) {
    const month = dateMonths(p)[mid[1]!]
    if (month !== undefined) {
      return monthDayCore(p, month, 15, undefined, 'day', start, end)
    }
  }
  return null
}

function periodCore(
  p: P,
  mod: RelativeModifier,
  period: 'week' | 'month' | 'year',
  start: number,
  end: number,
): CoreDate {
  const delta = PERIOD_DELTAS[mod]
  let date: Date
  if (period === 'week') {
    date = addCalendar(startOfWeek(p.now, p.weekStart), { days: delta * 7 })
  } else if (period === 'month') {
    date = new Date(p.now.getFullYear(), p.now.getMonth() + delta, 1)
  } else {
    date = new Date(p.now.getFullYear() + delta, 0, 1)
  }
  return core(date, period, knownFor(period), start, end)
}

function monthPeriodCore(
  p: P,
  mod: 'next' | 'last',
  month: number,
  start: number,
  end: number,
): CoreDate {
  const currentMonth = p.now.getMonth()
  const year =
    p.now.getFullYear() +
    (mod === 'next' ? (month <= currentMonth ? 1 : 0) : month >= currentMonth ? -1 : 0)
  return core(new Date(year, month, 1), 'month', knownFor('month'), start, end)
}

function middlePeriodCore(
  p: P,
  mod: RelativeModifier,
  period: 'week' | 'month' | 'year',
  start: number,
  end: number,
): CoreDate {
  const base = periodCore(p, mod, period, start, end).date
  if (period === 'week') {
    return core(addCalendar(base, { days: 3 }), 'day', knownFor('day'), start, end)
  }
  if (period === 'month') {
    return core(
      new Date(base.getFullYear(), base.getMonth(), 15),
      'day',
      knownFor('day'),
      start,
      end,
    )
  }
  return core(new Date(base.getFullYear(), 6, 2), 'day', knownFor('day'), start, end)
}

function periodEdgeCore(
  p: P,
  mod: RelativeModifier,
  period: 'week' | 'month' | 'year',
  edge: 'start' | 'mid' | 'end',
  start: number,
  end: number,
): CoreDate {
  if (edge === 'mid') {
    return middlePeriodCore(p, mod, period, start, end)
  }
  const base = periodCore(p, mod, period, start, end)
  return edge === 'end'
    ? endPeriodCore(p, base.date, period, start, end)
    : core(base.date, 'day', knownFor('day'), start, end)
}

function endPeriodCore(
  p: P,
  base: Date,
  period: 'week' | 'month' | 'year',
  start: number,
  end: number,
): CoreDate {
  if (period === 'week') {
    return core(addCalendar(base, { days: 6 }), 'day', knownFor('day'), start, end)
  }
  if (period === 'month') {
    return core(
      new Date(base.getFullYear(), base.getMonth() + 1, 0),
      'day',
      knownFor('day'),
      start,
      end,
    )
  }
  return core(new Date(base.getFullYear(), 11, 31), 'day', knownFor('day'), start, end)
}

function matchPeriodEdge(p: P, source: string, start: number, end: number): CoreDate | null {
  const phrases = p.profile.date?.periodEdgePhrases
  if (!phrases) {
    return null
  }
  for (const variant of source === source.replace(/-/g, ' ')
    ? [source]
    : [source, source.replace(/-/g, ' ')]) {
    const exact = phrases[variant]
    if (exact) {
      return periodEdgeCore(p, 'this', exact.period, exact.edge, start, end)
    }
    for (const phrase of Object.keys(phrases)) {
      if (!variant.startsWith(`${phrase} `)) {
        continue
      }
      const target = variant.slice(phrase.length + 1).trim()
      const edge = phrases[phrase]!.edge
      const period = periodWord(p, target)
      if (period) {
        return periodEdgeCore(p, 'this', period, edge, start, end)
      }
      const month = dateMonths(p)[target]
      if (month !== undefined) {
        return monthEdgeCore(p, month, edge, start, end)
      }
    }
  }
  return null
}

function periodWord(p: P, word: string): PeriodUnit | null {
  const periods = datePeriodWords(p)
  for (const period of PERIODS) {
    if (periods[period].includes(word)) {
      return period
    }
  }
  return null
}

function monthEdgeCore(
  p: P,
  month: number,
  edge: 'start' | 'mid' | 'end',
  start: number,
  end: number,
): CoreDate | null {
  if (edge === 'end') {
    let date = new Date(p.now.getFullYear(), month + 1, 0)
    if (p.forwardDates && date.getTime() < startOfDay(p.now).getTime()) {
      date = new Date(p.now.getFullYear() + 1, month + 1, 0)
    }
    return core(date, 'day', knownFor('day'), start, end)
  }
  const day = edge === 'mid' ? 15 : 1
  return monthDayCore(p, month, day, undefined, 'day', start, end)
}

function wordAt(p: P, i: number): string | null {
  const t = p.tokens[i]
  return t?.type === 'word' ? t.text.toLowerCase() : null
}

function tokenIndexAt(p: P, start: number, end: number): number {
  return p.tokens.findIndex((token) => token.start >= start && token.end <= end)
}

function tokenIndexBefore(p: P, end: number): number {
  for (let i = p.tokens.length - 1; i >= 0; i--) {
    if (p.tokens[i]!.end <= end) {
      return i
    }
  }
  return -1
}

function unitFromToken(p: P, token: Token | undefined): OffsetUnit | null {
  if (token?.type !== 'word') {
    return null
  }
  return dateUnitWords(p)[token.text.toLowerCase()] ?? null
}

function valueStarts(p: P, i: number): boolean {
  const t = p.tokens[i]
  if (!t) {
    return false
  }
  if (t.type === 'digits' || t.type === 'vulgar') {
    return true
  }
  if (t.type === 'sym' && (t.text === '-' || t.text === '+' || t.text === '.')) {
    return true
  }
  if (t.type === 'word') {
    return (
      parseValue(
        {
          tokens: p.tokens,
          n: p.n,
          src: p.src,
          numberFormat: p.profile.defaults.numberFormat ?? 'auto',
          kind: 'duration',
          numberWords: true,
          profile: p.profile,
        },
        i,
      ) !== null
    )
  }
  return false
}

function dateMonths(p: P): Record<string, number> {
  return p.profile.date?.months ?? EN_MONTHS
}

function dateSubunit(p: P): Partial<Record<OffsetUnit, OffsetUnit>> {
  return (p.profile.date?.subunit ?? EN_SUBUNIT) as Partial<Record<OffsetUnit, OffsetUnit>>
}

function dateUnitWords(p: P): Record<string, OffsetUnit> {
  return (p.profile.date?.unitWords ?? EN_UNIT_WORDS) as Record<string, OffsetUnit>
}

function dateWeekdayNames(p: P): readonly string[] {
  return p.profile.date?.weekdayNames ?? EN_WEEKDAY_NAMES
}

function dateWeekdays(p: P): Record<string, number> {
  return p.profile.date?.weekdays ?? EN_WEEKDAYS
}

function dateDayOffsets(p: P): Record<string, number> {
  return p.profile.date?.dayOffsets ?? EN_DAY_OFFSETS
}

function dateDayTimePhrases(p: P): Record<string, DayTimePhrase> {
  return p.profile.date?.dayTimePhrases ?? EN_DAY_TIME_PHRASES
}

function parseDayPartCompound(
  p: P,
  source: string,
  today: Date,
  start: number,
  end: number,
): CoreDate | null {
  const parts = dateDayPartWords(p)
  for (const phrase of Object.keys(parts)) {
    const head = matchAffix(source, phrase, 'end')
    if (head === null) {
      continue
    }
    const trimmedHead = trimTrailingFillers(p, head)
    const { end: anchorEnd } = trimRange(p.text, start, start + trimmedHead.length)
    if (anchorEnd <= start) {
      continue
    }
    const anchor = p.text.slice(start, anchorEnd).toLowerCase()
    const dayOffset = dateDayOffsets(p)[anchor]
    const part = parts[phrase]!
    const grain = part.grain ?? 'hour'
    if (dayOffset !== undefined) {
      return core(
        withTime(addCalendar(today, { days: dayOffset }), part.hour),
        grain,
        [...knownFor(grain), 'implied-hour'],
        start,
        end,
      )
    }
    const weekday = parseWeekday(p, start, anchorEnd)
    if (weekday) {
      const date = withTime(weekday.date, part.hour)
      return core(
        date,
        grain,
        [...knownFor(grain), 'weekday', 'implied-hour'],
        start,
        end,
        weekday.issues,
        weekday.alternatives?.map((alt) => ({ ...alt, date: withTime(alt.date, part.hour) })),
      )
    }
  }
  return null
}

function dateDayPartWords(p: P): Record<string, { grain?: 'hour'; hour: number }> {
  return p.profile.date?.dayPartWords ?? EN_DAY_PART_WORDS
}

function dateWeekdayOffsetPhrases(p: P): Record<string, number> {
  return p.profile.date?.weekdayOffsetPhrases ?? EN_WEEKDAY_OFFSET_PHRASES
}

function dayTimeCore(
  p: P,
  today: Date,
  phrase: DayTimePhrase,
  start: number,
  end: number,
): CoreDate {
  let date = withTime(addCalendar(today, { days: phrase.dayOffset ?? 0 }), phrase.hour)
  date.setMinutes(phrase.minute ?? 0, phrase.second ?? 0, 0)
  if (phrase.dayOffset === undefined && p.forwardDates && date.getTime() < p.now.getTime()) {
    date = addCalendar(date, { days: 1 })
  }
  const grain = phrase.grain ?? 'hour'
  return core(date, grain, [...knownFor(grain), 'implied-hour'], start, end)
}

function dateRelativeWords(p: P): {
  anchorWords: readonly string[]
  futurePrefixes: readonly string[]
  pastPrefixes: readonly string[]
  pastSuffixes: readonly string[]
} {
  return {
    anchorWords: wordsOr(p.profile.date?.relative?.anchorWords, EN_RELATIVE_WORDS.anchorWords),
    futurePrefixes: wordsOr(
      p.profile.date?.relative?.futurePrefixes,
      EN_RELATIVE_WORDS.futurePrefixes,
    ),
    pastPrefixes: wordsOr(p.profile.date?.relative?.pastPrefixes, EN_RELATIVE_WORDS.pastPrefixes),
    pastSuffixes: wordsOr(p.profile.date?.relative?.pastSuffixes, EN_RELATIVE_WORDS.pastSuffixes),
  }
}

function dateModifiers(p: P): Record<RelativeModifier, readonly string[]> {
  return {
    this: wordsOr(p.profile.date?.modifiers?.this, EN_MODIFIERS.this),
    next: wordsOr(p.profile.date?.modifiers?.next, EN_MODIFIERS.next),
    last: wordsOr(p.profile.date?.modifiers?.last, EN_MODIFIERS.last),
    afterNext: wordsOr(p.profile.date?.modifiers?.afterNext, EN_MODIFIERS.afterNext),
    beforeLast: wordsOr(p.profile.date?.modifiers?.beforeLast, EN_MODIFIERS.beforeLast),
  }
}

function datePeriodWords(p: P): Record<PeriodUnit, readonly string[]> {
  return {
    week: wordsOr(p.profile.date?.periodWords?.week, EN_PERIOD_WORDS.week),
    month: wordsOr(p.profile.date?.periodWords?.month, EN_PERIOD_WORDS.month),
    year: wordsOr(p.profile.date?.periodWords?.year, EN_PERIOD_WORDS.year),
  }
}

function wordsOr(
  words: readonly string[] | undefined,
  fallback: readonly string[],
): readonly string[] {
  return words && words.length > 0 ? words : fallback
}

function eatPrefix(p: P, first: number, phrases: readonly string[] | undefined): number {
  for (const phrase of phrases ?? []) {
    const words = phrase.split(/\s+/)
    if (words.every((word, index) => wordAt(p, first + index) === word)) {
      return first + words.length
    }
  }
  return first
}

function isPrefixAt(p: P, first: number, phrases: readonly string[] | undefined): boolean {
  return eatPrefix(p, first, phrases) > first
}

function matchPeriodModifier(
  p: P,
  source: string,
): { modifier: RelativeModifier; period: PeriodUnit } | null {
  const periods = datePeriodWords(p)
  const modifiers = dateModifiers(p)
  for (const modifier of RELATIVE_MODIFIERS) {
    for (const modWord of modifiers[modifier]) {
      for (const period of PERIODS) {
        for (const periodWord of periods[period]) {
          if (source === `${modWord} ${periodWord}` || source === `${periodWord} ${modWord}`) {
            return { modifier, period }
          }
        }
      }
    }
  }
  return null
}

function matchMonthModifier(
  p: P,
  source: string,
): { modifier: 'next' | 'last'; monthWord: string } | null {
  const modifiers = dateModifiers(p)
  const months = Object.keys(dateMonths(p))
  for (const modifier of ['next', 'last'] as const) {
    for (const modWord of modifiers[modifier]) {
      for (const monthWord of months) {
        if (source === `${modWord} ${monthWord}` || source === `${monthWord} ${modWord}`) {
          return { modifier, monthWord }
        }
      }
    }
  }
  return null
}

function parseCompactLocaleOffset(p: P, start: number, end: number): CoreDate | null {
  const source = p.text.slice(start, end)
  const compact = p.profile.date?.compactOffset
  if (!compact) {
    return null
  }
  for (const suffix of compact.pastSuffixes ?? []) {
    const parsed = parseCompactOffsetBody(p, source, suffix, compact.unitWords)
    if (parsed) {
      return offsetCore(p, p.now, [parsed], -1, start, end)
    }
  }
  for (const suffix of compact.futureSuffixes ?? []) {
    const parsed = parseCompactOffsetBody(p, source, suffix, compact.unitWords)
    if (parsed) {
      return offsetCore(p, p.now, [parsed], 1, start, end)
    }
  }
  return null
}

function parseCompactOffsetBody(
  p: P,
  source: string,
  suffix: string,
  units: Record<string, OffsetUnit>,
): OffsetPart | null {
  if (!source.endsWith(suffix)) {
    return null
  }
  const body = source.slice(0, -suffix.length)
  const unitEntry = Object.keys(units)
    .sort((a, b) => b.length - a.length)
    .find((unitWord) => body.endsWith(unitWord))
  if (!unitEntry) {
    return null
  }
  const value = readLocaleNumber(p, body.slice(0, -unitEntry.length))
  return value === null ? null : { unit: units[unitEntry]!, value }
}

function isJoinWord(p: P, pos: number): boolean {
  const w = wordAt(p, pos)
  return w !== null && p.profile.numberWords.andWords.has(w)
}

function subunitLimit(unit: OffsetUnit): number {
  if (unit === 'second' || unit === 'minute') {
    return 60
  }
  if (unit === 'hour') {
    return 24
  }
  if (unit === 'day') {
    return 7
  }
  return Number.POSITIVE_INFINITY
}

function finestOffsetGrain(parts: readonly OffsetPart[]): DateGrain {
  const order: OffsetUnit[] = ['year', 'month', 'week', 'day', 'hour', 'minute', 'second']
  let finest = 'year' as OffsetUnit
  for (const part of parts) {
    if (order.indexOf(part.unit) > order.indexOf(finest)) {
      finest = part.unit
    }
  }
  return finest === 'week' ? 'day' : finest
}
