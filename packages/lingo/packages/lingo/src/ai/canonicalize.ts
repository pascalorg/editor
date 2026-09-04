import type { DateFieldOptions } from './date-field'
import { dateField } from './date-field'
import {
  type QuantityFieldOptions,
  quantityField,
  type RangeFieldOptions,
  rangeField,
} from './quantity-fields'
import {
  booleanJsonSchema,
  createField,
  type FieldResult,
  type FieldWarning,
  isField,
  type LingoField,
  messageFailure,
  numberJsonSchema,
  prependPath,
  type StandardJSONSchemaV1Options,
  type StandardSchemaV1Issue,
  stringJsonSchema,
} from './standard-schema'

export interface CanonicalizeIssue {
  /** Did-you-mean candidate attached to a failed field issue, when available. */
  candidate?: string
  /** Stable lingo issue code when one is known (e.g. `TYPO_CORRECTED`). */
  code?: string
  /** Code-specific structured payload when the underlying field provided one. */
  data?: Record<string, unknown>
  message: string
  path: string
  /** `error` blocks the value at this path; `warning`/`info` rode along on an applied value. */
  severity: 'error' | 'warning' | 'info'
  /** Span into the field input string parsed at this path, when available. */
  span?: { end: number; start: number }
  /** Did-you-mean strings from the underlying issue, when available. */
  suggestions?: readonly string[]
}

export interface CanonicalizeResult<T = unknown> {
  issues: CanonicalizeIssue[]
  value: T
}

export type InlineFieldDescriptor =
  | (QuantityFieldOptions & { type?: 'quantity' })
  | (RangeFieldOptions & { type: 'range' })
  | (DateFieldOptions & { type: 'date' })

export type CanonicalizeFieldDefinition = LingoField<unknown> | InlineFieldDescriptor

export type CanonicalizeSpec = Record<string, CanonicalizeFieldDefinition>

export type PrimitiveSpec = 'string' | 'number' | 'boolean'

export type LingoObjectPropertySpec =
  | LingoField<unknown>
  | PrimitiveSpec
  | readonly [LingoObjectPropertySpec]

export type LingoObjectShape = Record<string, LingoObjectPropertySpec>

export type InferLingoObjectProperty<Spec> =
  Spec extends LingoField<infer Output>
    ? Output
    : Spec extends 'string'
      ? string
      : Spec extends 'number'
        ? number
        : Spec extends 'boolean'
          ? boolean
          : Spec extends readonly [infer Item]
            ? Array<InferLingoObjectProperty<Item>>
            : never

export type InferLingoObject<Shape extends LingoObjectShape> = {
  [Key in keyof Shape]: InferLingoObjectProperty<Shape[Key]>
}

export interface RepairTextOptions {
  readonly error: unknown
  readonly text: string
}

export type RepairTextFunction = (options: RepairTextOptions) => Promise<string | null>

/**
 * Minimal AI SDK tool-call shape accepted by `repairToolCallWith()`.
 * @example
 * ```ts
 * import type { ToolCallToRepair } from '@pascal-app/lingo/ai'
 * const call: ToolCallToRepair = { toolCallId: 'call_1', toolName: 'ship', input: '{"weight":"2kg"}' }
 * call.toolName // 'ship'
 * ```
 */
export interface ToolCallToRepair {
  input: string
  toolCallId: string
  toolName: string
}

/**
 * Function shape used by AI SDK `experimental_repairToolCall`.
 * @example
 * ```ts
 * import { quantityField, repairToolCallWith, type RepairToolCallFunction } from '@pascal-app/lingo/ai'
 * const repair: RepairToolCallFunction = repairToolCallWith({
 *   ship: { weight: quantityField({ kind: 'mass', unit: 'kg' }) },
 * })
 * await repair({
 *   toolCall: { toolCallId: 'call_1', toolName: 'ship', input: '{"weight":"2kg"}' },
 *   error: new Error('schema validation failed'),
 * })
 * // { toolCallId: 'call_1', toolName: 'ship', input: '{"weight":2}' }
 * ```
 */
export type RepairToolCallFunction = (o: {
  toolCall: ToolCallToRepair
  error: unknown
}) => Promise<ToolCallToRepair | null>

/**
 * Canonicalize model-emitted values in place inside a JSON payload. Spec keys
 * are dot paths into the value (`'shipment.total'`); a `[]` suffix on a
 * segment fans out over every element of that array (`'items[].weight'`); the
 * empty path `''` applies a field to the whole value. Fields that fail leave
 * the original value untouched and report an error-severity issue; applied
 * values may carry warning/info issues (typo fixed, unit assumed…).
 * @example
 * ```ts
 * import { canonicalizeValues, quantityField } from '@pascal-app/lingo/ai'
 * const { value, issues } = canonicalizeValues(
 *   { items: [{ weight: '2 lbs' }, { weight: 'banana' }] },
 *   { 'items[].weight': quantityField({ kind: 'mass', unit: 'kg' }) },
 * )
 * value.items[0].weight // 0.90718474
 * value.items[1].weight // 'banana' — left as-is
 * issues[0].path        // 'items[1].weight'
 * issues[0].code        // 'NO_VALUE'
 * ```
 */
export function canonicalizeValues<T>(value: T, spec: CanonicalizeSpec): CanonicalizeResult<T> {
  let next = cloneJson(value)
  const issues: CanonicalizeIssue[] = []

  for (const [rawPath, definition] of Object.entries(spec)) {
    const segments = parseSpecPath(rawPath)
    if (segments.length === 0) {
      const parsed = fieldFor(definition).safeParse(next)
      if ('value' in parsed) {
        pushWarnings(issues, rawPath, parsed.warnings)
        // Root replacement must not swallow later spec entries.
        next = parsed.value as T
      } else {
        pushIssues(issues, rawPath, parsed.issues)
      }
      continue
    }
    applyAtPath(next, segments, fieldFor(definition), '', issues)
  }

  return { value: next, issues }
}

export interface LingoObjectOptions {
  /**
   * Allow and pass through properties not declared in the shape. Default
   * false (plan 020): tool and MCP argument schemas are closed —
   * `additionalProperties: false` is emitted (required by OpenAI strict
   * structured outputs) and unknown keys fail validation.
   */
  passthrough?: boolean
}

/**
 * Compose lingo fields, `'string'`/`'number'`/`'boolean'` primitives, and
 * one-element-array specs (`[field]`) into an object schema — a `LingoField`
 * with full Standard Schema + JSON Schema support for tool arguments. Closed
 * by default (plan 020): unknown keys fail and the emitted JSON Schema sets
 * `additionalProperties: false`, as OpenAI strict structured outputs require.
 * @example
 * ```ts
 * import { lingoObject, quantityField } from '@pascal-app/lingo/ai'
 * const schema = lingoObject({
 *   weight: quantityField({ kind: 'mass', unit: 'kg' }),
 *   note: 'string',
 * })
 * schema.parse({ weight: '2 lbs', note: 'ok' }).weight // 0.90718474
 * schema.safeParse({ weight: '2 lbs', extra: 1 }).issues?.[0].message
 * // 'Unexpected property "extra".'
 * ```
 */
export function lingoObject<Shape extends LingoObjectShape>(
  shape: Shape,
  options: LingoObjectOptions = {},
): LingoField<InferLingoObject<Shape>> {
  const passthrough = options.passthrough === true
  return createField<InferLingoObject<Shape>>(
    (value) => validateObject(value, shape, passthrough),
    {
      input: (options) => objectJsonSchema(shape, 'input', options, passthrough),
      output: (options) => objectJsonSchema(shape, 'output', options, passthrough),
    },
  )
}

/**
 * Build an `experimental_repairText`-shaped function (AI SDK) from a
 * canonicalize spec or a single field: parses the model's JSON text,
 * canonicalizes the configured paths client-side, and returns the repaired
 * JSON string — or `null` when the text isn't JSON or any error-severity
 * issue remains (warnings ride along on applied values and don't block).
 * @example
 * ```ts
 * import { quantityField, repairTextWith } from '@pascal-app/lingo/ai'
 * const repair = repairTextWith({ weight: quantityField({ kind: 'mass', unit: 'kg' }) })
 * await repair({ text: '{"weight":"2kg"}', error }) // '{"weight":2}'
 * await repair({ text: '{"weight":"1,234 kg"}', error }) // null — ambiguous stays failed
 * ```
 */
export function repairTextWith(spec: CanonicalizeSpec | LingoField<unknown>): RepairTextFunction {
  return async ({ text }) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return null
    }

    if (isField(spec)) {
      const result = spec.safeParse(parsed)
      return 'value' in result ? JSON.stringify(result.value) : null
    }

    const result = canonicalizeValues(parsed, spec)
    // Warnings ride along on applied values; only error-severity issues block repair.
    return result.issues.every((issue) => issue.severity !== 'error')
      ? JSON.stringify(result.value)
      : null
  }
}

/**
 * Build an `experimental_repairToolCall`-shaped function (AI SDK v6/v7) from
 * tool-name keyed canonicalization specs. Unknown tools, non-JSON input, parse
 * failures, and remaining error-severity issues return `null`.
 * @example
 * ```ts
 * import { quantityField, repairToolCallWith } from '@pascal-app/lingo/ai'
 * const repair = repairToolCallWith({
 *   ship: { weight: quantityField({ kind: 'mass', unit: 'kg' }) },
 * })
 * const fixed = await repair({
 *   toolCall: { toolCallId: 'call_1', toolName: 'ship', input: '{"weight":"2kg"}' },
 *   error: new Error('schema validation failed'),
 * })
 * fixed?.input // '{"weight":2}'
 * ```
 */
export function repairToolCallWith(
  specsByTool: Record<string, CanonicalizeSpec | LingoField<unknown>>,
): RepairToolCallFunction {
  return async ({ toolCall }) => {
    const spec = specsByTool[toolCall.toolName]
    if (!spec) {
      return null
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(toolCall.input)
      if (isField(spec)) {
        const result = spec.safeParse(parsed)
        return 'value' in result ? { ...toolCall, input: JSON.stringify(result.value) } : null
      }

      const result = canonicalizeValues(parsed, spec)
      return result.issues.every((issue) => issue.severity !== 'error')
        ? { ...toolCall, input: JSON.stringify(result.value) }
        : null
    } catch {
      return null
    }
  }
}

function validateObject<Shape extends LingoObjectShape>(
  value: unknown,
  shape: Shape,
  passthrough: boolean,
): FieldResult<InferLingoObject<Shape>> {
  if (!isPlainObject(value)) {
    return messageFailure('Expected an object.')
  }

  const source = value as Record<string, unknown>
  const next = (passthrough ? cloneJson(source) : {}) as Record<string, unknown>
  const issues: StandardSchemaV1Issue[] = []
  const warnings: FieldWarning[] = []

  if (!passthrough) {
    for (const key of Object.keys(source)) {
      if (!(key in shape)) {
        issues.push({ message: `Unexpected property "${key}".`, path: [{ key }] })
      }
    }
  }

  for (const [key, spec] of Object.entries(shape)) {
    const result = validateObjectSpec(passthrough ? next[key] : cloneJson(source[key]), spec)
    if ('value' in result) {
      next[key] = result.value
      collectWarnings(warnings, key, result.warnings)
    } else {
      issues.push(...result.issues.map((issue) => prependPath(key, issue)))
    }
  }

  if (issues.length) {
    return { issues }
  }
  const success = { value: next as InferLingoObject<Shape> }
  return warnings.length ? { ...success, warnings } : success
}

function validateObjectSpec(value: unknown, spec: LingoObjectPropertySpec): FieldResult<unknown> {
  if (isField(spec)) {
    return spec.safeParse(value)
  }

  if (isPrimitiveSpec(spec)) {
    if (spec === 'number') {
      return typeof value === 'number' && Number.isFinite(value)
        ? { value }
        : messageFailure('Expected a finite number.')
    }
    return typeof value === spec ? { value } : messageFailure(`Expected a ${spec}.`)
  }

  if (isArraySpec(spec)) {
    if (!Array.isArray(value)) {
      return messageFailure('Expected an array.')
    }
    const out: unknown[] = []
    const issues: StandardSchemaV1Issue[] = []
    const warnings: FieldWarning[] = []
    const itemSpec = spec[0]
    for (let index = 0; index < value.length; index++) {
      const result = validateObjectSpec(value[index], itemSpec)
      if ('value' in result) {
        out[index] = result.value
        collectWarnings(warnings, index, result.warnings)
      } else {
        issues.push(...result.issues.map((issue) => prependPath(index, issue)))
      }
    }
    if (issues.length) {
      return { issues }
    }
    return warnings.length ? { value: out, warnings } : { value: out }
  }

  return messageFailure('Unsupported lingoObject spec.')
}

function collectWarnings(
  target: FieldWarning[],
  key: PropertyKey,
  warnings: readonly FieldWarning[] | undefined,
): void {
  if (!warnings) {
    return
  }
  for (const warning of warnings) {
    target.push({ ...warning, path: [{ key }, ...(warning.path ?? [])] })
  }
}

function objectJsonSchema(
  shape: LingoObjectShape,
  direction: 'input' | 'output',
  options: StandardJSONSchemaV1Options,
  passthrough: boolean,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  for (const [key, spec] of Object.entries(shape)) {
    properties[key] = jsonSchemaForSpec(spec, direction, options)
  }
  return {
    type: 'object',
    properties,
    required: Object.keys(shape),
    additionalProperties: passthrough,
  }
}

function jsonSchemaForSpec(
  spec: LingoObjectPropertySpec,
  direction: 'input' | 'output',
  options: StandardJSONSchemaV1Options,
): Record<string, unknown> {
  if (isField(spec)) {
    return spec['~standard'].jsonSchema[direction](options)
  }
  if (spec === 'string') {
    return stringJsonSchema('A string value.')
  }
  if (spec === 'number') {
    return numberJsonSchema()
  }
  if (spec === 'boolean') {
    return booleanJsonSchema()
  }
  if (isArraySpec(spec)) {
    return {
      type: 'array',
      items: jsonSchemaForSpec(spec[0], direction, options),
    }
  }
  return {}
}

function fieldFor(definition: CanonicalizeFieldDefinition): LingoField<unknown> {
  if (isField(definition)) {
    return definition
  }
  if (definition.type === 'range') {
    return definition.output === 'range'
      ? rangeField(definition as RangeFieldOptions & { output: 'range' })
      : rangeField(definition as RangeFieldOptions & { output?: 'number' })
  }
  if (definition.type === 'date') {
    return dateField(definition)
  }
  const quantity = definition as QuantityFieldOptions
  return quantity.output === 'quantity'
    ? quantityField(quantity as QuantityFieldOptions & { output: 'quantity' })
    : quantityField(quantity as QuantityFieldOptions & { output?: 'number' })
}

interface PathSegment {
  array: boolean
  key: string
}

function parseSpecPath(path: string): PathSegment[] {
  return path
    .split('.')
    .filter(Boolean)
    .map((part) => {
      if (part.endsWith('[]')) {
        return { key: part.slice(0, -2), array: true }
      }
      return { key: part, array: false }
    })
}

function applyAtPath(
  target: unknown,
  segments: readonly PathSegment[],
  field: LingoField<unknown>,
  path: string,
  issues: CanonicalizeIssue[],
): void {
  const segment = segments[0]
  if (!segment) {
    return
  }

  const atEnd = segments.length === 1
  if (segment.array) {
    const arrayPath = appendKey(path, segment.key)
    const array = childValue(target, segment.key)
    if (!Array.isArray(array)) {
      issues.push({ path: arrayPath, message: 'Expected an array.', severity: 'error' })
      return
    }
    for (let index = 0; index < array.length; index++) {
      const itemPath = `${arrayPath}[${index}]`
      if (atEnd) {
        validateInPlace(array, index, field, itemPath, issues)
      } else {
        applyAtPath(array[index], segments.slice(1), field, itemPath, issues)
      }
    }
    return
  }

  const nextPath = appendKey(path, segment.key)
  if (atEnd) {
    validateInPlace(target, segment.key, field, nextPath, issues)
    return
  }

  const child = childValue(target, segment.key)
  if (!isContainer(child)) {
    issues.push({ path: nextPath, message: 'Expected an object or array.', severity: 'error' })
    return
  }
  applyAtPath(child, segments.slice(1), field, nextPath, issues)
}

function validateInPlace(
  container: unknown,
  key: string | number,
  field: LingoField<unknown>,
  path: string,
  issues: CanonicalizeIssue[],
): void {
  if (!isContainer(container)) {
    issues.push({ path, message: 'Expected an object or array.', severity: 'error' })
    return
  }

  const result = field.safeParse((container as Record<PropertyKey, unknown>)[key])
  if ('value' in result) {
    ;(container as Record<PropertyKey, unknown>)[key] = result.value
    pushWarnings(issues, path, result.warnings)
    return
  }
  pushIssues(issues, path, result.issues)
}

function pushIssues(
  target: CanonicalizeIssue[],
  path: string,
  issues: readonly StandardSchemaV1Issue[],
): void {
  for (const issue of issues) {
    target.push({
      path: appendStandardPath(path, issue.path),
      message: issue.message,
      severity: 'error',
      ...codeProp(issue.code ?? codeFromMessage(issue.message)),
      ...(issue.span && { span: { ...issue.span } }),
      ...(issue.data && { data: issue.data }),
      ...(issue.suggestions && { suggestions: issue.suggestions }),
      ...(issue.candidate && { candidate: issue.candidate }),
    })
  }
}

function pushWarnings(
  target: CanonicalizeIssue[],
  path: string,
  warnings: readonly FieldWarning[] | undefined,
): void {
  if (!warnings) {
    return
  }
  for (const warning of warnings) {
    target.push({
      path: appendStandardPath(path, warning.path),
      message: warning.message,
      severity: warning.severity,
      code: warning.code,
      ...(warning.span && { span: { ...warning.span } }),
      ...(warning.data && { data: warning.data }),
      ...(warning.suggestions && { suggestions: warning.suggestions }),
    })
  }
}

function codeFromMessage(message: string): string | undefined {
  return /^\[([A-Z_]+)\]/.exec(message)?.[1]
}

function codeProp(code: string | undefined): { code?: string } {
  return code === undefined ? {} : { code }
}

function appendStandardPath(
  path: string,
  standardPath: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined,
): string {
  if (!standardPath) {
    return path
  }
  let next = path
  for (const segment of standardPath) {
    const key =
      typeof segment === 'object' && segment !== null && 'key' in segment ? segment.key : segment
    next = typeof key === 'number' ? `${next}[${key}]` : appendKey(next, String(key))
  }
  return next
}

function appendKey(path: string, key: string): string {
  return path ? `${path}.${key}` : key
}

function childValue(target: unknown, key: string): unknown {
  return isContainer(target) ? (target as Record<PropertyKey, unknown>)[key] : undefined
}

function isContainer(value: unknown): value is Record<PropertyKey, unknown> | unknown[] {
  return typeof value === 'object' && value !== null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPrimitiveSpec(value: unknown): value is PrimitiveSpec {
  return value === 'string' || value === 'number' || value === 'boolean'
}

function isArraySpec(value: unknown): value is readonly [LingoObjectPropertySpec] {
  return Array.isArray(value) && value.length === 1
}

function cloneJson<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJson(item)) as T
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value)) {
      out[key] = cloneJson((value as Record<string, unknown>)[key])
    }
    return out as T
  }
  return value
}
