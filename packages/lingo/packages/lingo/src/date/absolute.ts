import type { LingoIssue } from '../core/types'
import { parseYear, sameDay, startOfDay, validDateTime } from './civil'
import type { DateAlternative, DateGrain } from './parse'
import { type CoreDate, core, issue, knownFor, needsNow, type P, stripDateFillers } from './state'
import { parseSuffixDate } from './suffix'
import { MONTHS as EN_MONTHS } from './vocab'

export function parseAbsolute(p: P, start: number, end: number): CoreDate | null {
  const source = stripDateFillers(p, p.text.slice(start, end))
  const lower = source.toLowerCase()
  const pureYear = /^(\d{4})$/.exec(source)
  if (pureYear) {
    const year = Number(pureYear[1])
    if (year >= 1900 && year <= 2100) {
      return core(new Date(year, 0, 1), 'year', knownFor('year'), start, end)
    }
    return null
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[tT](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(source)
  if (iso) {
    const year = Number(iso[1])
    const month = Number(iso[2]) - 1
    const day = Number(iso[3])
    const hour = iso[4] === undefined ? 0 : Number(iso[4])
    const minute = iso[5] === undefined ? 0 : Number(iso[5])
    const second = iso[6] === undefined ? 0 : Number(iso[6])
    const date = validDateTime(year, month, day, hour, minute, second)
    if (!date) {
      return null
    }
    const grain: DateGrain =
      iso[6] === undefined ? (iso[4] === undefined ? 'day' : 'minute') : 'second'
    return core(date, grain, knownFor(grain), start, end)
  }

  const numeric = /^(\d{1,2})([./-])(\d{1,2})(?:\2(\d{2}|\d{4}))?$/.exec(source)
  if (numeric) {
    return numericDateCore(p, numeric, start, end)
  }

  const suffixed = parseSuffixDate(p, start, end)
  if (suffixed) {
    return suffixed
  }

  const patterns = monthPatterns(p)
  const md = patterns.monthDay.exec(source)
  if (md) {
    return monthDayCore(
      p,
      dateMonths(p)[md[1]!.toLowerCase()]!,
      Number(md[2]),
      parseYear(md[3]),
      'day',
      start,
      end,
    )
  }
  const dm = patterns.dayMonth.exec(source)
  if (dm) {
    return monthDayCore(
      p,
      dateMonths(p)[dm[2]!.toLowerCase()]!,
      Number(dm[1]),
      parseYear(dm[3]),
      'day',
      start,
      end,
    )
  }
  const my = patterns.monthYear.exec(source)
  if (my) {
    const year = parseYear(my[2])
    if (year === undefined) {
      return null
    }
    return monthDayCore(p, dateMonths(p)[my[1]!.toLowerCase()]!, 1, year, 'month', start, end)
  }
  const bareMonth = dateMonths(p)[lower]
  if (bareMonth !== undefined) {
    return monthDayCore(p, bareMonth, 1, undefined, 'month', start, end)
  }
  return null
}

function numericDateCore(p: P, m: RegExpExecArray, start: number, end: number): CoreDate | null {
  const a = Number(m[1])
  const b = Number(m[3])
  const explicitYear = parseYear(m[4])
  let dayFirst =
    p.opts.dayFirst ?? (p.opts.locale ? !p.opts.locale.toLowerCase().startsWith('en-us') : false)
  if (a > 12 && b <= 12) {
    dayFirst = true
  }
  if (b > 12 && a <= 12) {
    dayFirst = false
  }
  const month = dayFirst ? b - 1 : a - 1
  const day = dayFirst ? a : b
  const date = buildYearless(p, month, day, explicitYear)
  if (!date) {
    return null
  }
  const issues: LingoIssue[] = []
  const alternatives: DateAlternative[] = []
  if (a <= 12 && b <= 12) {
    const altMonth = dayFirst ? a - 1 : b - 1
    const altDay = dayFirst ? b : a
    const alt = buildYearless(p, altMonth, altDay, explicitYear)
    if (alt && !sameDay(alt, date)) {
      issues.push(
        issue(
          p,
          'AMBIGUOUS_DATE',
          { text: p.text.slice(start, end), a: formatShortDate(date), b: formatShortDate(alt) },
          start,
          end,
        ),
      )
      alternatives.push({ type: 'date', date: alt, reason: 'other-date-order', confidence: 0.45 })
    }
  }
  const parsed = core(date, 'day', knownFor('day'), start, end, issues, alternatives)
  return explicitYear === undefined ? needsNow(parsed) : parsed
}

export function monthDayCore(
  p: P,
  month: number,
  day: number,
  year: number | undefined,
  grain: DateGrain,
  start: number,
  end: number,
): CoreDate | null {
  const date = buildYearless(p, month, day, year)
  if (!date) {
    return null
  }
  const parsed = core(date, grain, knownFor(grain), start, end)
  return year === undefined ? needsNow(parsed) : parsed
}

interface MonthPatterns {
  dayMonth: RegExp
  monthDay: RegExp
  monthYear: RegExp
}

const EN_ORDINAL_SUFFIXES: readonly string[] = ['st', 'nd', 'rd', 'th']
const patternCache = new WeakMap<Record<string, number>, MonthPatterns>()

/**
 * Month alternations are derived from the profile's month table, so they are
 * compiled once per table rather than rebuilt (sort + join + three `RegExp`
 * constructions) on every date parse.
 */
function monthPatterns(p: P): MonthPatterns {
  const months = dateMonths(p)
  const cached = patternCache.get(months)
  if (cached) {
    return cached
  }
  const alternation = Object.keys(months)
    .sort((a, b) => b.length - a.length)
    .join('|')
  const ord = ordinalSuffixPattern(p)
  const year = "(?:,?\\s+('?\\d{2}|\\d{4}))?"
  const patterns: MonthPatterns = {
    dayMonth: new RegExp(`^(\\d{1,2})${ord}(?:\\s+of)?\\s+(${alternation})${year}$`, 'i'),
    monthDay: new RegExp(`^(${alternation})\\s+(\\d{1,2})${ord}${year}$`, 'i'),
    monthYear: new RegExp(`^(${alternation})\\s+('?\\d{2}|\\d{4})$`, 'i'),
  }
  patternCache.set(months, patterns)
  return patterns
}

/**
 * Ordinal markers allowed between a day number and its month. Packs that do not
 * declare their own keep the English suffixes, which are inert in other
 * languages because the marker is optional.
 */
function ordinalSuffixPattern(p: P): string {
  const suffixes = p.profile.date?.ordinalSuffixes?.length
    ? p.profile.date.ordinalSuffixes
    : EN_ORDINAL_SUFFIXES
  return `(?:${suffixes.map((s) => s.replace(/[^\w]/g, '\\$&')).join('|')})?`
}

function dateMonths(p: P): Record<string, number> {
  return p.profile.date?.months ?? EN_MONTHS
}

function buildYearless(p: P, month: number, day: number, year: number | undefined): Date | null {
  let y = year ?? p.now.getFullYear()
  let date = validDateTime(y, month, day, 0, 0, 0)
  if (!date) {
    return null
  }
  if (year === undefined && p.forwardDates && date.getTime() < startOfDay(p.now).getTime()) {
    y++
    date = validDateTime(y, month, day, 0, 0, 0)
  }
  return date
}

export function formatShortDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
