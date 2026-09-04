// v3 compact wire serialization (plan 025 + D57). The runtime result objects
// and Quantity/QuantityRange instances keep their v2-era accessors
// (`.quantity`, `.source`, `.converted`, `.targetUnit`, `.span`); ONLY what
// `JSON.stringify(result)` / `result.toJSON()` emit changes. v3 is flat (one
// `schemaVersion`/`type`, `kind` at top), drops the redundant `targetUnit` and
// `converted.base`/`baseUnit`, and every span carries its matched `text` so
// `span` reads for itself.
import {
  type Quantity,
  type QuantityJSON,
  QuantityRange,
  type QuantityRangeJSON,
} from '../core/quantity'
import type { IssueCode, Kind, LingoIssue, Severity } from '../core/types'
import type {
  ConversionResult,
  FailResult,
  LingoResult,
  NumberResult,
  QuantityResult,
  RangeResult,
} from './config'

/** A `[start, end)` character range into the ORIGINAL input, with the matched substring. */
export interface SerializedSpan {
  end: number
  start: number
  /** `input.slice(start, end)` — the exact text this span points at. */
  text: string
}

export interface SerializedIssue {
  code: IssueCode
  data?: Record<string, unknown>
  message: string
  severity: Severity
  /** Absent only for field-level bound issues (`/ai`) that point at no input text. */
  span?: SerializedSpan
  suggestions?: string[]
}

/** A range bound (or plus/minus component) in serialized output. */
export interface SerializedBound {
  base: number
  exclusive?: boolean
  unit: string
  value: number
}

interface OkFields {
  confidence: number
  issues: SerializedIssue[]
  ok: true
  schemaVersion: 3
  span: SerializedSpan
  text: string
}

/** A ranked secondary reading (e.g. the other side of an `AMBIGUOUS_NUMBER` split). */
export interface SerializedAlternative {
  confidence: number
  quantity: QuantityJSON
  reason: string
  type: 'quantity'
}

export interface SerializedQuantity extends OkFields {
  alternatives?: SerializedAlternative[]
  approximate?: boolean
  base: number
  baseUnit: string
  kind: Kind
  parts?: { value: number; unit: string }[]
  type: 'quantity'
  unit: string
  value: number
}

export interface SerializedRange extends OkFields {
  approximate?: boolean
  baseUnit: string
  fuzzy?: { term: string; profile: string }
  kind: Kind
  max?: SerializedBound
  min?: SerializedBound
  plusMinus?: { center: SerializedBound; delta: SerializedBound }
  type: 'range'
}

/** Conversion source: a quantity or range, minus `schemaVersion`/`kind` (both at the conversion top). */
export type SerializedConversionSource =
  | { type: 'quantity'; value: number; unit: string; base: number; baseUnit: string }
  | {
      type: 'range'
      baseUnit: string
      min?: SerializedBound
      max?: SerializedBound
      plusMinus?: { center: SerializedBound; delta: SerializedBound }
    }

/** Converted target: value + unit only (magnitude is preserved, so base equals the source's). */
export type SerializedConverted =
  | { value: number; unit: string }
  | {
      min?: { value: number; unit: string }
      max?: { value: number; unit: string }
      plusMinus?: {
        center: { value: number; unit: string }
        delta: { value: number; unit: string }
      }
    }

export interface SerializedConversion extends OkFields {
  converted: SerializedConverted
  kind: Kind
  source: SerializedConversionSource
  type: 'conversion'
}

export interface SerializedNumber extends OkFields {
  approximate?: boolean
  type: 'number'
  value: number
}

export interface SerializedFailure {
  candidate?: SerializedQuantity | SerializedRange | SerializedConversion | SerializedNumber
  issues: SerializedIssue[]
  ok: false
  schemaVersion: 3
  span?: SerializedSpan
  text: string
  type: 'failure'
}

export type SerializedResult =
  | SerializedQuantity
  | SerializedRange
  | SerializedConversion
  | SerializedNumber
  | SerializedFailure

/** Serialize a span with its matched substring (shared with the date module). */
export function spanText(span: { start: number; end: number }, text: string): SerializedSpan {
  return { start: span.start, end: span.end, text: text.slice(span.start, span.end) }
}

/** Serialize issues with self-describing spans (shared with the date module). */
export function serializeIssues(issues: readonly LingoIssue[], text: string): SerializedIssue[] {
  return issues.map((issue) => {
    const out: SerializedIssue = {
      code: issue.code,
      severity: issue.severity,
      message: issue.message,
    }
    if (issue.span) {
      out.span = spanText(issue.span, text)
    }
    if (issue.suggestions) {
      out.suggestions = [...issue.suggestions]
    }
    if (issue.data) {
      out.data = { ...issue.data }
    }
    return out
  })
}

function boundValueUnit(bound: { value: number; unit: string }): { value: number; unit: string } {
  return { value: bound.value, unit: bound.unit }
}

/** Serialize a conversion `source` (Quantity|QuantityRange): drop schemaVersion + kind. */
function conversionSource(value: Quantity | QuantityRange): SerializedConversionSource {
  if (value instanceof QuantityRange) {
    const j: QuantityRangeJSON = value.toJSON()
    const out = { type: 'range' as const, baseUnit: j.baseUnit } as Extract<
      SerializedConversionSource,
      { type: 'range' }
    >
    if (j.min) {
      out.min = j.min
    }
    if (j.max) {
      out.max = j.max
    }
    if (j.plusMinus) {
      out.plusMinus = j.plusMinus
    }
    return out
  }
  const j: QuantityJSON = value.toJSON()
  return { type: 'quantity', value: j.value, unit: j.unit, base: j.base, baseUnit: j.baseUnit }
}

/** Serialize a conversion `converted` target: value + unit only (base is the source's). */
function conversionConverted(value: Quantity | QuantityRange): SerializedConverted {
  if (value instanceof QuantityRange) {
    const j: QuantityRangeJSON = value.toJSON()
    const out: Extract<SerializedConverted, { min?: unknown }> = {}
    if (j.min) {
      out.min = boundValueUnit(j.min)
    }
    if (j.max) {
      out.max = boundValueUnit(j.max)
    }
    if (j.plusMinus) {
      out.plusMinus = {
        center: boundValueUnit(j.plusMinus.center),
        delta: boundValueUnit(j.plusMinus.delta),
      }
    }
    return out
  }
  const j: QuantityJSON = value.toJSON()
  return { value: j.value, unit: j.unit }
}

/** Produce the flat v3 wire object for a parse result. */
export function serializeResult(result: LingoResult): SerializedResult {
  if (!result.ok) {
    return serializeFailure(result)
  }
  if (result.type === 'quantity') {
    return serializeQuantity(result)
  }
  if (result.type === 'range') {
    return serializeRange(result)
  }
  if (result.type === 'conversion') {
    return serializeConversion(result)
  }
  return serializeNumber(result)
}

// Trailing fields shared by every success result, kept LAST so the identity
// fields (type/kind/value…) read first, top-down.
function tail(
  result: QuantityResult | RangeResult | ConversionResult | NumberResult,
): Pick<OkFields, 'text' | 'span' | 'issues' | 'confidence'> {
  return {
    text: result.text,
    span: spanText(result.span, result.text),
    issues: serializeIssues(result.issues, result.text),
    confidence: result.confidence,
  }
}

function serializeQuantity(result: QuantityResult): SerializedQuantity {
  const j = result.quantity.toJSON()
  const out: SerializedQuantity = {
    schemaVersion: 3,
    ok: true,
    type: 'quantity',
    kind: j.kind,
    value: j.value,
    unit: j.unit,
    base: j.base,
    baseUnit: j.baseUnit,
    ...tail(result),
  }
  if (j.approximate) {
    out.approximate = true
  }
  if (j.parts) {
    out.parts = j.parts
  }
  if (result.alternatives?.length) {
    out.alternatives = result.alternatives.map((alt) => ({
      type: 'quantity',
      reason: alt.reason,
      confidence: alt.confidence,
      quantity: alt.quantity.toJSON(),
    }))
  }
  return out
}

function serializeRange(result: RangeResult): SerializedRange {
  const j = result.range.toJSON()
  const out: SerializedRange = {
    schemaVersion: 3,
    ok: true,
    type: 'range',
    kind: j.kind,
    baseUnit: j.baseUnit,
    ...tail(result),
  }
  if (j.min) {
    out.min = j.min
  }
  if (j.max) {
    out.max = j.max
  }
  if (j.plusMinus) {
    out.plusMinus = j.plusMinus
  }
  if (j.fuzzy) {
    out.fuzzy = j.fuzzy
  }
  if (j.approximate) {
    out.approximate = true
  }
  return out
}

function serializeConversion(result: ConversionResult): SerializedConversion {
  const source = result.source
  const kind = source.kind
  return {
    schemaVersion: 3,
    ok: true,
    type: 'conversion',
    kind,
    source: conversionSource(source),
    converted: conversionConverted(result.converted),
    ...tail(result),
  }
}

function serializeNumber(result: NumberResult): SerializedNumber {
  const out: SerializedNumber = {
    schemaVersion: 3,
    ok: true,
    type: 'number',
    value: result.value,
    ...tail(result),
  }
  if (result.approximate) {
    out.approximate = true
  }
  return out
}

function serializeFailure(result: FailResult): SerializedFailure {
  const out: SerializedFailure = {
    schemaVersion: 3,
    ok: false,
    type: 'failure',
    text: result.text,
    issues: serializeIssues(result.issues, result.text),
  }
  const candidate = result.candidate
  if (candidate) {
    out.candidate = serializeResult(candidate) as SerializedFailure['candidate']
  }
  return out
}

/**
 * Attach an ENUMERABLE `toJSON()` so `JSON.stringify(result)` emits the flat v3
 * wire shape while the runtime object keeps its `.quantity`/`.source`/… accessors.
 * It MUST be enumerable: JavaScriptCore (Bun, Safari/WebKit — where the DOM layer
 * runs) has a `JSON.stringify` fast path that SKIPS a non-enumerable `toJSON` on
 * objects whose own values are all JSON-primitives (number and failure results),
 * silently serializing the raw runtime shape instead of v3. The only cost is that
 * `Object.keys(result)` now lists `toJSON`; switch on `.type` / read fields
 * directly (or `JSON.stringify`) rather than enumerating keys.
 */
export function attachSerialization<T extends LingoResult>(result: T): T {
  Object.defineProperty(result, 'toJSON', {
    value(this: LingoResult): SerializedResult {
      return serializeResult(this)
    },
    enumerable: true,
    configurable: true,
    writable: true,
  })
  return result
}
