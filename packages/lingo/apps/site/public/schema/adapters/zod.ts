// Ready-made Zod schema for lingo's v3 wire JSON (@pascal-app/lingo).
// Generated from @pascal-app/lingo/schema — see docs. Validate JSON.stringify(lingo(...)).
import { z } from 'zod'

export const Span = z.object({ start: z.number().int(), end: z.number().int(), text: z.string() })
export const Issue = z.object({
  code: z.string(),
  severity: z.enum(['error', 'warning', 'info']),
  message: z.string(),
  span: Span.optional(),
  suggestions: z.array(z.string()).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
})
const Bound = z.object({ value: z.number(), unit: z.string(), base: z.number(), exclusive: z.boolean().optional() })
const ok = { schemaVersion: z.literal(3), ok: z.literal(true), text: z.string(), span: Span, issues: z.array(Issue), confidence: z.number() }

export const Quantity = z.object({ ...ok, type: z.literal('quantity'), kind: z.string(), value: z.number(), unit: z.string(), base: z.number(), baseUnit: z.string(), parts: z.array(z.object({ value: z.number(), unit: z.string() })).optional(), approximate: z.boolean().optional() })
export const Range = z.object({ ...ok, type: z.literal('range'), kind: z.string(), baseUnit: z.string(), min: Bound.optional(), max: Bound.optional(), plusMinus: z.object({ center: Bound, delta: Bound }).optional(), approximate: z.boolean().optional() })
export const Conversion = z.object({ ...ok, type: z.literal('conversion'), kind: z.string(), source: z.record(z.string(), z.unknown()), converted: z.record(z.string(), z.unknown()) })
export const NumberResult = z.object({ ...ok, type: z.literal('number'), value: z.number(), approximate: z.boolean().optional() })
export const Failure = z.object({ schemaVersion: z.literal(3), ok: z.literal(false), type: z.literal('failure'), text: z.string(), span: Span.optional(), issues: z.array(Issue), candidate: z.record(z.string(), z.unknown()).optional() })

export const LingoResult = z.discriminatedUnion('type', [Quantity, Range, Conversion, NumberResult, Failure])
