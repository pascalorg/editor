import type { IssueCode, LingoIssue, Messages, Severity, Span } from '../core/types'
import { formatIssue } from '../result'

export interface StandardTypedV1Props<Input = unknown, Output = Input> {
  readonly types?: StandardSchemaV1Types<Input, Output>
  readonly vendor: string
  readonly version: 1
}

export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': StandardSchemaV1Props<Input, Output>
}

export interface StandardSchemaV1Props<Input = unknown, Output = Input>
  extends StandardTypedV1Props<Input, Output> {
  readonly validate: (
    value: unknown,
    options?: StandardSchemaV1Options,
  ) => StandardSchemaV1Result<Output> | PromiseLike<StandardSchemaV1Result<Output>>
}

export interface StandardSchemaV1Options {
  readonly libraryOptions?: Record<string, unknown> | undefined
}

export interface StandardSchemaV1Types<Input = unknown, Output = Input> {
  readonly input: Input
  readonly output: Output
}

export type StandardSchemaV1Result<Output> =
  | StandardSchemaV1Success<Output>
  | StandardSchemaV1Failure

export interface StandardSchemaV1Success<Output> {
  readonly issues?: undefined
  readonly value: Output
}

export interface StandardSchemaV1Failure {
  readonly issues: readonly StandardSchemaV1Issue[]
}

/**
 * Standard Schema issue plus lingo's optional structured issue metadata.
 * Generic Standard Schema adapters only need `message`/`path`; direct lingo
 * callers can read the extra fields instead of parsing `[CODE]` copy.
 */
export interface StandardSchemaV1Issue {
  readonly candidate?: string
  readonly code?: IssueCode
  readonly data?: Record<string, unknown>
  readonly message: string
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[]
  readonly severity?: Severity
  readonly span?: Span
  readonly suggestions?: readonly string[]
}

export interface StandardJSONSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': StandardJSONSchemaV1Props<Input, Output>
}

export interface StandardJSONSchemaV1Props<Input = unknown, Output = Input>
  extends StandardTypedV1Props<Input, Output> {
  readonly jsonSchema: StandardJSONSchemaV1Converter
}

export interface StandardJSONSchemaV1Converter {
  readonly input: (options: StandardJSONSchemaV1Options) => Record<string, unknown>
  readonly output: (options: StandardJSONSchemaV1Options) => Record<string, unknown>
}

export interface StandardJSONSchemaV1Options {
  readonly libraryOptions?: Record<string, unknown> | undefined
  readonly target: 'draft-2020-12' | 'draft-07' | 'openapi-3.0' | (string & {})
}

/**
 * Options for `toJSONSchema()`.
 * @example
 * ```ts
 * import { quantityField, toJSONSchema, type ToJSONSchemaOptions } from '@pascal-app/lingo/ai'
 * const opts: ToJSONSchemaOptions = { io: 'output', target: 'draft-07' }
 * toJSONSchema(quantityField({ kind: 'mass', unit: 'kg' }), opts).type // 'number'
 * ```
 */
export interface ToJSONSchemaOptions {
  readonly io?: 'input' | 'output' | undefined
  readonly target?: 'draft-2020-12' | 'draft-07' | 'openapi-3.0' | (string & {}) | undefined
}

/**
 * A non-blocking issue that rode along on a successful parse (typo fixed,
 * unit assumed, ambiguous date read with `dayFirst`…). Standard Schema has no
 * issue channel on success, so lingo surfaces these as an extra `warnings`
 * property — `issues` stays `undefined`, preserving the discriminator.
 */
export interface FieldWarning {
  readonly code: IssueCode
  readonly data?: Record<string, unknown>
  readonly message: string
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[]
  readonly severity: 'warning' | 'info'
  readonly span?: Span
  readonly suggestions?: readonly string[]
}

export interface FieldSuccess<Output> {
  readonly issues?: undefined
  readonly value: Output
  readonly warnings?: readonly FieldWarning[]
}

export type FieldResult<Output> = FieldSuccess<Output> | StandardSchemaV1Failure

export interface LingoStandardProps<Input = unknown, Output = Input>
  extends StandardTypedV1Props<Input, Output> {
  readonly jsonSchema: StandardJSONSchemaV1Converter
  readonly validate: (value: unknown, options?: StandardSchemaV1Options) => FieldResult<Output>
}

export type LingoField<Output, Input = unknown> = StandardSchemaV1<Input, Output> &
  StandardJSONSchemaV1<Input, Output> & {
    readonly '~standard': LingoStandardProps<Input, Output>
    parse(value: unknown): Output
    safeParse(value: unknown): FieldResult<Output>
  }

export interface JsonSchemaPair {
  readonly input: (options: StandardJSONSchemaV1Options) => Record<string, unknown>
  readonly output: (options: StandardJSONSchemaV1Options) => Record<string, unknown>
}

export function createField<Output>(
  validate: (value: unknown) => FieldResult<Output>,
  jsonSchema: JsonSchemaPair,
): LingoField<Output> {
  const field: LingoField<Output> = {
    '~standard': {
      version: 1,
      vendor: 'lingo',
      validate,
      jsonSchema,
    },
    safeParse(value) {
      return validate(value)
    },
    parse(value) {
      const result = field.safeParse(value)
      if ('value' in result) {
        return result.value
      }
      const message = result.issues.map((issue) => issue.message).join('; ') || 'Invalid value.'
      const error = new Error(message)
      Object.defineProperty(error, 'issues', { value: result.issues })
      throw error
    },
  }
  return field
}

/**
 * Return a lingo field's Standard JSON Schema half as a plain object for raw
 * provider SDKs. Passing the field itself remains the preferred path for
 * Standard Schema-aware libraries because they need the whole `~standard`
 * object.
 * @example
 * ```ts
 * import { quantityField, toJSONSchema } from '@pascal-app/lingo/ai'
 * const schema = toJSONSchema(quantityField({ kind: 'mass', unit: 'kg' }))
 * schema.type // 'string'
 * ```
 */
export function toJSONSchema(
  field: LingoField<unknown>,
  opts: ToJSONSchemaOptions = {},
): Record<string, unknown> {
  const target = opts.target ?? 'draft-2020-12'
  const io = opts.io ?? 'input'
  return field['~standard'].jsonSchema[io]({ target })
}

export function messageFailure(
  message: string,
  path?: readonly (PropertyKey | { readonly key: PropertyKey })[],
  issue?: Omit<StandardSchemaV1Issue, 'message' | 'path'>,
): StandardSchemaV1Failure {
  return { issues: [{ message, ...issue, ...(path && { path }) }] }
}

export function isField(value: unknown): value is LingoField<unknown> {
  const maybeField = value as { '~standard'?: { validate?: unknown; jsonSchema?: unknown } }
  return (
    typeof value === 'object' &&
    value !== null &&
    '~standard' in value &&
    typeof maybeField['~standard']?.validate === 'function' &&
    typeof maybeField['~standard']?.jsonSchema === 'object'
  )
}

export function stringJsonSchema(description: string): Record<string, unknown> {
  return { type: 'string', description }
}

export function numberJsonSchema(
  description?: string,
  bounds?: { minimum?: number; maximum?: number },
): Record<string, unknown> {
  const schema: Record<string, unknown> = { type: 'number' }
  if (description) {
    schema.description = description
  }
  if (bounds?.minimum !== undefined) {
    schema.minimum = bounds.minimum
  }
  if (bounds?.maximum !== undefined) {
    schema.maximum = bounds.maximum
  }
  return schema
}

/**
 * Strip float artifacts from canonical conversions (1.3607771100000001 →
 * 1.36077711) without disturbing legitimate precision: the rounded value is
 * only kept when it differs by double-precision noise (≤1e-14 relative), so
 * genuine >12-significant-digit values pass through untouched.
 */
export function cleanNumber(value: number): number {
  if (!Number.isFinite(value) || value === 0) {
    return value
  }
  const cleaned = Number(value.toPrecision(12))
  return Math.abs(cleaned - value) <= Math.abs(value) * 1e-14 ? cleaned : value
}

/**
 * The `[CODE] message` wire format (plan 021): the single builder for coded
 * failure messages, and the exact inverse of canonicalize.ts's
 * `codeFromMessage` reverse parser.
 */
export function codedMessage(code: IssueCode, text: string): string {
  return `[${code}] ${text}`
}

/**
 * Format parser issues as Standard Schema failure issues: `[CODE] message`,
 * with the first issue carrying the did-you-mean candidate so the model can
 * self-correct in one round trip.
 */
export function failureFrom(
  issues: readonly LingoIssue[],
  opts: { messages?: Messages },
  candidate: string | null,
): StandardSchemaV1Failure {
  return {
    issues: issues.length
      ? issues.map((issue, index) =>
          lingoIssueToStandardIssue(issue, opts, index === 0 ? candidate : null),
        )
      : [{ message: candidate ? `Invalid value. Did you mean ${candidate}?` : 'Invalid value.' }],
  }
}

export function lingoIssueToStandardIssue(
  issue: LingoIssue,
  opts: { messages?: Messages },
  candidate: string | null = null,
): StandardSchemaV1Issue {
  return {
    message: `${codedMessage(issue.code, formatIssue(issue, opts.messages))}${
      candidate ? ` Did you mean ${candidate}?` : ''
    }`,
    code: issue.code,
    severity: issue.severity,
    ...(issue.span && { span: { ...issue.span } }),
    ...(issue.data && { data: issue.data as Record<string, unknown> }),
    ...(issue.suggestions && { suggestions: issue.suggestions }),
    ...(candidate && { candidate }),
  }
}

export function fieldWarnings(
  issues: readonly LingoIssue[],
  opts: { messages?: Messages },
): FieldWarning[] {
  const warnings: FieldWarning[] = []
  for (const issue of issues) {
    if (issue.severity === 'error') {
      continue
    }
    warnings.push({
      code: issue.code,
      severity: issue.severity,
      message: formatIssue(issue, opts.messages),
      ...(issue.span && { span: { ...issue.span } }),
      ...(issue.data && { data: issue.data as Record<string, unknown> }),
      ...(issue.suggestions && { suggestions: issue.suggestions }),
    })
  }
  return warnings
}

export function withWarnings<T>(
  success: { value: T },
  issues: readonly LingoIssue[],
  opts: { messages?: Messages },
): FieldResult<T> {
  const warnings = fieldWarnings(issues, opts)
  return warnings.length ? { ...success, warnings } : success
}

export function booleanJsonSchema(): Record<string, unknown> {
  return { type: 'boolean' }
}

export function prependPath(key: PropertyKey, issue: StandardSchemaV1Issue): StandardSchemaV1Issue {
  return {
    ...issue,
    path: [{ key }, ...(issue.path ?? [])],
  }
}
