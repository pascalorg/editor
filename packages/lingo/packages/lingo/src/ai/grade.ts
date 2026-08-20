import type { LingoOptions as CoreLingoOptions } from '../index'
import { type DateFieldOptions, dateField } from './date-field'
import { quantityField } from './quantity-fields'
import type { StandardSchemaV1Issue } from './standard-schema'

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

/**
 * Promptfoo-compatible grading result returned by lingo eval helpers.
 * @example
 * ```ts
 * import type { GradeResult } from '@pascal-app/lingo/ai'
 * const result: GradeResult = { pass: true, score: 1, reason: 'Values match.' }
 * result.score // 1
 * ```
 */
export interface GradeResult {
  pass: boolean
  reason: string
  score: number
}

/**
 * Options for `quantityMatch()`. `tolerance` is relative and defaults to
 * `1e-9`; all other options are passed to the shared `quantityField()`.
 * @example
 * ```ts
 * import type { QuantityMatchOptions } from '@pascal-app/lingo/ai'
 * const opts: QuantityMatchOptions = { kind: 'mass', unit: 'kg', tolerance: 1e-6 }
 * opts.unit // 'kg'
 * ```
 */
export interface QuantityMatchOptions extends Omit<CoreLingoOptions, 'tolerance'> {
  tolerance?: number
  unit: string
}

/**
 * Compare two quantity answers after canonicalizing both through one lingo
 * field. Useful for evals where `"2 lbs"` and `0.90718474` should grade the
 * same in kilograms.
 * @example
 * ```ts
 * import { quantityMatch } from '@pascal-app/lingo/ai'
 * quantityMatch('2 lbs', '0.90718474 kg', { kind: 'mass', unit: 'kg' }).pass // true
 * ```
 */
export function quantityMatch(
  actual: unknown,
  expected: unknown,
  opts: QuantityMatchOptions,
): GradeResult {
  const { tolerance = 1e-9, ...fieldOptions } = opts
  const field = quantityField(fieldOptions)
  const actualResult = field.safeParse(actual)
  if (!('value' in actualResult)) {
    return fail(issueMessage(actualResult.issues))
  }
  const expectedResult = field.safeParse(expected)
  if (!('value' in expectedResult)) {
    return fail(issueMessage(expectedResult.issues))
  }

  const relErr = relativeError(actualResult.value, expectedResult.value)
  const pass = relErr <= tolerance
  return {
    pass,
    score: pass ? 1 : Math.max(0, 1 - relErr),
    reason: pass
      ? `Values match within relative tolerance ${tolerance}.`
      : `Expected ${expectedResult.value} ${opts.unit}, got ${actualResult.value} ${opts.unit}; relative error ${relErr} exceeds ${tolerance}.`,
  }
}

/**
 * Calendar grain used by `dateMatch()` before comparing two canonical ISO
 * instants.
 * @example
 * ```ts
 * import type { DateGrain } from '@pascal-app/lingo/ai'
 * const grain: DateGrain = 'day'
 * grain // 'day'
 * ```
 */
export type DateGrain = 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second'

/**
 * Options for `dateMatch()`. `grain` defaults to `'day'`; `timeZone` defaults
 * to the host time zone through `Intl.DateTimeFormat`.
 * @example
 * ```ts
 * import type { DateMatchOptions } from '@pascal-app/lingo/ai'
 * const opts: DateMatchOptions = { grain: 'hour', timeZone: 'UTC' }
 * opts.grain // 'hour'
 * ```
 */
export interface DateMatchOptions extends DateFieldOptions {
  grain?: DateGrain
  timeZone?: string
}

/**
 * Compare two date answers after canonicalizing both through one lingo date
 * field, then truncating the instants to a calendar grain in an optional time
 * zone. Full ISO datetime strings and `Date` instances are treated as absolute
 * instants; yearless or relative inputs like `"March 5"` and `"tomorrow"` need
 * an explicit `now` through `DateMatchOptions` for deterministic grading.
 * @example
 * ```ts
 * import { dateMatch } from '@pascal-app/lingo/ai'
 * dateMatch('2026-07-04T00:00:00.000Z', '2026-07-04T05:30:00.000+05:30', {
 *   grain: 'second',
 *   timeZone: 'UTC',
 * }).pass // true
 * ```
 */
export function dateMatch(
  actual: unknown,
  expected: unknown,
  opts: DateMatchOptions = {},
): GradeResult {
  const { grain = 'day', timeZone, ...fieldOptions } = opts
  const field = dateField(fieldOptions)
  const actualResult = dateForMatch(actual, field)
  if (!('value' in actualResult)) {
    return fail(issueMessage(actualResult.issues))
  }
  const expectedResult = dateForMatch(expected, field)
  if (!('value' in expectedResult)) {
    return fail(issueMessage(expectedResult.issues))
  }

  let actualKey: string
  let expectedKey: string
  try {
    actualKey = truncateInstant(actualResult.value, grain, timeZone)
    expectedKey = truncateInstant(expectedResult.value, grain, timeZone)
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }

  const pass = actualKey === expectedKey
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? `Dates match at ${grain} grain.`
      : `Expected ${expectedKey} at ${grain} grain, got ${actualKey}.`,
  }
}

function fail(reason: string): GradeResult {
  return { pass: false, score: 0, reason }
}

function issueMessage(issues: readonly StandardSchemaV1Issue[]): string {
  return issues[0]?.message ?? 'Invalid value.'
}

function relativeError(actual: number, expected: number): number {
  const diff = Math.abs(actual - expected)
  return expected === 0 ? diff : diff / Math.abs(expected)
}

function dateForMatch(
  value: unknown,
  field: ReturnType<typeof dateField>,
): { value: string } | { issues: readonly StandardSchemaV1Issue[] } {
  if (value instanceof Date) {
    return validDate(value)
      ? { value: value.toISOString() }
      : { issues: [{ message: 'Invalid Date input.' }] }
  }
  if (typeof value === 'string' && ISO_DATETIME.test(value)) {
    const date = new Date(value)
    if (validDate(date)) {
      return { value: date.toISOString() }
    }
  }

  return field.safeParse(value)
}

function validDate(date: Date): boolean {
  return !Number.isNaN(date.getTime())
}

function truncateInstant(iso: string, grain: DateGrain, timeZone: string | undefined): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ISO instant: ${iso}.`)
  }
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }
  if (timeZone) {
    options.timeZone = timeZone
  }
  const formatter = new Intl.DateTimeFormat('en-US-u-ca-iso8601-nu-latn', options)
  const parts: Record<string, string> = {}
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') {
      parts[part.type] = part.value
    }
  }
  const values = [parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second]
  const length = grainLength(grain)
  return values.slice(0, length).join('-')
}

function grainLength(grain: DateGrain): number {
  if (grain === 'year') {
    return 1
  }
  if (grain === 'month') {
    return 2
  }
  if (grain === 'day') {
    return 3
  }
  if (grain === 'hour') {
    return 4
  }
  if (grain === 'minute') {
    return 5
  }
  return 6
}
