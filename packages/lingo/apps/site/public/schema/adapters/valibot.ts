// Ready-made Valibot schema for lingo's v3 wire JSON (@pascal-app/lingo).
// Generated from @pascal-app/lingo/schema — see docs. Validate JSON.stringify(lingo(...)).
import * as v from 'valibot'

export const Span = v.object({ start: v.number(), end: v.number(), text: v.string() })
export const Issue = v.object({
  code: v.string(),
  severity: v.picklist(['error', 'warning', 'info']),
  message: v.string(),
  span: v.optional(Span),
  suggestions: v.optional(v.array(v.string())),
  data: v.optional(v.record(v.string(), v.unknown())),
})
const Bound = v.object({ value: v.number(), unit: v.string(), base: v.number(), exclusive: v.optional(v.boolean()) })
const ok = { schemaVersion: v.literal(3), ok: v.literal(true), text: v.string(), span: Span, issues: v.array(Issue), confidence: v.number() }

export const Quantity = v.object({ ...ok, type: v.literal('quantity'), kind: v.string(), value: v.number(), unit: v.string(), base: v.number(), baseUnit: v.string(), parts: v.optional(v.array(v.object({ value: v.number(), unit: v.string() }))), approximate: v.optional(v.boolean()) })
export const Range = v.object({ ...ok, type: v.literal('range'), kind: v.string(), baseUnit: v.string(), min: v.optional(Bound), max: v.optional(Bound), plusMinus: v.optional(v.object({ center: Bound, delta: Bound })), approximate: v.optional(v.boolean()) })
export const Conversion = v.object({ ...ok, type: v.literal('conversion'), kind: v.string(), source: v.record(v.string(), v.unknown()), converted: v.record(v.string(), v.unknown()) })
export const NumberResult = v.object({ ...ok, type: v.literal('number'), value: v.number(), approximate: v.optional(v.boolean()) })
export const Failure = v.object({ schemaVersion: v.literal(3), ok: v.literal(false), type: v.literal('failure'), text: v.string(), span: v.optional(Span), issues: v.array(Issue), candidate: v.optional(v.record(v.string(), v.unknown())) })

export const LingoResult = v.variant('type', [Quantity, Range, Conversion, NumberResult, Failure])
