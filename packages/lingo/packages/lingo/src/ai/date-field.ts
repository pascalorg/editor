import { makeIssue } from '../core/errors'
import type { DateFail, DateOptions, DateResult } from '../date/index'
import { parseDate } from '../date/index'
import {
  createField,
  failureFrom,
  type LingoField,
  lingoIssueToStandardIssue,
  messageFailure,
  type StandardSchemaV1Failure,
  stringJsonSchema,
  withWarnings,
} from './standard-schema'

export type DateFieldOptions = DateOptions & {
  description?: string
  /**
   * Fail reference-time-dependent inputs ("tomorrow", "March 5", "at 3pm")
   * unless an explicit `now` is provided. Default true (plan 020): a tool call
   * canonicalized at retry time must not drift with the wall clock.
   */
  requireNow?: boolean
  /** Earliest acceptable instant (Date or ISO string). Violations fail with RANGE_MIN. */
  min?: Date | string
  /** Latest acceptable instant (Date or ISO string). Violations fail with RANGE_MAX. */
  max?: Date | string
}

/**
 * A Standard Schema + JSON Schema field that canonicalizes natural-language
 * dates ("tomorrow", "March 5th", "2026-07-03") to ISO 8601 strings.
 * Tool-boundary defaults: reference-time-dependent inputs fail with NOW_REQUIRED
 * unless an explicit `now` is passed (`requireNow` defaults true, so retries
 * can't drift with the wall clock), and TZ_IGNORED escalates to error —
 * downgrade via `escalate: { TZ_IGNORED: 'warning' }`. `min`/`max` bound the
 * accepted instant and fail with RANGE_MIN/RANGE_MAX.
 * @example
 * ```ts
 * import { dateField } from '@pascal-app/lingo/ai'
 * const eta = dateField({ now: new Date(Date.UTC(2026, 6, 3, 12)) })
 * eta.parse('in 2 hours') // '2026-07-03T14:00:00.000Z'
 * dateField().safeParse('tomorrow').issues?.[0].message // '[NOW_REQUIRED] …'
 * ```
 */
export function dateField(opts: DateFieldOptions = {}): LingoField<string> {
  // Tool-boundary default: a timezone the parser ignored is a
  // wrong absolute instant, so TZ_IGNORED fails loudly here. Downgrade via
  // `escalate: { TZ_IGNORED: 'warning' }` if the host zone is intended.
  const min = boundDate(opts.min, 'min')
  const max = boundDate(opts.max, 'max')
  return createField<string>(
    (value) => {
      if (typeof value !== 'string') {
        return messageFailure('Expected a string date input.')
      }

      const result = parseDate(value, toolOptions(opts))
      if (!result.ok) {
        return dateFailure(result, opts)
      }

      if (min && result.date.getTime() < min.getTime()) {
        return dateBoundFailure('RANGE_MIN', min, opts)
      }
      if (max && result.date.getTime() > max.getTime()) {
        return dateBoundFailure('RANGE_MAX', max, opts)
      }

      return withWarnings({ value: result.date.toISOString() }, result.issues, opts)
    },
    {
      // Emitted keywords deliberately stay draft-07 / draft-2020-12 / openapi-3.0 portable.
      input: () => stringJsonSchema(dateInputDescription(opts)),
      output: () => ({
        type: 'string',
        format: 'date-time',
        description: 'An ISO 8601 date-time string.',
      }),
    },
  )
}

function toolOptions(opts: DateFieldOptions): DateOptions {
  return {
    ...opts,
    ...(opts.now === undefined && opts.requireNow === false ? { now: new Date() } : {}),
    escalate: { TZ_IGNORED: 'error', ...opts.escalate },
  }
}

/**
 * Resolve a bound to an instant. Date-only strings ("2026-01-01") mean LOCAL
 * calendar days — the same reading lingo gives a model's "2026-01-01" — so
 * the boundary date itself is always in range: `min` is the start of that
 * local day, `max` is its inclusive end. (`new Date("2026-01-01")` would be
 * UTC midnight and reject the boundary in any zone east of UTC.)
 * Invalid bounds are configuration errors and throw at field creation.
 */
function boundDate(value: Date | string | undefined, side: 'min' | 'max'): Date | undefined {
  if (value === undefined) {
    return
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(`dateField ${side} is an invalid Date.`)
    }
    return value
  }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  const date = dateOnly
    ? side === 'min'
      ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
      : new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 23, 59, 59, 999)
    : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`dateField ${side} is not a valid date: ${JSON.stringify(value)}`)
  }
  return date
}

function dateBoundFailure(
  code: 'RANGE_MIN' | 'RANGE_MAX',
  bound: Date,
  opts: Pick<DateFieldOptions, 'messages'>,
): StandardSchemaV1Failure {
  const iso = bound.toISOString()
  const issue =
    code === 'RANGE_MIN'
      ? makeIssue('RANGE_MIN', { min: iso }, undefined, opts.messages)
      : makeIssue('RANGE_MAX', { max: iso }, undefined, opts.messages)
  return { issues: [lingoIssueToStandardIssue(issue, opts)] }
}

function dateFailure(
  result: DateFail<DateResult>,
  opts: Pick<DateFieldOptions, 'messages'>,
): StandardSchemaV1Failure {
  const candidate = result.candidate ? result.candidate.date.toISOString() : null
  return failureFrom(result.issues, opts, candidate)
}

function dateInputDescription(opts: DateFieldOptions): string {
  const window =
    opts.min !== undefined && opts.max !== undefined
      ? ` Accepted window: ${boundLabel(opts.min)} to ${boundLabel(opts.max)}.`
      : opts.min === undefined
        ? opts.max === undefined
          ? ''
          : ` Accepted window: on or before ${boundLabel(opts.max)}.`
        : ` Accepted window: on or after ${boundLabel(opts.min)}.`
  // Bounds are safety-critical steering — they append even to custom copy.
  if (opts.description) {
    return `${opts.description}${window}`
  }
  return `A natural-language date or time like "tomorrow" or "2026-07-03".${window}`
}

function boundLabel(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value
}
