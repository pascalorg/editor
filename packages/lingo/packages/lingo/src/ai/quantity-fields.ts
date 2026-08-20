import { RATE_BASED_CONVERSION_ERROR } from '../core/convert'
import { makeIssue } from '../core/errors'
import type { QuantityJSON, QuantityRangeJSON } from '../core/quantity'
import type { Span } from '../core/types'
import type { LingoOptions } from '../index'
import { parseQuantity, parseRange, quantity } from '../index'
import type { FailResult, LingoResult } from '../parse/grammar'
import {
  cleanNumber,
  createField,
  failureFrom,
  type LingoField,
  lingoIssueToStandardIssue,
  messageFailure,
  numberJsonSchema,
  type StandardSchemaV1Failure,
  stringJsonSchema,
  withWarnings,
} from './standard-schema'

export type QuantityFieldOptions = LingoOptions & {
  unit: string
  /** Lower bound, in `unit`. Violations fail with RANGE_MIN. */
  min?: number
  /** Upper bound, in `unit`. Violations fail with RANGE_MAX. */
  max?: number
  output?: 'number' | 'quantity'
  description?: string
}

export type RangeFieldOptions = LingoOptions & {
  unit: string
  min?: number
  max?: number
  output?: 'number' | 'range'
  description?: string
}

export interface CanonicalRange {
  max: number
  min: number
}

/**
 * Tool-boundary defaults (plan 020): a tool argument has no human reading the
 * hint, so the one silent trap with a materially different alternative —
 * AMBIGUOUS_NUMBER ("1,234": 1234 vs 1.234) — fails loudly with a candidate.
 * Benign forgiveness (typos, qualifiers, assumed units) still succeeds and is
 * surfaced via `warnings`. Override by passing the code back at a lower
 * severity in `escalate`.
 */
function toolOptions<T extends LingoOptions>(opts: T): T {
  return { ...opts, escalate: { AMBIGUOUS_NUMBER: 'error', ...opts.escalate } }
}

/**
 * `quantityField` variant (`output: 'quantity'`): returns the full canonical
 * `QuantityJSON` instead of a bare number, preserving compound parts and the
 * approximate flag.
 * @example
 * ```ts
 * import { quantityField } from '@pascal-app/lingo/ai'
 * const height = quantityField({ kind: 'length', unit: 'm', output: 'quantity' })
 * height.parse(`5'11"`)
 * // { schemaVersion: 3, type: 'quantity', kind: 'length', value: 1.8034, unit: 'm', base: 1.8034, baseUnit: 'm' }
 * ```
 */
export function quantityField(
  opts: LingoOptions & {
    unit: string
    min?: number
    max?: number
    output: 'quantity'
    description?: string
  },
): LingoField<QuantityJSON>
/**
 * A Standard Schema + JSON Schema field that parses natural-language quantity
 * text from a model ("2 lbs", `"5'11\""`) into a float-safe number in `unit`.
 * Tool-boundary defaults (plan 020): AMBIGUOUS_NUMBER ("1,234") fails loudly
 * with a `[CODE] message` issue and a did-you-mean candidate — downgrade via
 * `escalate: { AMBIGUOUS_NUMBER: 'warning' }`. Benign forgiveness (typos,
 * assumed units) succeeds and rides along as `warnings`. `min`/`max` are in
 * `unit`; violations fail with RANGE_MIN/RANGE_MAX.
 * @example
 * ```ts
 * import { quantityField } from '@pascal-app/lingo/ai'
 * const weight = quantityField({ kind: 'mass', unit: 'kg', min: 0 })
 * weight.parse('2 lbs') // 0.90718474
 * weight.safeParse('1,234 kg').issues?.[0].message
 * // '[AMBIGUOUS_NUMBER] "1,234" could mean 1234 or 1.234 — assuming 1234. Did you mean 1234 kg?'
 * ```
 */
export function quantityField(
  opts: LingoOptions & {
    unit: string
    min?: number
    max?: number
    output?: 'number'
    description?: string
  },
): LingoField<number>
export function quantityField(opts: QuantityFieldOptions): LingoField<number | QuantityJSON> {
  const effective = toolOptions(opts)
  return createField<number | QuantityJSON>(
    (value) => {
      const input = quantityInput(value)
      if (typeof input !== 'string') {
        return input
      }

      const result = parseQuantity(input, effective)
      if (!result.ok) {
        return failureFrom(result.issues, opts, quantityCandidate(result, opts.unit))
      }

      try {
        const converted = result.quantity.to(opts.unit)
        const bounds = boundsFailure(converted.value, opts)
        if (bounds) {
          return bounds
        }
        return withWarnings(
          {
            value:
              opts.output === 'quantity'
                ? cleanQuantityJson(converted.toJSON())
                : cleanNumber(converted.value),
          },
          result.issues,
          opts,
        )
      } catch (error) {
        return (
          rateRequiredFailure(error, result.quantity.unit, opts.unit, result.span, opts) ??
          messageFailure(errorMessage(error))
        )
      }
    },
    {
      // Emitted keywords deliberately stay draft-07 / draft-2020-12 / openapi-3.0 portable.
      input: () => stringJsonSchema(quantityInputDescription(opts)),
      output: () =>
        opts.output === 'quantity'
          ? quantityJsonSchema()
          : numberJsonSchema(undefined, { minimum: opts.min, maximum: opts.max }),
    },
  )
}

/**
 * `rangeField` variant (`output: 'range'`): returns the full canonical
 * `QuantityRangeJSON` instead of bare numbers, preserving open bounds,
 * exclusivity, fuzzy/approximate origin, and base-unit context.
 * @example
 * ```ts
 * import { rangeField } from '@pascal-app/lingo/ai'
 * const window = rangeField({ kind: 'duration', unit: 'min', output: 'range' })
 * window.parse('under 10 minutes')
 * // { schemaVersion: 3, type: 'range', kind: 'duration', baseUnit: 's', max: { value: 10, unit: 'min', base: 600, exclusive: true } }
 * ```
 */
export function rangeField(
  opts: RangeFieldOptions & { output: 'range' },
): LingoField<QuantityRangeJSON>
/**
 * A Standard Schema + JSON Schema field that parses a natural-language range
 * ("2-4 lbs", "between 5 and 10 kg") into canonical `{ min, max }` numbers in
 * `unit`. Open-ended input ("under 10 kg") fails with
 * RANGE_OPEN_BOUND_NOT_ALLOWED because bare numeric output needs both ends.
 * Same tool-boundary defaults as `quantityField` (plan 020): AMBIGUOUS_NUMBER
 * escalates to a loud failure, and `min`/`max` bounds apply to both ends.
 * @example
 * ```ts
 * import { rangeField } from '@pascal-app/lingo/ai'
 * const window = rangeField({ kind: 'mass', unit: 'kg' })
 * window.parse('2-4 lbs') // { min: 0.90718474, max: 1.81436948 }
 * ```
 */
export function rangeField(
  opts: RangeFieldOptions & { output?: 'number' },
): LingoField<CanonicalRange>
export function rangeField(
  opts: RangeFieldOptions,
): LingoField<CanonicalRange | QuantityRangeJSON> {
  const effective = toolOptions(opts)
  return createField<CanonicalRange | QuantityRangeJSON>(
    (value) => {
      const input = quantityInput(value)
      if (typeof input !== 'string') {
        return input
      }

      const result = parseRange(input, effective)
      if (!result.ok) {
        return failureFrom(result.issues, opts, quantityCandidate(result, opts.unit))
      }

      try {
        const range = result.range.to(opts.unit)
        const min = range.min()
        const max = range.max()
        if (opts.output === 'range') {
          const bounds =
            (min ? boundsFailure(min.value, opts) : null) ??
            (max ? boundsFailure(max.value, opts) : null)
          if (bounds) {
            return bounds
          }
          return withWarnings({ value: cleanRangeJson(range.toJSON()) }, result.issues, opts)
        }
        if (!min) {
          return openBoundFailure('min', result.span, opts)
        }
        if (!max) {
          return openBoundFailure('max', result.span, opts)
        }
        const bounds = boundsFailure(min.value, opts) ?? boundsFailure(max.value, opts)
        if (bounds) {
          return bounds
        }
        return withWarnings(
          { value: { min: cleanNumber(min.value), max: cleanNumber(max.value) } },
          result.issues,
          opts,
        )
      } catch (error) {
        return (
          rateRequiredFailure(error, rangeUnit(result.range), opts.unit, result.span, opts) ??
          messageFailure(errorMessage(error))
        )
      }
    },
    {
      input: () => stringJsonSchema(rangeInputDescription(opts)),
      output: () => (opts.output === 'range' ? quantityRangeJsonSchema() : rangeJsonSchema(opts)),
    },
  )
}

function quantityInput(value: unknown): string | StandardSchemaV1Failure {
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return messageFailure('Expected a string or finite number.')
}

function cleanQuantityJson(json: QuantityJSON): QuantityJSON {
  const next: QuantityJSON = {
    ...json,
    value: cleanNumber(json.value),
    base: cleanNumber(json.base),
  }
  if (json.parts) {
    next.parts = json.parts.map((part) => ({ ...part, value: cleanNumber(part.value) }))
  }
  return next
}

function cleanRangeJson(json: QuantityRangeJSON): QuantityRangeJSON {
  const next: QuantityRangeJSON = { ...json }
  if (json.min) {
    next.min = cleanRangeValue(json.min)
  }
  if (json.max) {
    next.max = cleanRangeValue(json.max)
  }
  if (json.plusMinus) {
    next.plusMinus = {
      center: cleanRangeValue(json.plusMinus.center),
      delta: cleanRangeValue(json.plusMinus.delta),
    }
  }
  return next
}

function cleanRangeValue<T extends { base: number; value: number }>(value: T): T {
  return { ...value, value: cleanNumber(value.value), base: cleanNumber(value.base) }
}

function boundsFailure(
  value: number,
  opts: Pick<QuantityFieldOptions, 'min' | 'max' | 'unit' | 'messages'>,
): StandardSchemaV1Failure | null {
  if (opts.min !== undefined && value < opts.min) {
    const issue = makeIssue(
      'RANGE_MIN',
      { min: boundLabel(opts.min, opts.unit) },
      undefined,
      opts.messages,
    )
    return { issues: [lingoIssueToStandardIssue(issue, opts)] }
  }
  if (opts.max !== undefined && value > opts.max) {
    const issue = makeIssue(
      'RANGE_MAX',
      { max: boundLabel(opts.max, opts.unit) },
      undefined,
      opts.messages,
    )
    return { issues: [lingoIssueToStandardIssue(issue, opts)] }
  }
  return null
}

function openBoundFailure(
  missing: 'min' | 'max',
  span: Span,
  opts: Pick<RangeFieldOptions, 'messages'>,
): StandardSchemaV1Failure {
  const issue = makeIssue('RANGE_OPEN_BOUND_NOT_ALLOWED', { missing }, span, opts.messages)
  return { issues: [lingoIssueToStandardIssue(issue, opts)] }
}

function rateRequiredFailure(
  error: unknown,
  from: string | null,
  to: string,
  span: Span,
  opts: Pick<QuantityFieldOptions, 'messages'>,
): StandardSchemaV1Failure | null {
  if (!(error instanceof Error) || error.message !== RATE_BASED_CONVERSION_ERROR || !from) {
    return null
  }
  const issue = makeIssue('RATE_REQUIRED', { from, to }, span, opts.messages)
  return { issues: [lingoIssueToStandardIssue(issue, opts)] }
}

function rangeUnit(range: {
  minUnit: string | null
  maxUnit: string | null
  plusMinus?: { unit: string }
}): string | null {
  return range.minUnit ?? range.maxUnit ?? range.plusMinus?.unit ?? null
}

function boundLabel(value: number, unit: string): string {
  try {
    return quantity(value, unit).format()
  } catch {
    return `${value} ${unit}`
  }
}

function quantityCandidate(result: FailResult, unit: string): string | null {
  const candidate = result.candidate
  if (!candidate) {
    return null
  }
  try {
    return formatCandidate(candidate, unit)
  } catch {
    return null
  }
}

function formatCandidate(candidate: Exclude<LingoResult, FailResult>, unit: string): string {
  if (candidate.type === 'quantity') {
    return candidate.quantity.to(unit).format()
  }
  if (candidate.type === 'range') {
    return candidate.range.to(unit).format()
  }
  if (candidate.type === 'conversion') {
    return candidate.converted.to(unit).format()
  }
  return String(candidate.value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function quantityInputDescription(opts: QuantityFieldOptions): string {
  // Bounds are safety-critical steering — they append even to custom copy.
  if (opts.description) {
    return `${opts.description}${boundsHint(opts)}`
  }
  const kind = opts.kind ? String(opts.kind) : 'quantity'
  const examples = examplesForKind(kind, opts.unit)
  return `A ${kind} as natural-language text like ${examples}; canonicalized to ${opts.unit}.${boundsHint(opts)}`
}

function rangeInputDescription(opts: RangeFieldOptions): string {
  if (opts.description) {
    return `${opts.description}${boundsHint(opts)}`
  }
  const kind = opts.kind ? String(opts.kind) : 'quantity'
  return `A ${kind} range as natural-language text like "5-10 ${opts.unit}" or "between 5 and 10 ${opts.unit}".${boundsHint(opts)}`
}

function boundsHint(opts: Pick<QuantityFieldOptions, 'min' | 'max' | 'unit'>): string {
  if (opts.min !== undefined && opts.max !== undefined) {
    return ` Accepted values: ${opts.min} to ${opts.max} ${opts.unit}.`
  }
  if (opts.min !== undefined) {
    return ` Accepted values: at least ${opts.min} ${opts.unit}.`
  }
  if (opts.max !== undefined) {
    return ` Accepted values: at most ${opts.max} ${opts.unit}.`
  }
  return ''
}

function examplesForKind(kind: string, unit: string): string {
  if (kind === 'length') {
    return `"5'11\\"" or "180 cm"`
  }
  if (kind === 'mass') {
    return '"2 kg" or "5 lbs"'
  }
  if (kind === 'temperature') {
    return '"72 F" or "20 C"'
  }
  if (kind === 'duration') {
    return '"2 hours" or "30 min"'
  }
  if (kind === 'data_rate') {
    return '"5 Mbps" or "20 MB/s"'
  }
  if (kind === 'flow_rate') {
    return '"5 gpm" or "250 mL/min"'
  }
  if (kind === 'acceleration') {
    return '"9.8 m/s²" or "2 gees"'
  }
  if (kind === 'torque') {
    return '"10 Nm" or "80 lb-ft"'
  }
  if (kind === 'illuminance') {
    return '"500 lux" or "50 foot-candles"'
  }
  if (kind === 'luminance') {
    return '"100 nits" or "300 cd/m²"'
  }
  if (kind === 'concentration') {
    return '"1 M" or "250 μM"'
  }
  if (kind === 'radiation_absorbed_dose') {
    return '"2 Gy" or "500 mGy"'
  }
  if (kind === 'radiation_equivalent_dose') {
    return '"20 mSv" or "2 rem"'
  }
  if (kind === 'radioactivity') {
    return '"100 Bq" or "5 MBq"'
  }
  return `"2 ${unit}" or "1.5 ${unit}"`
}

function rangeJsonSchema(opts: Pick<RangeFieldOptions, 'min' | 'max'>): Record<string, unknown> {
  const bounds = { minimum: opts.min, maximum: opts.max }
  return {
    type: 'object',
    properties: {
      min: numberJsonSchema(undefined, bounds),
      max: numberJsonSchema(undefined, bounds),
    },
    required: ['min', 'max'],
    additionalProperties: false,
  }
}

function quantityRangeJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      schemaVersion: { type: 'number', enum: [3] },
      type: { type: 'string', enum: ['range'] },
      kind: { type: 'string' },
      baseUnit: { type: 'string' },
      min: rangeValueJsonSchema(),
      max: rangeValueJsonSchema(),
      plusMinus: {
        type: 'object',
        properties: {
          center: rangeValueJsonSchema(),
          delta: rangeValueJsonSchema(),
        },
        required: ['center', 'delta'],
        additionalProperties: false,
      },
      approximate: { type: 'boolean' },
      fuzzy: {
        type: 'object',
        properties: {
          term: { type: 'string' },
          profile: { type: 'string' },
        },
        required: ['term', 'profile'],
        additionalProperties: false,
      },
    },
    required: ['schemaVersion', 'type', 'kind', 'baseUnit'],
    additionalProperties: false,
  }
}

function rangeValueJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      value: { type: 'number' },
      unit: { type: 'string' },
      base: { type: 'number' },
      exclusive: { type: 'boolean' },
    },
    required: ['value', 'unit', 'base'],
    additionalProperties: false,
  }
}

function quantityJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      schemaVersion: { type: 'number', enum: [3] },
      type: { type: 'string', enum: ['quantity'] },
      kind: { type: 'string' },
      value: { type: 'number' },
      unit: { type: 'string' },
      base: { type: 'number' },
      baseUnit: { type: 'string' },
      approximate: { type: 'boolean' },
      parts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            unit: { type: 'string' },
            value: { type: 'number' },
          },
          required: ['unit', 'value'],
          additionalProperties: false,
        },
      },
    },
    required: ['schemaVersion', 'type', 'kind', 'value', 'unit', 'base', 'baseUnit'],
    additionalProperties: false,
  }
}
