import { makeIssue } from '../core/errors'
import type { LingoIssue, Span } from '../core/types'
import { addCalendar } from './civil'
import type { DateGrain, DateRange, DateRangeEndpoint, DateRangeFail } from './parse'
import { confidence, knownFor, type P } from './state'
import { parseTimeCore } from './time'
import { TIME_ALIASES } from './vocab'
import { applyZoneToCivil, type DateZone, stripTrailingZone } from './zone'

export interface Endpoint {
  /** The endpoint stated its own half: a trailing am/pm, or a named time (noon/midnight). */
  explicit: boolean
  grain: DateGrain
  hour: number
  minute: number
  second: number
  zone?: DateZone
}

function meridiemHour(hour: number, meridiem: 'am' | 'pm'): number {
  if (meridiem === 'pm' && hour < 12) {
    return hour + 12
  }
  if (meridiem === 'am' && hour === 12) {
    return 0
  }
  return hour
}

/** Whether a resolved endpoint hour is unambiguous and must not be re-halved. */
function isFixed(ep: Endpoint): boolean {
  // Explicit am/pm or named; a 24h hour (≥13); or midnight (0 is only ever
  // midnight, never noon — so "12:00 to 00:00" keeps 00:00 as midnight).
  return ep.explicit || ep.hour >= 13 || ep.hour === 0
}

/** Parse one range endpoint: a full time, or a bare hour (grain hour, no meridiem). */
export function parseRangeEndpoint(p: P, text: string): Endpoint | null {
  const trimmed = text.trim()
  if (trimmed === '') {
    return null
  }
  const stripped = stripTrailingZone(trimmed, p.now)
  const zone = stripped?.zone ? { ...stripped.zone, applied: Boolean(p.opts.applyZone) } : undefined
  // The am/pm/named test must run on the ZONE-STRIPPED text, else a trailing zone
  // ("3am EST") hides the endpoint's own half and corrupts inference.
  const bareText = (stripped ? stripped.source : trimmed).trim()
  const core = parseTimeCore(p, bareText, [])
  if (core) {
    // Only a trailing am/pm (no word boundary in "2am", so anchor at end) or a
    // named time fixes the half. A bare "5:30" or "05:30" is NOT fixed — it is
    // eligible for am/pm inference, like a bare hour. A 24h hour (≥13) is fixed
    // by value, handled in isFixed().
    const explicit = /(?:am|pm)$/i.test(bareText) || isNamedTime(p, bareText)
    return { ...core, explicit, zone }
  }
  const bare = /^(\d{1,2})$/.exec(trimmed)
  if (bare) {
    const hour = Number(bare[1])
    if (hour > 23) {
      return null
    }
    return { hour, minute: 0, second: 0, grain: 'hour', explicit: false, zone }
  }
  return null
}

function isNamedTime(p: P, text: string): boolean {
  const aliases = p.profile.date?.timeAliases ?? TIME_ALIASES
  return aliases[text.toLowerCase()] !== undefined
}

/**
 * Whole-string splitters, tried in order. The `d` flag is load-bearing: the
 * date-endpoint pass needs exact group offsets to slice `p.text`, because a
 * leading frame word ("between ", "from ") means the left group does not start
 * at offset 0.
 */
export const RANGE_SPLITS: { dash?: true; open?: 'start' | 'end'; re: RegExp }[] = [
  { re: /^between\s+(.+?)\s+and\s+(.+)$/di },
  { re: /^from\s+(.+?)\s+(?:to|till|til|until|through|thru|[-–—])\s+(.+)$/di },
  { re: /^(.+?)\s+(?:to|till|til|until|through|thru)\s+(.+)$/di },
  // Lazy, so it splits at the FIRST dash. Harmless for clocks ("9-5"), but an
  // ISO date is full of dashes — the date pass skips this via `dash`.
  { re: /^(.+?)\s*[-–—]\s*(.+)$/di, dash: true },
  { re: /^from\s+(.+?)(?:\s+onwards?)?$/di, open: 'end' },
  { re: /^(.+?)\s+onwards?$/di, open: 'end' },
  { re: /^(?:until|till|til|before|by)\s+(.+)$/di, open: 'start' },
]

export function endpointDate(p: P, ep: Endpoint, baseDay: Date): DateRangeEndpoint {
  let date = new Date(
    baseDay.getFullYear(),
    baseDay.getMonth(),
    baseDay.getDate(),
    ep.hour,
    ep.minute,
    ep.second,
  )
  if (ep.zone?.applied) {
    date = applyZoneToCivil(date, ep.zone)
  }
  const out: DateRangeEndpoint = { date, grain: ep.grain, known: knownFor(ep.grain) }
  if (ep.zone) {
    out.zone = ep.zone
  }
  return out
}

/** Choose the calendar day for a lone endpoint (today, or next day if past). */
export function rollDay(p: P, ep: Endpoint): Date {
  const day = new Date(p.now.getFullYear(), p.now.getMonth(), p.now.getDate(), ep.hour, ep.minute)
  if (p.forwardDates && day.getTime() < p.now.getTime()) {
    return addCalendar(day, { days: 1 })
  }
  return new Date(p.now.getFullYear(), p.now.getMonth(), p.now.getDate())
}

/**
 * am/pm inference across a pair. Only an EXPLICIT half (am/pm suffix or named
 * time) anchors inference; a 24h hour (≥13) fixes its own endpoint but does NOT
 * pull the ambiguous side into a half (so "05:30 to 17:00" stays 24h literal).
 * When both ends are ambiguous, a descending/equal pair reads as the "9-5"
 * workday shift (9am–5pm); ascending pairs stay as written.
 */
export function inferMeridiem(start: Endpoint, end: Endpoint): [Endpoint, Endpoint] {
  const sFixed = isFixed(start)
  const eFixed = isFixed(end)

  if (!(sFixed || eFixed)) {
    // Both ambiguous. "9 to 5"/"6 to 6" descending or equal → shift end to pm.
    if (start.hour >= end.hour && end.hour < 12) {
      return [start, { ...end, hour: meridiemHour(end.hour, 'pm') }]
    }
    return [start, end]
  }
  if (!sFixed && end.explicit) {
    // "2 to 4pm" → 2pm: pick the highest half that still precedes the end.
    const pm = meridiemHour(start.hour, 'pm')
    if (pm <= end.hour) {
      return [{ ...start, hour: pm }, end]
    }
    const am = meridiemHour(start.hour, 'am')
    return [{ ...start, hour: am <= end.hour ? am : start.hour }, end]
  }
  if (start.explicit && !eFixed) {
    // "9am to 5" → 5pm: pick the lowest half that still follows the start.
    const am = meridiemHour(end.hour, 'am')
    if (am > start.hour) {
      return [start, { ...end, hour: am }]
    }
    return [start, { ...end, hour: meridiemHour(end.hour, 'pm') }]
  }
  return [start, end]
}

export function finishRange(
  p: P,
  span: Span,
  zoneSpan: Span,
  issues: LingoIssue[],
  start: DateRangeEndpoint | undefined,
  end: DateRangeEndpoint | undefined,
  anchored?: boolean,
): DateRange | DateRangeFail {
  // A trailing zone rides along the same way parseTimeOnly exposes it:
  // TZ_IGNORED when detected-not-applied, then AMBIGUOUS_TIMEZONE. Both
  // endpoints share a whole-range zone (same reference) — emit it once.
  const zoneIssues: LingoIssue[] = []
  const seen = new Set<DateZone>()
  for (const ep of [start, end]) {
    const zone = ep?.zone
    if (!zone || seen.has(zone)) {
      continue
    }
    seen.add(zone)
    if (!zone.applied) {
      zoneIssues.push(makeIssue('TZ_IGNORED', { tz: zone.text }, zoneSpan, p.opts.messages))
    }
    if (zone.ambiguous) {
      zoneIssues.push(makeIssue('AMBIGUOUS_TIMEZONE', { tz: zone.text }, zoneSpan, p.opts.messages))
    }
  }
  const all = [...zoneIssues, ...issues].map((it) => {
    const severity = p.escalate[it.code]
    return severity && severity !== it.severity ? { ...it, severity } : it
  })
  // Every endpoint is a time-of-day — reference-dependent, like parseDate's
  // `ref` path — so an absent `now` is NOW_REQUIRED, not a silent host-clock read.
  // Anchored absolute ranges bypass this: they need no reference time.
  if (p.opts.now === undefined && !anchored) {
    return {
      ok: false,
      type: 'date-range-failure',
      text: p.src,
      issues: [...all, makeIssue('NOW_REQUIRED', {}, span, p.opts.messages)],
    }
  }
  if (all.some((it) => it.severity === 'error')) {
    return { ok: false, type: 'date-range-failure', text: p.src, issues: all }
  }
  const result: DateRange = {
    ok: true,
    type: 'date-range',
    issues: all,
    confidence: confidence(all),
    span,
    text: p.src,
  }
  if (start) {
    result.start = start
  }
  if (end) {
    result.end = end
  }
  return result
}
