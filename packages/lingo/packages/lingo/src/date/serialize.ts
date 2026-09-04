// v3 compact wire serialization for the date module — the same contract as
// parse/serialize.ts: flat shape, `schemaVersion: 3`, every span carries its
// matched `text` so it reads for itself, dates as ISO strings. Runtime result
// objects keep their accessors (`.date` is a real Date); only what
// `JSON.stringify(result)` / `result.toJSON()` emit changes.
import {
  type SerializedIssue,
  type SerializedSpan,
  serializeIssues,
  spanText,
} from '../parse/serialize'
import type { DurationResult } from './duration'
import type { DateFail, DateGrain, DateRange, DateRangeFail, DateResult } from './parse'
import type { DateZone } from './zone'

export interface SerializedDateAlternative {
  confidence: number
  /** ISO 8601 instant. */
  date: string
  reason: string
  type: 'date'
}

export interface SerializedDate {
  alternatives?: SerializedDateAlternative[]
  confidence: number
  /** ISO 8601 instant (civil time unless the zone was applied — see `zone`). */
  date: string
  grain: DateGrain
  issues: SerializedIssue[]
  known: string[]
  ok: true
  schemaVersion: 3
  span: SerializedSpan
  text: string
  type: 'date'
  zone?: DateZone
}

export interface SerializedDateRangeEndpoint {
  /** ISO 8601 instant. */
  date: string
  grain: DateGrain
  known: string[]
  zone?: DateZone
}

export interface SerializedDateRange {
  confidence: number
  end?: SerializedDateRangeEndpoint
  issues: SerializedIssue[]
  ok: true
  schemaVersion: 3
  span: SerializedSpan
  start?: SerializedDateRangeEndpoint
  text: string
  type: 'date-range'
}

/** Flat duration wire shape — the quantity fields inlined, like a v3 quantity result. */
export interface SerializedDuration {
  base: number
  baseUnit: string
  confidence: number
  issues: SerializedIssue[]
  kind: 'duration'
  ok: true
  parts?: { value: number; unit: string }[]
  schemaVersion: 3
  span: SerializedSpan
  text: string
  type: 'duration'
  unit: string
  value: number
}

export interface SerializedDateFailure {
  candidate?: SerializedDate | SerializedDateRange | SerializedDuration
  issues: SerializedIssue[]
  ok: false
  schemaVersion: 3
  text: string
  type: 'failure'
}

/** Shared tail: version stamp + self-describing spans over the runtime fields. */
function wire(
  result: { issues: DateResult['issues']; text: string },
  span: { start: number; end: number },
): { schemaVersion: 3; span: SerializedSpan; issues: SerializedIssue[] } {
  return {
    schemaVersion: 3,
    span: spanText(span, result.text),
    issues: serializeIssues(result.issues, result.text),
  }
}

function serializeDate(result: DateResult): SerializedDate {
  const { toJSON, alternatives, zone, span, ...rest } = result
  return {
    ...rest,
    ...wire(result, result.span),
    date: result.date.toISOString(),
    ...(zone && { zone }),
    ...(alternatives?.length && {
      alternatives: alternatives.map((alt) => ({ ...alt, date: alt.date.toISOString() })),
    }),
  }
}

function endpoint(ep: NonNullable<DateRange['start']>): SerializedDateRangeEndpoint {
  return { ...ep, date: ep.date.toISOString() }
}

function serializeRange(result: DateRange): SerializedDateRange {
  const { toJSON, anchored, start, end, span, ...rest } = result
  return {
    ...rest,
    ...wire(result, result.span),
    ...(start && { start: endpoint(start) }),
    ...(end && { end: endpoint(end) }),
  }
}

function serializeDuration(result: DurationResult): SerializedDuration {
  const { toJSON, duration, span, ...rest } = result
  const j = duration.toJSON()
  return {
    ...rest,
    kind: 'duration',
    value: j.value,
    unit: j.unit,
    base: j.base,
    baseUnit: j.baseUnit,
    ...(j.parts && { parts: j.parts }),
    ...wire(result, result.span),
  }
}

function serializeFailure(
  result: DateFail<DateResult | DurationResult> | DateRangeFail,
): SerializedDateFailure {
  const candidate = 'candidate' in result ? result.candidate : undefined
  return {
    schemaVersion: 3,
    ok: false,
    type: 'failure',
    text: result.text,
    issues: serializeIssues(result.issues, result.text),
    ...(candidate && {
      candidate:
        candidate.type === 'duration' ? serializeDuration(candidate) : serializeDate(candidate),
    }),
  }
}

function attach<T extends object>(result: T, serialize: (value: T) => unknown): T {
  // Enumerable for the same JavaScriptCore fast-path reason as
  // parse/serialize.ts attachSerialization — see the comment there.
  Object.defineProperty(result, 'toJSON', {
    value(this: T): unknown {
      return serialize(this)
    },
    enumerable: true,
    configurable: true,
    writable: true,
  })
  return result
}

/** Attach the v3 `toJSON()` to a `parseDate()` result (success or failure). */
export function attachDateSerialization<T extends DateResult | DateFail<DateResult>>(result: T): T {
  return attach(result, (value) =>
    value.ok ? serializeDate(value) : serializeFailure(value as DateFail<DateResult>),
  )
}

/** Attach the v3 `toJSON()` to a `parseDateRange()` result. */
export function attachDateRangeSerialization<T extends DateRange | DateRangeFail>(result: T): T {
  return attach(result, (value) =>
    value.ok ? serializeRange(value) : serializeFailure(value as DateRangeFail),
  )
}

/** Attach the v3 `toJSON()` to a `parseDuration()` result. */
export function attachDurationSerialization<T extends DurationResult | DateFail<DurationResult>>(
  result: T,
): T {
  return attach(result, (value) =>
    value.ok ? serializeDuration(value) : serializeFailure(value as DateFail<DurationResult>),
  )
}
