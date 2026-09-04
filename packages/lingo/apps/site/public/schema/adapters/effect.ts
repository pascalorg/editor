// Ready-made Effect Schema schema for lingo's v3 wire JSON (@pascal-app/lingo).
// Generated from @pascal-app/lingo/schema — see docs. Validate JSON.stringify(lingo(...)).
// https://effect.website/
import { Schema as S } from 'effect'

export const Span = S.Struct({ start: S.Int, end: S.Int, text: S.String })
export const Issue = S.Struct({
  code: S.String,
  severity: S.Literal('error', 'warning', 'info'),
  message: S.String,
  span: S.optional(Span),
  suggestions: S.optional(S.Array(S.String)),
  data: S.optional(S.Record({ key: S.String, value: S.Unknown })),
})
const Bound = S.Struct({ value: S.Number, unit: S.String, base: S.Number, exclusive: S.optional(S.Boolean) })
const ok = { schemaVersion: S.Literal(3), ok: S.Literal(true), text: S.String, span: Span, issues: S.Array(Issue), confidence: S.Number }

export const Quantity = S.Struct({ ...ok, type: S.Literal('quantity'), kind: S.String, value: S.Number, unit: S.String, base: S.Number, baseUnit: S.String, parts: S.optional(S.Array(S.Struct({ value: S.Number, unit: S.String }))), approximate: S.optional(S.Boolean) })
export const Range = S.Struct({ ...ok, type: S.Literal('range'), kind: S.String, baseUnit: S.String, min: S.optional(Bound), max: S.optional(Bound), plusMinus: S.optional(S.Struct({ center: Bound, delta: Bound })), approximate: S.optional(S.Boolean) })
export const Conversion = S.Struct({ ...ok, type: S.Literal('conversion'), kind: S.String, source: S.Record({ key: S.String, value: S.Unknown }), converted: S.Record({ key: S.String, value: S.Unknown }) })
export const NumberResult = S.Struct({ ...ok, type: S.Literal('number'), value: S.Number, approximate: S.optional(S.Boolean) })
export const Failure = S.Struct({ schemaVersion: S.Literal(3), ok: S.Literal(false), type: S.Literal('failure'), text: S.String, span: S.optional(Span), issues: S.Array(Issue), candidate: S.optional(S.Record({ key: S.String, value: S.Unknown })) })

export const LingoResult = S.Union(Quantity, Range, Conversion, NumberResult, Failure)
