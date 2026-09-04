import type { LingoIssue } from '../core/types'
import { validDateTime } from './civil'
import { readNumberAt } from './numeral'
import type { DateGrain } from './parse'
import { type CoreDate, core, knownFor, needsNow, type P } from './state'
import type { TimeCore } from './time'

/**
 * Grammar for locales that CLOSE each date or clock part with a suffix instead
 * of separating parts with a delimiter: `2026年3月5日`, `3月5号`, `15時30分`,
 * `下午3点`. Every rule here reads pack data (`date.numericDateSuffixes`,
 * `date.clockSuffix`, `date.dayPeriods`, `date.clockMinuteWords`), so packs
 * that declare none of it never reach this path.
 */

interface Read {
  next: number
  value: number
}

/** `2026年3月5日`, `3月5号`, `2026年3月`, `2026年`. */
export function parseSuffixDate(p: P, start: number, end: number): CoreDate | null {
  const vocab = p.profile.date?.numericDateSuffixes
  if (!vocab) {
    return null
  }
  const source = p.text.slice(start, end)
  let pos = 0
  const yearRead = readSuffixed(p, source, pos, vocab.year)
  const year = yearRead ? civilYear(yearRead.value) : undefined
  if (yearRead) {
    if (year === undefined) {
      return null
    }
    pos = yearRead.next
    if (pos === source.length) {
      return core(new Date(year, 0, 1), 'year', knownFor('year'), start, end)
    }
  }
  const monthRead = readSuffixed(p, source, pos, vocab.month)
  if (!monthRead || monthRead.value < 1 || monthRead.value > 12) {
    return null
  }
  pos = monthRead.next
  const month = monthRead.value - 1
  if (pos === source.length) {
    return dateCore(p, year, month, 1, 'month', start, end)
  }
  const dayRead = readSuffixed(p, source, pos, vocab.day)
  if (!dayRead || dayRead.next !== source.length) {
    return null
  }
  return dateCore(p, year, month, dayRead.value, 'day', start, end)
}

/** `3点`, `15時30分`, `下午3点半`, `午前9時`, `三点一刻`. */
export function parseSuffixClock(p: P, source: string, issues: LingoIssue[]): TimeCore | null {
  const vocab = p.profile.date?.clockSuffix
  if (!vocab) {
    return null
  }
  let pos = 0
  const period = readDayPeriod(p, source, pos)
  if (period) {
    pos = period.next
  }
  const hourRead = readSuffixed(p, source, pos, vocab.hour)
  if (!hourRead) {
    return null
  }
  pos = hourRead.next
  let hour = hourRead.value
  let minute = 0
  let second = 0
  let grain: DateGrain = 'hour'
  const minuteRead = readSuffixed(p, source, pos, vocab.minute) ?? readMinuteWord(p, source, pos)
  if (minuteRead) {
    minute = minuteRead.value
    grain = 'minute'
    pos = minuteRead.next
    const secondRead = readSuffixed(p, source, pos, vocab.second)
    if (secondRead) {
      second = secondRead.value
      grain = 'second'
      pos = secondRead.next
    }
  }
  if (pos !== source.length) {
    return null
  }
  if (period?.meridiem === 'pm' && hour < 12) {
    hour += 12
  }
  if (period?.meridiem === 'am' && hour === 12) {
    hour = 0
  }
  if (hour > 23 || minute > 59 || second > 59) {
    return null
  }
  return { hour, minute, second, grain, issues }
}

/**
 * Split an unspaced date+time compound (`明天下午3点`, `明日の午後3時半`) at the
 * head of its clock. Candidate heads are the pack's day-period words and its
 * hour markers walked back over the number they close, so the scan is bounded
 * by the vocabulary rather than by every offset in the string.
 */
export function suffixTimeStarts(p: P, source: string): number[] {
  const date = p.profile.date
  const starts = new Set<number>()
  for (const word of Object.keys(date?.dayPeriods ?? {})) {
    for (let at = source.indexOf(word); at > 0; at = source.indexOf(word, at + 1)) {
      starts.add(at)
    }
  }
  for (const marker of date?.clockSuffix?.hour ?? []) {
    for (let at = source.indexOf(marker); at > 0; at = source.indexOf(marker, at + 1)) {
      const numberStart = walkBackNumber(p, source, at)
      if (numberStart > 0) {
        starts.add(numberStart)
      }
    }
  }
  return [...starts].sort((a, b) => a - b)
}

/** Drop trailing joiner particles (`明日の` → `明日`) left by an unspaced split. */
export function trimTrailingFillers(p: P, source: string): string {
  return trimFillers(p, source, 'end')
}

/** Drop leading joiner particles (`の火曜日` → `火曜日`) left by an affix match. */
export function trimLeadingFillers(p: P, source: string): string {
  return trimFillers(p, source, 'start')
}

function trimFillers(p: P, source: string, side: 'end' | 'start'): string {
  const fillers = p.profile.date?.fillerWords
  if (!fillers?.length) {
    return source
  }
  let out = source
  for (let more = true; more; ) {
    more = false
    for (const filler of fillers) {
      if (filler.length === 0 || out.length <= filler.length || /[a-z]/i.test(filler)) {
        continue
      }
      if (side === 'end' ? out.endsWith(filler) : out.startsWith(filler)) {
        out = side === 'end' ? out.slice(0, -filler.length) : out.slice(filler.length)
        more = true
      }
    }
  }
  return out
}

/**
 * Match an affix against one edge of `source`. Scripts written without word
 * spaces glue affixes straight onto the word they modify (`下周五`,
 * `明日の午後`), so the separating space is required only for affixes that are
 * themselves spelled in a spaced script.
 */
export function matchAffix(source: string, affix: string, side: 'end' | 'start'): string | null {
  const spaced = side === 'start' ? `${affix} ` : ` ${affix}`
  if (side === 'start' && source.startsWith(spaced)) {
    return source.slice(spaced.length)
  }
  if (side === 'end' && source.endsWith(spaced)) {
    return source.slice(0, -spaced.length)
  }
  if (/[a-z]/i.test(affix)) {
    return null
  }
  if (side === 'start' && source.length > affix.length && source.startsWith(affix)) {
    return source.slice(affix.length)
  }
  if (side === 'end' && source.length > affix.length && source.endsWith(affix)) {
    return source.slice(0, -affix.length)
  }
  return null
}

function readSuffixed(
  p: P,
  source: string,
  pos: number,
  markers: readonly string[] | undefined,
): Read | null {
  if (!markers?.length) {
    return null
  }
  const number = readNumberAt(p, source, pos)
  if (!number) {
    return null
  }
  const marker = longest(markers, source, number.next)
  return marker === null ? null : { value: number.value, next: number.next + marker.length }
}

/** Minute words that stand alone after the hour: `3時半`, `三点一刻`. */
function readMinuteWord(p: P, source: string, pos: number): Read | null {
  const words = p.profile.date?.clockMinuteWords
  if (!words) {
    return null
  }
  const key = longest(Object.keys(words), source, pos)
  return key === null ? null : { value: words[key]!, next: pos + key.length }
}

function readDayPeriod(
  p: P,
  source: string,
  pos: number,
): { meridiem: 'am' | 'pm'; next: number } | null {
  const periods = p.profile.date?.dayPeriods
  if (!periods) {
    return null
  }
  const key = longest(Object.keys(periods), source, pos)
  return key === null ? null : { meridiem: periods[key]!.meridiem, next: pos + key.length }
}

function longest(candidates: readonly string[], source: string, pos: number): string | null {
  let best: string | null = null
  for (const candidate of candidates) {
    if (
      candidate.length > (best?.length ?? 0) &&
      source.startsWith(candidate, pos) &&
      candidate.length > 0
    ) {
      best = candidate
    }
  }
  return best
}

function walkBackNumber(p: P, source: string, at: number): number {
  const numerals = p.profile.numerals
  let pos = at
  while (pos > 0 && (/\d/.test(source[pos - 1]!) || numerals?.[source[pos - 1]!] !== undefined)) {
    pos--
  }
  return pos === at ? -1 : pos
}

function dateCore(
  p: P,
  year: number | undefined,
  month: number,
  day: number,
  grain: DateGrain,
  start: number,
  end: number,
): CoreDate | null {
  const date = validDateTime(year ?? p.now.getFullYear(), month, day, 0, 0, 0)
  if (!date) {
    return null
  }
  const parsed = core(date, grain, knownFor(grain), start, end)
  return year === undefined ? needsNow(parsed) : parsed
}

/** Written years are absolute here — `26年` is the 26th year, not 2026. */
function civilYear(value: number): number | undefined {
  return value >= 1 && value <= 9999 ? value : undefined
}
