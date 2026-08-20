import { makeIssue } from '../core/errors'
import type { Quantity } from '../core/quantity'
import type { IssueCode, IssueInputData, LingoIssue, Messages, Severity, Span } from '../core/types'
import { resolveLanguageProfile } from '../locale/profile'
import type { LocalePack } from '../locale/types'
import { normalizeInput, toSourceSpan } from '../parse/normalize'
import type { SerializedResult } from '../parse/serialize'
import { tokenize } from '../parse/tokenize'
import { formatShortDate } from './absolute'
import { addCalendar } from './civil'
import { parseUnitDuration } from './duration'
import {
  type Endpoint,
  endpointDate,
  finishRange,
  inferMeridiem,
  parseRangeEndpoint,
  RANGE_SPLITS,
  rollDay,
} from './range'
import { parseDateOnly } from './relative'
import {
  attachDateRangeSerialization,
  attachDateSerialization,
  type SerializedDate,
  type SerializedDateFailure,
  type SerializedDateRange,
} from './serialize'
import { type CoreDate, confidence, issue, knownFor, type P, trimRange } from './state'
import { suffixTimeStarts, trimTrailingFillers } from './suffix'
import { parseTimeOnly, type TimeCore } from './time'
import { TIME_PATTERN } from './vocab'
import { applyZoneToCivil, type DateZone, stripTrailingZone } from './zone'

/**
 * How precisely a parsed date was specified — "2026" is `'year'` grain,
 * "3pm" is `'minute'`. Drives `DateResult.known` and `humanizeDate`'s
 * `maxUnit`/`minUnit`.
 * @example
 * ```ts
 * import { parseDate } from '@pascal-app/lingo/date'
 * const r = parseDate('tomorrow', { now: new Date('2026-07-03') })
 * r.ok && r.grain // 'day'
 * ```
 */
export type DateGrain = 'year' | 'month' | 'week' | 'day' | 'hour' | 'minute' | 'second'

/**
 * Options for `parseDate()`.
 * @example
 * ```ts
 * import { parseDate } from '@pascal-app/lingo/date'
 * parseDate('5/3', { dayFirst: true }) // March 5 — dayFirst flips the numeric-date reading
 * ```
 */
export interface DateOptions {
  /** Resolve a detected timezone to a real UTC instant (default: expose it, keep civil time). */
  applyZone?: boolean
  dayFirst?: boolean
  escalate?: Partial<Record<IssueCode, Severity>>
  forwardDates?: boolean
  locale?: string
  localePacks?: readonly LocalePack[]
  messages?: Messages
  now?: Date
  strictness?: 'forgiving' | 'confirm' | 'strict'
  weekStart?: number
}

/**
 * A successfully parsed date. `known` lists the calendar fields the parse
 * pinned down (`'year'`, `'month'`, `'day'`, `'hour'`…) plus marker entries
 * — `'implied-hour'`, `'implied-day'`, `'weekday'` — when a field was filled
 * by convention rather than stated ("tonight" implies 22:00).
 * @example
 * ```ts
 * import { parseDate } from '@pascal-app/lingo/date'
 * const r = parseDate('tonight', { now: new Date('2026-07-03T10:00:00') })
 * r.ok && r.known // ['year', 'month', 'day', 'hour', 'implied-hour']
 * ```
 */
export interface DateResult {
  alternatives?: DateAlternative[]
  confidence: number
  date: Date
  grain: DateGrain
  issues: LingoIssue[]
  known: string[]
  ok: true
  span: Span
  text: string
  /** v3 wire shape (ISO date, self-describing spans) — what `JSON.stringify` emits. */
  toJSON?(): SerializedDate
  type: 'date'
  /** Timezone detected in the input, when any (see `applyZone`). */
  zone?: DateZone
}

/**
 * `ok: false` from `parseDate()`/`parseDuration()`. Date inputs that depend
 * on a reference time ("tomorrow", "March 5", "at 3pm") fail with
 * `NOW_REQUIRED` unless `now` is passed explicitly.
 * @example
 * ```ts
 * import { parseDate } from '@pascal-app/lingo/date'
 * const r = parseDate('in 2 days') // no `now` passed
 * !r.ok && r.issues[0].code // 'NOW_REQUIRED'
 * ```
 */
export interface DateFail<T = unknown> {
  candidate?: T
  issues: LingoIssue[]
  ok: false
  text: string
  /**
   * v3 wire shape (self-describing spans) — what `JSON.stringify` emits.
   * `parseDuration`'s unit-expression path can fail with a core grammar
   * failure, hence the union.
   */
  toJSON?(): SerializedDateFailure | SerializedResult
}

export interface DateAlternative {
  confidence: number
  date: Date
  reason: string
  type: 'date'
}

/**
 * When `now` is omitted, parsing runs against this fixed anchor — never the
 * host clock — so results stay deterministic. Reference-dependent inputs
 * ("tomorrow") don't silently resolve against it: they fail with
 * NOW_REQUIRED before the anchor can matter. Only anchor-independent parses
 * (full absolute dates) succeed without `now`.
 */
function anchorNow(): Date {
  return new Date(2000, 0, 1, 12)
}

/**
 * Parse a natural-language date: absolute ("2026-07-04", "March 5"), relative
 * ("in 2 days", "tomorrow", "three days ago"), or weekday/period phrases
 * ("next tuesday", "end of this month"). Inputs that need a reference time
 * require an explicit `now` (they fail with NOW_REQUIRED otherwise — the
 * host clock is never read); full absolute dates ("2026-07-04") do not.
 * @example
 * ```ts
 * import { parseDate } from '@pascal-app/lingo/date'
 * const now = new Date('2026-07-03T10:00:00')
 * const r = parseDate('tomorrow', { now })
 * r.ok && r.date.getDate() // 4 (midnight the next calendar day, as a Date)
 * ```
 */
export function parseDate(text: string, opts?: DateOptions): DateResult | DateFail<DateResult> {
  return attachDateSerialization(parseDateImpl(text, opts))
}

function parseDateImpl(text: string, opts?: DateOptions): DateResult | DateFail<DateResult> {
  const now = opts?.now === undefined ? anchorNow() : new Date(opts.now.getTime())
  const n = normalizeInput(text)
  const p: P = {
    src: text,
    n,
    text: n.text,
    tokens: tokenize(n),
    now,
    opts: opts ?? {},
    profile: resolveLanguageProfile(opts?.localePacks, opts?.locale),
    weekStart: normalizeWeekStart(opts?.weekStart),
    forwardDates: opts?.forwardDates ?? true,
    escalate: dateEscalate(opts),
  }
  const { start, end } = trimRange(n.text, 0, n.text.length)
  if (start === end) {
    return fail(p, 'NO_VALUE', { example: '"tomorrow"' }, start, end)
  }
  const parsed = parseWithOptionalTime(p, start, end)
  if (parsed) {
    return ok(p, parsed)
  }
  const loneNumber = /^\d+$/.test(n.text.slice(start, end))
  return fail(
    p,
    loneNumber ? 'NO_VALUE' : 'UNSUPPORTED_DATE',
    { example: '"tomorrow" or "2026-07-03"' },
    start,
    end,
  )
}

function dateEscalate(opts: DateOptions | undefined): Partial<Record<IssueCode, Severity>> {
  const out: Partial<Record<IssueCode, Severity>> = {}
  if (opts?.strictness === 'confirm' || opts?.strictness === 'strict') {
    out.AMBIGUOUS_DATE = 'error'
    out.WEEKDAY_ASSUMED_NEXT = 'error'
  }
  return Object.assign(out, opts?.escalate)
}

function parseWithOptionalTime(p: P, start: number, end: number): CoreDate | null {
  const source = p.text.slice(start, end)
  const timePattern = dateTimePattern(p)
  const trailing = new RegExp(`^(.*?)(?:\\s+)?(${timePattern})$`, 'i').exec(source)
  if (trailing?.[1] && trailing[2]) {
    const localTimeStart = source.length - trailing[2].length
    const { start: dateStart, end: dateEnd } = trimRange(p.text, start, start + trailing[1].length)
    const { start: timeStart, end: timeEnd } = trimRange(p.text, start + localTimeStart, end)
    if (dateStart < dateEnd) {
      const dateCore = parseDateOnly(p, dateStart, dateEnd, true)
      const timeCore = parseTimeOnly(p, timeStart, timeEnd)
      if (dateCore && timeCore) {
        return attachTime(dateCore, timeCore, start, end)
      }
    }
  }

  const leading = new RegExp(`^(${timePattern})\\s+(?:on\\s+)?(.+)$`, 'i').exec(source)
  if (leading?.[1] && leading[2]) {
    const timeEnd = start + leading[1].length
    const dateStart = end - leading[2].length
    const timeCore = parseTimeOnly(p, start, timeEnd)
    const dateCore = parseDateOnly(p, dateStart, end, true)
    if (timeCore && dateCore) {
      return attachTime(dateCore, timeCore, start, end)
    }
  }

  const unspaced = parseUnspacedDateTime(p, start, end)
  if (unspaced) {
    return unspaced
  }

  const dateOnly = parseDateOnly(p, start, end, true)
  if (dateOnly) {
    return dateOnly
  }

  const timeOnly = parseTimeOnly(p, start, end)
  if (timeOnly) {
    let date = new Date(
      p.now.getFullYear(),
      p.now.getMonth(),
      p.now.getDate(),
      timeOnly.hour,
      timeOnly.minute,
      timeOnly.second,
    )
    if (p.forwardDates && date.getTime() < p.now.getTime()) {
      date = addCalendar(date, { days: 1 })
    }
    return {
      date,
      grain: timeOnly.grain,
      known: knownFor(timeOnly.grain),
      normStart: start,
      normEnd: end,
      issues: timeOnly.issues,
      ref: true,
      zone: timeOnly.zone,
    }
  }
  return null
}

function dateTimePattern(p: P): string {
  return p.profile.date?.timePattern ?? TIME_PATTERN
}

/**
 * Date and clock written as one unbroken run (`明天下午3点`, `明日の午後3時半`).
 * Candidate split points come from the pack's clock vocabulary, so this scan
 * only runs for packs that declare one and only tries the few offsets where a
 * clock can actually begin.
 */
function parseUnspacedDateTime(p: P, start: number, end: number): CoreDate | null {
  const source = p.text.slice(start, end)
  for (const at of suffixTimeStarts(p, source)) {
    const timeCore = parseTimeOnly(p, start + at, end)
    if (!timeCore) {
      continue
    }
    const head = trimTrailingFillers(p, source.slice(0, at))
    if (head.length === 0) {
      continue
    }
    const dateCore = parseDateOnly(p, start, start + head.length, true)
    if (dateCore) {
      return attachTime(dateCore, timeCore, start, end)
    }
  }
  return null
}

function attachTime(core: CoreDate, time: TimeCore, start: number, end: number): CoreDate {
  const date = new Date(core.date.getTime())
  date.setHours(time.hour, time.minute, time.second, 0)
  return {
    date,
    grain: time.grain,
    known: mergeKnown(core.known, knownFor(time.grain)),
    normStart: start,
    normEnd: end,
    issues: [...core.issues, ...time.issues],
    ref: core.ref,
    alternatives: core.alternatives,
    zone: time.zone ?? core.zone,
  }
}

function ok(p: P, parsed: CoreDate): DateResult | DateFail<DateResult> {
  // `applyZone`: reinterpret the civil wall-clock fields in the detected zone to
  // get the real UTC instant. Otherwise the civil time is kept and `zone` is
  // exposed for the caller to apply.
  const date = parsed.zone?.applied ? applyZoneToCivil(parsed.date, parsed.zone) : parsed.date
  const result: DateResult = {
    ok: true,
    type: 'date',
    date,
    grain: parsed.grain,
    known: [...new Set(parsed.known)],
    span: toSourceSpan(p.n, parsed.normStart, parsed.normEnd),
    issues: parsed.issues,
    confidence: confidence(parsed.issues),
    text: p.src,
  }
  if (parsed.zone) {
    result.zone = parsed.zone
  }
  if (parsed.alternatives && parsed.alternatives.length > 0) {
    result.alternatives = parsed.alternatives
  }
  const issues = parsed.issues.map((it) => {
    const severity = p.escalate[it.code]
    return severity && severity !== it.severity ? { ...it, severity } : it
  })
  if (p.opts.now === undefined && parsed.ref) {
    return {
      ok: false,
      text: p.src,
      issues: [...issues, makeIssue('NOW_REQUIRED', {}, result.span, p.opts.messages)],
    }
  }
  return issues.some((it) => it.severity === 'error')
    ? { ok: false, text: p.src, issues, candidate: result }
    : { ...result, issues }
}

function fail<C extends 'NO_VALUE' | 'UNSUPPORTED_DATE'>(
  p: P,
  code: C,
  data: IssueInputData<C>,
  start: number,
  end: number,
): DateFail<DateResult> {
  return {
    ok: false,
    text: p.src,
    issues: [issue(p, code, data, start, end)],
  }
}

function mergeKnown(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])]
}

function normalizeWeekStart(value: number | undefined): number {
  if (value === undefined || !Number.isInteger(value)) {
    return 1
  }
  return ((value % 7) + 7) % 7
}

/** One endpoint of a time range/slot. */
export interface DateRangeEndpoint {
  date: Date
  grain: DateGrain
  known: string[]
  zone?: DateZone
}

/** A time range/slot from `parseDateRange()` — either or both ends may be open. */
export interface DateRange {
  /**
   * True when the range came from the `N <duration> starting <anchor>` grammar,
   * so `humanizeDateRange()` renders it as "N days starting …" rather than a
   * clock phrase. Runtime-only provenance; never serialized.
   */
  anchored?: boolean
  confidence: number
  /**
   * True when the endpoints came from the calendar grammar rather than the
   * clock, so `humanizeDateRange()` renders dates instead of bare times.
   * Runtime-only provenance; never serialized.
   */
  dated?: boolean
  end?: DateRangeEndpoint
  issues: LingoIssue[]
  ok: true
  span: Span
  start?: DateRangeEndpoint
  text: string
  /** v3 wire shape (ISO endpoints, self-describing spans) — what `JSON.stringify` emits. */
  toJSON?(): SerializedDateRange
  type: 'date-range'
}

/** `ok: false` from `parseDateRange()`. */
export interface DateRangeFail {
  issues: LingoIssue[]
  ok: false
  text: string
  /** v3 wire shape (self-describing spans) — what `JSON.stringify` emits. */
  toJSON?(): SerializedDateFailure
  type: 'date-range-failure'
}

/**
 * Parse a range in one of three shapes, tried in that order:
 *
 * 1. a time slot — `2pm to 4pm`, `between 9am and 5pm`, `9-5`, `from 3pm`,
 *    `until 5`, with am/pm inference across the pair and cross-midnight
 *    rollover; time-of-day today (next day when past, like `parseDate`);
 * 2. a dated span — `July 1 to July 5`, `Aug 3 - Aug 9`, `Mon-Fri`,
 *    `2026-08-01 to 2026-08-05`, where the end resolves against the start
 *    rather than `now`, and two absolute dates given backwards are swapped
 *    with `RANGE_REVERSED`;
 * 3. a whole calendar period — `next week`, `next month`, `August`, `2027`,
 *    `this weekend` — widened to its real first and last day. A coarse
 *    endpoint widens on the closing side too, so `July to August` ends
 *    August 31 while `from August` opens on the 1st.
 *
 * Shapes 2 and 3 set `dated`, which is what `humanizeDateRange()` reads to
 * render dates instead of clock times.
 * @example
 * ```ts
 * import { parseDateRange } from '@pascal-app/lingo/date'
 * const r = parseDateRange('2pm to 4pm', { now: new Date('2026-07-03T09:00:00') })
 * r.ok && [r.start?.date.getHours(), r.end?.date.getHours()] // [14, 16]
 *
 * const august = parseDateRange('August', { now: new Date('2026-07-03T09:00:00') })
 * august.ok && [august.start?.date.getDate(), august.end?.date.getDate()] // [1, 31]
 * ```
 */
export function parseDateRange(text: string, opts?: DateOptions): DateRange | DateRangeFail {
  return attachDateRangeSerialization(parseDateRangeImpl(text, opts))
}

function parseDateRangeImpl(text: string, opts?: DateOptions): DateRange | DateRangeFail {
  const now = opts?.now === undefined ? anchorNow() : new Date(opts.now.getTime())
  const n = normalizeInput(text)
  const p: P = {
    src: text,
    n,
    text: n.text,
    tokens: tokenize(n),
    now,
    opts: opts ?? {},
    profile: resolveLanguageProfile(opts?.localePacks, opts?.locale),
    weekStart: normalizeWeekStart(opts?.weekStart),
    forwardDates: opts?.forwardDates ?? true,
    escalate: dateEscalate(opts),
  }
  let source = n.text.trim()
  const issues: LingoIssue[] = []
  // Point the span at the trimmed content, not the padded input.
  const { start: spanStart, end: spanEnd } = trimRange(n.text, 0, n.text.length)
  const span = toSourceSpan(p.n, spanStart, spanEnd)
  // A trailing zone applies to the WHOLE slot ("9am to 5pm PST" is both-PST), so
  // peel it once before splitting; each endpoint inherits it unless it carries
  // its own ("2pm EST to 4pm PST"). Its span is the zone token, for the TZ issue.
  let rangeZone: DateZone | undefined
  let zoneSpan = span
  const strippedRange = stripTrailingZone(source, p.now)
  if (strippedRange && strippedRange.source.trim() !== '') {
    rangeZone = { ...strippedRange.zone, applied: Boolean(p.opts.applyZone) }
    zoneSpan = toSourceSpan(p.n, spanEnd - rangeZone.text.length, spanEnd)
    source = strippedRange.source.trim()
  }
  const inherit = (ep: Endpoint): Endpoint => {
    if (!ep.zone && rangeZone) {
      ep.zone = rangeZone
    }
    return ep
  }
  const fail = (): DateRangeFail => ({
    ok: false,
    type: 'date-range-failure',
    text,
    issues: [makeIssue('UNSUPPORTED_DATE', { example: '"2pm to 4pm"' }, span, p.opts.messages)],
  })

  const anchored = parseAnchoredDurationRange(
    p,
    source,
    spanStart,
    span,
    zoneSpan,
    issues,
    rangeZone,
  )
  if (anchored) {
    return anchored
  }

  for (const { re, open } of RANGE_SPLITS) {
    const m = re.exec(source)
    if (!m) {
      continue
    }
    if (open === 'end') {
      const start = parseRangeEndpoint(p, m[1]!)
      if (!start) {
        continue
      }
      const baseDay = rollDay(p, start)
      return finishRange(
        p,
        span,
        zoneSpan,
        issues,
        endpointDate(p, inherit(start), baseDay),
        undefined,
      )
    }
    if (open === 'start') {
      const end = parseRangeEndpoint(p, m[1]!)
      if (!end) {
        continue
      }
      const baseDay = rollDay(p, end)
      return finishRange(
        p,
        span,
        zoneSpan,
        issues,
        undefined,
        endpointDate(p, inherit(end), baseDay),
      )
    }
    let start = parseRangeEndpoint(p, m[1]!)
    let end = parseRangeEndpoint(p, m[2]!)
    if (!(start && end)) {
      continue
    }
    start = inherit(start)
    end = inherit(end)
    ;[start, end] = inferMeridiem(start, end)
    const baseDay = rollDay(p, start)
    const startEp = endpointDate(p, start, baseDay)
    let endEp = endpointDate(p, end, baseDay)
    // Cross-midnight: an end strictly BEFORE the start rolls to the next day
    // ("10pm to 2am"). Deterministic, like forwardDates — no issue raised. Equal
    // endpoints stay a same-day zero-length slot, never a spurious 24h span.
    if (endEp.date.getTime() < startEp.date.getTime()) {
      endEp = endpointDate(p, end, addCalendar(baseDay, { days: 1 }))
    }
    return finishRange(p, span, zoneSpan, issues, startEp, endEp)
  }

  // Clock endpoints did not take. Retry the same splits against the full date
  // grammar — "July 1 to July 5", "from tomorrow to friday". Order matters:
  // "2pm" parses as a date too (time-only), so the clock pass must win first.
  const dated = parseDateToDateRange(p, source, spanStart, span, zoneSpan, issues, rangeZone)
  if (dated) {
    return dated
  }
  return fail()
}

const SPACED_DASH = /^(.+?)\s+[-–—]\s+(.+)$/d

/**
 * Widen a coarse endpoint to the last day it covers. "August" ends on the 31st
 * whether it stands alone or closes "July to August", and a weekend is named by
 * its Saturday but runs one day longer. A day-grained endpoint widens to itself,
 * which is what makes this safe to run over every closing endpoint.
 */
function widenToPeriodEnd(core: CoreDate, text: string): CoreDate {
  const last = /weekend$/i.test(text)
    ? addCalendar(core.date, { days: 1 })
    : periodEnd(core.date, core.grain)
  return last ? { ...core, date: last, grain: 'day', known: knownFor('day') } : core
}

/** Last day of the period a coarse-grained date names, or null if it names a single day. */
function periodEnd(date: Date, grain: DateGrain): Date | null {
  if (grain === 'week') {
    return addCalendar(date, { days: 6 })
  }
  if (grain === 'month') {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0)
  }
  if (grain === 'year') {
    return new Date(date.getFullYear(), 11, 31)
  }
  return null
}

/** Build a range endpoint from a parsed date, resolving the zone like the anchored path. */
function dateEndpoint(core: CoreDate, rangeZone: DateZone | undefined): DateRangeEndpoint {
  const zone = core.zone ?? rangeZone
  const out: DateRangeEndpoint = {
    date: zone?.applied ? applyZoneToCivil(core.date, zone) : core.date,
    grain: core.grain,
    known: [...new Set(core.known)],
  }
  if (zone) {
    out.zone = zone
  }
  return out
}

function parseDateToDateRange(
  p: P,
  source: string,
  normStart: number,
  span: Span,
  zoneSpan: Span,
  issues: LingoIssue[],
  rangeZone?: DateZone,
): DateRange | DateRangeFail | null {
  // A date coarser than a day already IS a period — "next week" resolves to its
  // Monday, "August" to the 1st. Spanning it needs no separate grammar: parse
  // the whole slot as one date and widen it to the period it names.
  const whole = parseWithOptionalTime(p, normStart, normStart + source.length)
  // A weekend is named by its Saturday at day grain, so it needs the explicit
  // widening the coarse grains get for free.
  const wholeEnd = whole && widenToPeriodEnd(whole, source)
  if (whole && wholeEnd !== whole) {
    return finishDateRange(p, span, zoneSpan, [...issues, ...whole.issues], whole.ref === true, {
      end: dateEndpoint(wholeEnd as CoreDate, rangeZone),
      start: dateEndpoint(whole, rangeZone),
    })
  }

  // The lazy dash rule splits "2026-07-01 - 2026-07-05" at the ISO date's own
  // dash. When the input carries one, demand a SPACED dash instead, which no
  // ISO date contains. "2026-07-01-2026-07-05" stays unparseable, as it should.
  const hasIsoDash = /\d{4}-\d{2}/.test(source)
  for (const { re, open, dash } of RANGE_SPLITS) {
    const m = (dash && hasIsoDash ? SPACED_DASH : re).exec(source)
    if (!m?.indices) {
      continue
    }
    const at = (group: number): [number, number] => {
      const [s, e] = m.indices![group]!
      return [normStart + s, normStart + e]
    }
    const text = (group: number): string => {
      const [s, e] = m.indices![group]!
      return source.slice(s, e)
    }
    if (open) {
      const only = parseWithOptionalTime(p, ...at(1))
      if (!only) {
        continue
      }
      // "until August" has to reach the end of August; "from August" opens at
      // its first day, so only the closing side widens.
      const ep = dateEndpoint(open === 'end' ? only : widenToPeriodEnd(only, text(1)), rangeZone)
      return finishDateRange(p, span, zoneSpan, [...issues, ...only.issues], only.ref === true, {
        ...(open === 'end' ? { start: ep } : { end: ep }),
      })
    }
    const startCore = parseWithOptionalTime(p, ...at(1))
    if (!startCore) {
      continue
    }
    // Each endpoint rolls forward off `now` independently, so a July-3 reference
    // reads "July 1 to July 5" as 2027-07-01 → 2026-07-05 — descending. Anchor
    // the end to the start instead, so the pair always reads left to right.
    const endCore = parseWithOptionalTime({ ...p, now: startCore.date }, ...at(2))
    if (!endCore) {
      continue
    }
    return finishDateRange(
      p,
      span,
      zoneSpan,
      [...issues, ...startCore.issues, ...endCore.issues],
      startCore.ref === true || endCore.ref === true,
      {
        end: dateEndpoint(widenToPeriodEnd(endCore, text(2)), rangeZone),
        start: dateEndpoint(startCore, rangeZone),
      },
    )
  }
  return null
}

/**
 * Absolute date endpoints need no reference time, so they bypass `finishRange`'s
 * blanket NOW_REQUIRED (which exists for clock endpoints). Reference-dependent
 * ones — "tomorrow", "next friday" — still demand an explicit `now`.
 */
function finishDateRange(
  p: P,
  span: Span,
  zoneSpan: Span,
  issues: LingoIssue[],
  needsNow: boolean,
  ends: { end?: DateRangeEndpoint; start?: DateRangeEndpoint },
): DateRange | DateRangeFail {
  if (p.opts.now === undefined && needsNow) {
    return {
      ok: false,
      type: 'date-range-failure',
      text: p.src,
      issues: [...issues, makeIssue('NOW_REQUIRED', {}, span, p.opts.messages)],
    }
  }
  let { start, end } = ends
  const all = [...issues]
  // A dated pair has no overnight reading the way a clock slot does, so
  // descending endpoints are a typo. Swap and say so, the way a reversed
  // quantity range already does, rather than handing back start > end.
  if (start && end && start.date.getTime() > end.date.getTime()) {
    ;[start, end] = [end, start]
    all.push(
      makeIssue(
        'RANGE_REVERSED',
        { fixed: `${formatShortDate(start.date)} to ${formatShortDate(end.date)}` },
        span,
        p.opts.messages,
      ),
    )
  }
  const range = finishRange(p, span, zoneSpan, all, start, end, true)
  if (range.ok) {
    range.dated = true
  }
  return range
}

type CalendarDelta = Parameters<typeof addCalendar>[1]

function parseAnchoredDurationRange(
  p: P,
  source: string,
  normStart: number,
  span: Span,
  zoneSpan: Span,
  issues: LingoIssue[],
  rangeZone?: DateZone,
): DateRange | DateRangeFail | null {
  const m = /^(.+?)\s+starting\s+(.+)$/i.exec(source)
  if (!m) {
    return null
  }
  const durationText = m[1]!
  const anchorText = m[2]!
  const durationStart = normStart
  const durationEnd = durationStart + durationText.length
  const anchorStart = normStart + source.length - anchorText.length
  const anchorEnd = normStart + source.length
  const duration = parseUnitDuration(p.text.slice(durationStart, durationEnd), {
    escalate: p.opts.escalate,
    locale: p.opts.locale,
    localePacks: p.opts.localePacks,
    messages: p.opts.messages,
    strictness: p.opts.strictness,
  })
  if (!duration.ok || duration.duration.base <= 0) {
    return null
  }
  const anchor = parseWithOptionalTime(p, anchorStart, anchorEnd)
  if (!anchor) {
    return null
  }

  if (p.opts.now === undefined && anchor.ref) {
    return {
      ok: false,
      type: 'date-range-failure',
      text: p.src,
      issues: [...issues, makeIssue('NOW_REQUIRED', {}, span, p.opts.messages)],
    }
  }

  const endDate = addCalendar(anchor.date, durationDelta(duration.duration))
  const endGrain = finestGrain(anchor.grain, durationGrain(duration.duration))
  const zone = anchor.zone ?? rangeZone
  const startEp: DateRangeEndpoint = {
    date: zone?.applied ? applyZoneToCivil(anchor.date, zone) : anchor.date,
    grain: anchor.grain,
    known: [...new Set(anchor.known)],
  }
  const endEp: DateRangeEndpoint = {
    date: zone?.applied ? applyZoneToCivil(endDate, zone) : endDate,
    grain: endGrain,
    known: knownFor(endGrain),
  }
  if (zone) {
    startEp.zone = zone
    endEp.zone = zone
  }
  const range = finishRange(
    p,
    span,
    zoneSpan,
    [...issues, ...rebaseIssues(p, duration.issues, durationStart), ...anchor.issues],
    startEp,
    endEp,
    true,
  )
  if (range.ok) {
    range.anchored = true
  }
  return range
}

function rebaseIssues(p: P, issues: readonly LingoIssue[], normOffset: number): LingoIssue[] {
  return issues.map((it) =>
    it.span
      ? {
          ...it,
          span: toSourceSpan(p.n, normOffset + it.span.start, normOffset + it.span.end),
        }
      : it,
  )
}

function durationDelta(duration: Quantity): CalendarDelta {
  if (!duration.parts && Number.isInteger(duration.value)) {
    if (duration.unit === 'd') {
      return { days: duration.value }
    }
    if (duration.unit === 'wk') {
      return { weeks: duration.value }
    }
  }
  return { seconds: duration.base }
}

function durationGrain(duration: Quantity): DateGrain {
  if (duration.unit === 'yr') {
    return 'year'
  }
  if (duration.unit === 'mo') {
    return 'month'
  }
  if (duration.unit === 'wk' || duration.unit === 'd') {
    return 'day'
  }
  if (duration.unit === 'h') {
    return 'hour'
  }
  if (duration.unit === 'min') {
    return 'minute'
  }
  return 'second'
}

function finestGrain(a: DateGrain, b: DateGrain): DateGrain {
  const order: DateGrain[] = ['year', 'month', 'week', 'day', 'hour', 'minute', 'second']
  return order[Math.max(order.indexOf(a), order.indexOf(b))]!
}
