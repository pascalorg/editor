// Generate the schema artifacts published in the docs (plan 029): the JSON
// Schema, an OpenAPI 3.1 document, a human-readable dictionary, and ready-made
// Zod / Valibot / TypeBox / ArkType / Effect Schema equivalents for the v3 wire
// shape. Sourced from the built ./schema entry so they never drift. The library
// stays zero-dep — these are copy-paste docs, not shipped code.
//
//   node scripts/gen-schemas.mjs           # write artifacts
//   node scripts/gen-schemas.mjs --check   # fail if any artifact is stale
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url)
const OUT = new URL('../../../apps/site/public/schema/', import.meta.url)
const check = process.argv.includes('--check')

if (!existsSync(new URL('dist/schema/index.js', ROOT))) {
  console.error('gen-schemas needs built dist. Run `bun run build` first.')
  process.exit(1)
}
const { lingoJsonSchema, toOpenApi, ISSUE_CODES, SEVERITIES, UNIT_SYSTEMS, BUILTIN_KINDS } =
  await import(new URL('dist/schema/index.js', ROOT).href)

const artifacts = {
  'lingo.schema.json': `${JSON.stringify(lingoJsonSchema, null, 2)}\n`,
  'lingo.openapi.json': `${JSON.stringify(toOpenApi(), null, 2)}\n`,
  'dictionary.md': dictionary(),
  'adapters/zod.ts': zod(),
  'adapters/valibot.ts': valibot(),
  'adapters/typebox.ts': typebox(),
  'adapters/arktype.ts': arktype(),
  'adapters/effect.ts': effect(),
}

let stale = 0
for (const [name, content] of Object.entries(artifacts)) {
  const url = new URL(name, OUT)
  const current = existsSync(url) ? readFileSync(url, 'utf8') : null
  if (current === content) {
    continue
  }
  stale++
  if (check) {
    console.error(`stale: apps/site/public/schema/${name}`)
  } else {
    mkdirSync(new URL('.', url), { recursive: true })
    writeFileSync(url, content)
    console.log(`wrote apps/site/public/schema/${name}`)
  }
}
if (check && stale > 0) {
  console.error(`\n${stale} schema artifact(s) stale — run node scripts/gen-schemas.mjs`)
  process.exit(1)
}
if (check) {
  console.log('Schema artifacts up to date.')
}

function dictionary() {
  const lines = [
    '# Lingo data-schema dictionary (v3)',
    '',
    'The compact wire JSON `JSON.stringify(lingo(...))` produces. Generated from',
    '`@pascal-app/lingo/schema` — do not edit by hand (`node scripts/gen-schemas.mjs`).',
    '',
    '## Result types (discriminate on `type`)',
    '',
    '| `type` | when | key fields |',
    '|---|---|---|',
    '| `quantity` | one value ("5 kg") | `value`, `unit`, `base`, `baseUnit` |',
    '| `range` | a range ("5–10 kg") | `min`, `max` (or `plusMinus`), `baseUnit` |',
    '| `conversion` | "72 in to cm" | `source`, `converted` |',
    '| `number` | bare number, no unit | `value` |',
    '| `failure` | `ok:false` | `issues`, optional `candidate` |',
    '',
    '## Common keys',
    '',
    '| key | type | meaning |',
    '|---|---|---|',
    '| `schemaVersion` | `3` | wire-schema version |',
    '| `ok` | `boolean` | `false` ⇒ a `failure` result |',
    '| `kind` | string | measurement kind (see below) |',
    '| `value` | number | amount in `unit` |',
    '| `unit` | string | the unit id it was expressed in |',
    '| `base` | number | canonical amount in `baseUnit` (authoritative) |',
    '| `baseUnit` | string | the kind base unit |',
    '| `text` | string | the full original input |',
    '| `span` | `{start,end,text}` | `[start,end)` char range into the input; `text` is that substring |',
    '| `issues` | Issue[] | warnings/errors (see codes below) |',
    '| `confidence` | number | 0–1 reading confidence |',
    '',
    `## Kinds (${BUILTIN_KINDS.length})`,
    '',
    BUILTIN_KINDS.map((k) => `\`${k}\``).join(', '),
    '',
    '## Unit systems',
    '',
    UNIT_SYSTEMS.map((s) => `\`${s}\``).join(', '),
    '',
    '## Issue severities',
    '',
    SEVERITIES.map((s) => `\`${s}\``).join(', '),
    '',
    `## Issue codes (${Object.keys(ISSUE_CODES).length})`,
    '',
    '| code | meaning |',
    '|---|---|',
    ...Object.entries(ISSUE_CODES).map(([code, desc]) => `| \`${code}\` | ${desc} |`),
    '',
  ]
  return `${lines.join('\n')}\n`
}

function HEADER(lib) {
  return `// Ready-made ${lib} schema for lingo's v3 wire JSON (@pascal-app/lingo).\n// Generated from @pascal-app/lingo/schema — see docs. Validate JSON.stringify(lingo(...)).\n`
}

function zod() {
  return `${HEADER('Zod')}import { z } from 'zod'

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
`
}

function valibot() {
  return `${HEADER('Valibot')}import * as v from 'valibot'

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
`
}

function typebox() {
  return `${HEADER('TypeBox')}import { Type as T } from '@sinclair/typebox'

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
`
}

function arktype() {
  return `${HEADER('ArkType')}import { type } from 'arktype'

export const span = type({ start: 'number.integer', end: 'number.integer', text: 'string' })
export const issue = type({
  code: 'string',
  severity: "'error' | 'warning' | 'info'",
  message: 'string',
  'span?': span,
  'suggestions?': 'string[]',
  'data?': 'Record<string, unknown>',
})
const bound = type({ value: 'number', unit: 'string', base: 'number', 'exclusive?': 'boolean' })
const ok = { schemaVersion: '3', ok: 'true', text: 'string', span, issues: issue.array(), confidence: 'number' }

export const quantity = type({ ...ok, type: "'quantity'", kind: 'string', value: 'number', unit: 'string', base: 'number', baseUnit: 'string', 'parts?': type({ value: 'number', unit: 'string' }).array(), 'approximate?': 'boolean' })
export const range = type({ ...ok, type: "'range'", kind: 'string', baseUnit: 'string', 'min?': bound, 'max?': bound, 'plusMinus?': type({ center: bound, delta: bound }), 'approximate?': 'boolean' })
export const conversion = type({ ...ok, type: "'conversion'", kind: 'string', source: 'Record<string, unknown>', converted: 'Record<string, unknown>' })
export const numberResult = type({ ...ok, type: "'number'", value: 'number', 'approximate?': 'boolean' })
export const failure = type({ schemaVersion: '3', ok: 'false', type: "'failure'", text: 'string', 'span?': span, issues: issue.array(), 'candidate?': 'Record<string, unknown>' })

export const lingoResult = quantity.or(range).or(conversion).or(numberResult).or(failure)
`
}

function effect() {
  return `${HEADER('Effect Schema')}// https://effect.website/
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
`
}
