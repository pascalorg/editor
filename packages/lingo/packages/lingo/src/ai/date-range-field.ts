import type { DateOptions, DateRange } from '../date/index'
import { parseDateRange } from '../date/index'
import {
  createField,
  failureFrom,
  type LingoField,
  messageFailure,
  stringJsonSchema,
  withWarnings,
} from './standard-schema'

/** A canonicalized time slot: ISO 8601 endpoints, either side open. */
export interface CanonicalDateRange {
  end?: string
  start?: string
}

export type DateRangeFieldOptions = DateOptions & {
  description?: string
  /**
   * Fail reference-time-dependent slots ("2pm to 4pm") unless an explicit `now`
   * is provided. Default true (plan 020): a tool call canonicalized at retry
   * time must not drift with the wall clock.
   */
  requireNow?: boolean
}

/**
 * A Standard Schema + JSON Schema field that canonicalizes any
 * `parseDateRange()` shape — a time slot ("2pm to 4pm", "between 9am and 5pm",
 * "9-5", "from 3pm"), a dated span ("Aug 3 - Aug 9"), or a whole calendar
 * period ("next week", "August") — into `{ start?, end?: ISO 8601 }`, with
 * periods widened to their real first and last day. Same tool-boundary defaults
 * as `dateField` (plan 020): the range is reference-dependent, so it fails with
 * NOW_REQUIRED unless `now` is passed, and an unapplied TZ_IGNORED escalates —
 * downgrade via `escalate: { TZ_IGNORED: 'warning' }`, or resolve real instants
 * with `applyZone: true`.
 * @example
 * ```ts
 * import { dateRangeField } from '@pascal-app/lingo/ai'
 * const slot = dateRangeField({ now: new Date(Date.UTC(2026, 6, 3, 9)) })
 * slot.parse('2pm to 4pm') // { start: '2026-07-03T14:00:00.000Z', end: '2026-07-03T16:00:00.000Z' }
 * ```
 */
export function dateRangeField(opts: DateRangeFieldOptions = {}): LingoField<CanonicalDateRange> {
  return createField<CanonicalDateRange>(
    (value) => {
      if (typeof value !== 'string') {
        return messageFailure('Expected a string time-range input.')
      }
      const result = parseDateRange(value, toolOptions(opts))
      if (!result.ok) {
        return failureFrom(result.issues, opts, null)
      }
      return withWarnings({ value: canonical(result) }, result.issues, opts)
    },
    {
      // Emitted keywords deliberately stay draft-07 / draft-2020-12 / openapi-3.0 portable.
      input: () => stringJsonSchema(rangeInputDescription(opts)),
      output: () => ({
        type: 'object',
        properties: {
          start: { type: 'string', format: 'date-time', description: 'Slot start, ISO 8601.' },
          end: { type: 'string', format: 'date-time', description: 'Slot end, ISO 8601.' },
        },
        additionalProperties: false,
      }),
    },
  )
}

function canonical(result: DateRange): CanonicalDateRange {
  const out: CanonicalDateRange = {}
  if (result.start) {
    out.start = result.start.date.toISOString()
  }
  if (result.end) {
    out.end = result.end.date.toISOString()
  }
  return out
}

function toolOptions(opts: DateRangeFieldOptions): DateOptions {
  return {
    ...opts,
    ...(opts.now === undefined && opts.requireNow === false ? { now: new Date() } : {}),
    escalate: { TZ_IGNORED: 'error', ...opts.escalate },
  }
}

function rangeInputDescription(opts: DateRangeFieldOptions): string {
  if (opts.description) {
    return opts.description
  }
  return 'A natural-language time slot like "2pm to 4pm" or "9-5", a date span like "Aug 3 - Aug 9", or a whole period like "next week" or "August".'
}
