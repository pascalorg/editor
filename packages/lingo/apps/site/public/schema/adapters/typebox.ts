// Ready-made TypeBox schema for lingo's v3 wire JSON (@pascal-app/lingo).
// Generated from @pascal-app/lingo/schema — see docs. Validate JSON.stringify(lingo(...)).
import { Type as T } from '@sinclair/typebox'

export const Span = T.Object({ start: T.Integer(), end: T.Integer(), text: T.String() })
export const Issue = T.Object({
  code: T.String(),
  severity: T.Union([T.Literal('error'), T.Literal('warning'), T.Literal('info')]),
  message: T.String(),
  span: T.Optional(Span),
  suggestions: T.Optional(T.Array(T.String())),
  data: T.Optional(T.Record(T.String(), T.Unknown())),
})
const Bound = T.Object({ value: T.Number(), unit: T.String(), base: T.Number(), exclusive: T.Optional(T.Boolean()) })
const ok = { schemaVersion: T.Literal(3), ok: T.Literal(true), text: T.String(), span: Span, issues: T.Array(Issue), confidence: T.Number() }

export const Quantity = T.Object({ ...ok, type: T.Literal('quantity'), kind: T.String(), value: T.Number(), unit: T.String(), base: T.Number(), baseUnit: T.String(), parts: T.Optional(T.Array(T.Object({ value: T.Number(), unit: T.String() }))), approximate: T.Optional(T.Boolean()) })
export const Range = T.Object({ ...ok, type: T.Literal('range'), kind: T.String(), baseUnit: T.String(), min: T.Optional(Bound), max: T.Optional(Bound), plusMinus: T.Optional(T.Object({ center: Bound, delta: Bound })), approximate: T.Optional(T.Boolean()) })
export const Conversion = T.Object({ ...ok, type: T.Literal('conversion'), kind: T.String(), source: T.Record(T.String(), T.Unknown()), converted: T.Record(T.String(), T.Unknown()) })
export const NumberResult = T.Object({ ...ok, type: T.Literal('number'), value: T.Number(), approximate: T.Optional(T.Boolean()) })
export const Failure = T.Object({ schemaVersion: T.Literal(3), ok: T.Literal(false), type: T.Literal('failure'), text: T.String(), span: T.Optional(Span), issues: T.Array(Issue), candidate: T.Optional(T.Record(T.String(), T.Unknown())) })

export const LingoResult = T.Union([Quantity, Range, Conversion, NumberResult, Failure])
