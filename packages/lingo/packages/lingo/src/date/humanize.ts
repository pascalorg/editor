import type { Quantity } from '../core/quantity'
import type { DateGrain } from './parse'
import { DURATION_UNIT_SECONDS, WEEKDAY_NAMES } from './vocab'

/**
 * Options for `humanizeDate()`.
 * @example
 * ```ts
 * import { humanizeDate } from '@pascal-app/lingo/date'
 * const now = new Date('2026-07-03T10:00:00')
 * humanizeDate(new Date(now.getTime() - 26 * 3_600_000), { now }) // "yesterday"
 * ```
 */
export interface HumanizeDateOptions {
  justNowUnder?: number
  maxUnit?: DateGrain
  minUnit?: DateGrain
  now: Date
  numeric?: 'auto' | 'always'
  rounding?: 'round' | 'floor' | 'ceil' | 'trunc'
}

/**
 * Options for `humanizeDuration()`.
 * @example
 * ```ts
 * import { humanizeDuration } from '@pascal-app/lingo/date'
 * humanizeDuration(5400, { style: 'natural' }) // "an hour and a half"
 * ```
 */
export interface HumanizeDurationOptions {
  largest?: number
  style?: 'narrow' | 'short' | 'long' | 'natural'
}

const GRAIN_ORDER: DateGrain[] = ['second', 'minute', 'hour', 'day', 'week', 'month', 'year']

/**
 * Render a `Date` as relative natural language ("in an hour", "3 days ago",
 * "yesterday"). The inverse of `parseDate()` — round-trip tested to land
 * within one display-grain of the original. `now` is required so output is
 * deterministic and re-parseable.
 * @example
 * ```ts
 * import { humanizeDate } from '@pascal-app/lingo/date'
 * const now = new Date('2026-07-03T10:00:00')
 * humanizeDate(new Date(now.getTime() + 3_600_000), { now }) // "in an hour"
 * ```
 */
export function humanizeDate(date: Date, opts: HumanizeDateOptions): string {
  if (!opts?.now) {
    throw new Error('Pass { now }.')
  }
  const now = new Date(opts.now.getTime())
  const justNowUnder = opts.justNowUnder ?? 10_000
  const numeric = opts.numeric ?? 'auto'
  const rounding = opts.rounding ?? 'round'
  const signedMs = date.getTime() - now.getTime()
  const past = signedMs < 0
  const absMs = Math.abs(signedMs)
  const normalizedMinutes =
    Math.abs(signedMs - (date.getTimezoneOffset() - now.getTimezoneOffset()) * 60_000) / 60_000

  let grain: DateGrain
  if (absMs < justNowUnder) {
    grain = 'second'
  } else if (absMs < 60_000) {
    grain = 'second'
  } else if (absMs < 45 * 60_000) {
    grain = 'minute'
  } else if (absMs < 90 * 60_000) {
    grain = 'hour'
  } else if (normalizedMinutes < 24 * 60) {
    grain = 'hour'
  } else if (normalizedMinutes < 47 * 60) {
    grain = 'day'
  } else if (normalizedMinutes < 7 * 24 * 60) {
    grain = 'day'
  } else if (normalizedMinutes < 30 * 24 * 60) {
    grain = 'week'
  } else if (normalizedMinutes < 320 * 24 * 60) {
    grain = 'month'
  } else {
    grain = 'year'
  }
  grain = clampGrain(grain, opts)

  if (grain === 'second' && absMs < justNowUnder) {
    return 'just now'
  }
  if (numeric === 'auto' && grain === 'day') {
    const dayDelta = calendarDayDiff(now, date)
    if (dayDelta === -1) {
      return 'yesterday'
    }
    if (dayDelta === 1) {
      return 'tomorrow'
    }
    if (Math.abs(dayDelta) >= 2 && Math.abs(dayDelta) <= 6) {
      return dayDelta < 0
        ? `last ${WEEKDAY_NAMES[date.getDay()]}`
        : `on ${WEEKDAY_NAMES[date.getDay()]}`
    }
  }

  const amount = amountFor(grain, date, now, normalizedMinutes, rounding)
  if (grain === 'minute' && amount === 1) {
    return past ? 'a minute ago' : 'in a minute'
  }
  if (grain === 'hour' && amount === 1) {
    return past ? 'an hour ago' : 'in an hour'
  }
  const unit = plural(grain, amount)
  return past ? `${amount} ${unit} ago` : `in ${amount} ${unit}`
}

function amountFor(
  grain: DateGrain,
  date: Date,
  now: Date,
  normalizedMinutes: number,
  rounding: NonNullable<HumanizeDateOptions['rounding']>,
): number {
  const absMs = Math.abs(date.getTime() - now.getTime())
  const round = (value: number) => Math.max(1, applyRounding(value, rounding))
  if (grain === 'second') {
    return round(absMs / 1000)
  }
  if (grain === 'minute') {
    return round(absMs / 60_000)
  }
  if (grain === 'hour') {
    return round(normalizedMinutes / 60)
  }
  if (grain === 'day') {
    return round(normalizedMinutes / (24 * 60))
  }
  if (grain === 'week') {
    return round(normalizedMinutes / (7 * 24 * 60))
  }
  if (grain === 'month') {
    return round(normalizedMinutes / (30.4375 * 24 * 60))
  }
  return round(normalizedMinutes / (365.25 * 24 * 60))
}

function applyRounding(
  value: number,
  rounding: NonNullable<HumanizeDateOptions['rounding']>,
): number {
  if (rounding === 'floor') {
    return Math.floor(value)
  }
  if (rounding === 'ceil') {
    return Math.ceil(value)
  }
  if (rounding === 'trunc') {
    return Math.trunc(value)
  }
  return Math.round(value)
}

function clampGrain(grain: DateGrain, opts: HumanizeDateOptions): DateGrain {
  let index = GRAIN_ORDER.indexOf(grain)
  if (opts.maxUnit) {
    index = Math.min(index, GRAIN_ORDER.indexOf(opts.maxUnit))
  }
  if (opts.minUnit) {
    index = Math.max(index, GRAIN_ORDER.indexOf(opts.minUnit))
  }
  return GRAIN_ORDER[index]!
}

function calendarDayDiff(a: Date, b: Date): number {
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate())
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.round(
    (db.getTime() - da.getTime() - (db.getTimezoneOffset() - da.getTimezoneOffset()) * 60_000) /
      86_400_000,
  )
}

function plural(unit: string, value: number): string {
  return value === 1 ? unit : `${unit}s`
}

const DURATION_UNITS = [
  { unit: 'yr', narrow: 'y', short: 'yr', long: 'year', seconds: DURATION_UNIT_SECONDS.yr },
  { unit: 'mo', narrow: 'mo', short: 'mo', long: 'month', seconds: DURATION_UNIT_SECONDS.mo },
  { unit: 'wk', narrow: 'w', short: 'wk', long: 'week', seconds: DURATION_UNIT_SECONDS.wk },
  { unit: 'd', narrow: 'd', short: 'd', long: 'day', seconds: DURATION_UNIT_SECONDS.d },
  { unit: 'h', narrow: 'h', short: 'h', long: 'hour', seconds: DURATION_UNIT_SECONDS.h },
  { unit: 'min', narrow: 'm', short: 'min', long: 'minute', seconds: DURATION_UNIT_SECONDS.min },
  { unit: 's', narrow: 's', short: 's', long: 'second', seconds: DURATION_UNIT_SECONDS.s },
] as const

/**
 * Render a duration (a `Quantity` of kind `'duration'`, or raw seconds) as
 * natural language.
 * @example
 * ```ts
 * import { parseDuration, humanizeDuration } from '@pascal-app/lingo/date'
 * const r = parseDuration('90 min')
 * r.ok && humanizeDuration(r.duration) // "1 h 30 min"
 * ```
 */
export function humanizeDuration(input: Quantity | number, opts?: HumanizeDurationOptions): string {
  const style = opts?.style ?? 'short'
  const largest = Math.max(1, opts?.largest ?? 2)
  const seconds = typeof input === 'number' ? input : input.base
  const sign = seconds < 0 ? '-' : ''
  const abs = Math.abs(seconds)
  if (style === 'natural') {
    if (Math.abs(abs - 5400) < 1e-9) {
      return `${sign}an hour and a half`
    }
    if (Math.abs(abs - 1800) < 1e-9) {
      return `${sign}half an hour`
    }
  }
  const parts = durationParts(abs, largest)
  const rendered = parts.map((part) => renderDurationPart(part.value, part.index, style))
  if (style === 'natural') {
    return sign + joinLong(rendered)
  }
  return sign + rendered.join(' ')
}

function durationParts(seconds: number, largest: number): Array<{ index: number; value: number }> {
  if (seconds === 0) {
    return [{ index: DURATION_UNITS.length - 1, value: 0 }]
  }
  const raw: Array<{ index: number; value: number }> = []
  let remainder = seconds
  for (let i = 0; i < DURATION_UNITS.length; i++) {
    const def = DURATION_UNITS[i]!
    const value = Math.floor(remainder / def.seconds)
    if (value > 0) {
      raw.push({ index: i, value })
      remainder -= value * def.seconds
    }
  }
  if (raw.length === 0) {
    raw.push({ index: DURATION_UNITS.length - 1, value: seconds })
  }
  const shown = raw.slice(0, largest)
  const last = shown[shown.length - 1]!
  let smaller = remainder
  for (const part of raw.slice(largest)) {
    smaller += part.value * DURATION_UNITS[part.index]!.seconds
  }
  const lastUnitSeconds = DURATION_UNITS[last.index]!.seconds
  last.value += Math.round(smaller / lastUnitSeconds)
  return normalizeCarries(shown)
}

function normalizeCarries(
  parts: Array<{ index: number; value: number }>,
): Array<{ index: number; value: number }> {
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]!
    const prev = parts[i - 1]
    if (!prev) {
      continue
    }
    const ratio = DURATION_UNITS[prev.index]!.seconds / DURATION_UNITS[part.index]!.seconds
    if (Number.isInteger(ratio) && part.value >= ratio) {
      prev.value += Math.floor(part.value / ratio)
      part.value %= ratio
    }
  }
  return parts.filter((part, index) => part.value !== 0 || index === 0)
}

function renderDurationPart(
  value: number,
  index: number,
  style: NonNullable<HumanizeDurationOptions['style']>,
): string {
  const def = DURATION_UNITS[index]!
  if (style === 'narrow') {
    return `${value}${def.narrow}`
  }
  if (style === 'short') {
    return `${value} ${def.short}`
  }
  const label = value === 1 ? def.long : `${def.long}s`
  if (style === 'natural' && value === 1 && def.long === 'hour') {
    return 'an hour'
  }
  return `${value} ${label}`
}

function joinLong(parts: string[]): string {
  if (parts.length <= 1) {
    return parts[0] ?? '0 seconds'
  }
  if (parts.length === 2) {
    return `${parts[0]} and ${parts[1]}`
  }
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** Options for `humanizeDateRange()`. */
export interface HumanizeDateRangeOptions {
  /** 12-hour clock with AM/PM (default), or 24-hour "14:00" when false. */
  hour12?: boolean
}

/**
 * Render a time slot (from `parseDateRange()`) as a clock-time phrase —
 * "2:00 PM to 4:00 PM", "from 9:00 AM", "until 5:00 PM". Calendar ranges render
 * as dates instead — "2026-07-01 to 2026-07-05". The inverse of
 * `parseDateRange()`: the emitted string re-parses to the same civil times.
 * @example
 * ```ts
 * import { parseDateRange, humanizeDateRange } from '@pascal-app/lingo/date'
 * const r = parseDateRange('2pm to 4pm', { now: new Date(2026, 6, 3, 9) })
 * r.ok && humanizeDateRange(r) // "2:00 PM to 4:00 PM"
 * ```
 */
export function humanizeDateRange(
  range: {
    anchored?: boolean
    dated?: boolean
    end?: { date: Date; grain?: DateGrain }
    start?: { date: Date; grain?: DateGrain }
  },
  opts?: HumanizeDateRangeOptions,
): string {
  if (range.anchored && range.start && range.end) {
    const a = anchoredPhrase(range.start.date, range.end.date, opts)
    if (a) {
      return a
    }
  }
  const hour12 = opts?.hour12 ?? true
  // A calendar range must carry its dates, or "July 1 to July 5" renders as
  // "12:00 AM to 12:00 AM" and re-parses to today. Clock slots stay bare.
  const render = (ep: { date: Date; grain?: DateGrain }): string => {
    if (!range.dated) {
      return formatClock(ep.date, hour12)
    }
    const day = formatMonthDayYear(ep.date)
    return ep.grain === 'hour' || ep.grain === 'minute' || ep.grain === 'second'
      ? `${day} ${formatClock(ep.date, hour12)}`
      : day
  }
  const start = range.start ? render(range.start) : undefined
  const end = range.end ? render(range.end) : undefined
  if (start && end) {
    return `${start} to ${end}`
  }
  if (start) {
    return `from ${start}`
  }
  if (end) {
    return `until ${end}`
  }
  throw new Error('humanizeDateRange: range has neither start nor end.')
}

function anchoredPhrase(s: Date, e: Date, opts?: HumanizeDateRangeOptions): string | null {
  const m =
    (e.getTime() - s.getTime() - (e.getTimezoneOffset() - s.getTimezoneOffset()) * 6e4) / 6e4
  if (m <= 0) {
    return null
  }
  const day = !(s.getHours() | s.getMinutes() | s.getSeconds()) && m % 1440 === 0
  const n = day ? m / 1440 : m % 60 === 0 ? m / 60 : m
  if (!Number.isInteger(n)) {
    return null
  }
  const u = day
    ? n === 1
      ? 'day'
      : 'days'
    : m % 60 === 0
      ? n === 1
        ? 'hour'
        : 'hours'
      : n === 1
        ? 'minute'
        : 'minutes'
  const anchor = day
    ? formatMonthDayYear(s)
    : `${formatMonthDayYear(s)} ${formatClock(s, opts?.hour12 ?? true)}`
  return `${n} ${u} starting ${anchor}`
}

function formatMonthDayYear(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatClock(d: Date, hour12: boolean): string {
  const h = d.getHours()
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (!hour12) {
    return `${String(h).padStart(2, '0')}:${mm}`
  }
  return `${h % 12 || 12}:${mm} ${h < 12 ? 'AM' : 'PM'}`
}
