// Machine-readable schema for lingo's v3 compact wire JSON (D57). Pure data —
// a JSON Schema (Draft 2020-12, also valid as OpenAPI 3.1 schema objects), plus
// the enum reference the docs dictionary is built from. Zero runtime deps;
// framework-specific schemas (Zod/Valibot/TypeBox/ArkType/Effect) are GENERATED
// from this in the docs (scripts/gen-schemas.mjs), never depended on.
import { BUILTIN_KINDS, ISSUE_CODE_LIST, SEVERITIES } from './enums'

export { BUILTIN_KINDS, ISSUE_CODES, SEVERITIES, UNIT_SYSTEMS } from './enums'

/** A plain JSON value (the schema is data, not a class). */
export type JsonSchema = Record<string, unknown>

const span: JsonSchema = {
  type: 'object',
  description: 'A [start, end) character range into the ORIGINAL input, with the matched text.',
  required: ['start', 'end', 'text'],
  additionalProperties: false,
  properties: {
    start: {
      type: 'integer',
      minimum: 0,
      description: 'Start offset (inclusive), UTF-16 code units.',
    },
    end: { type: 'integer', minimum: 0, description: 'End offset (exclusive), UTF-16 code units.' },
    text: {
      type: 'string',
      description: 'input.slice(start, end) — the exact text this points at.',
    },
  },
}

const issue: JsonSchema = {
  type: 'object',
  description: 'A warning or error, pointing at the input text it concerns.',
  required: ['code', 'severity', 'message'],
  additionalProperties: false,
  properties: {
    code: {
      type: 'string',
      enum: ISSUE_CODE_LIST,
      description: 'Stable machine code — switch on this.',
    },
    severity: {
      type: 'string',
      enum: [...SEVERITIES],
      description: "'error' fails the parse; 'warning'/'info' ride along.",
    },
    message: {
      type: 'string',
      description: 'Human-readable copy (overridable via the `messages` option).',
    },
    span: { $ref: '#/$defs/span' },
    suggestions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Ready-to-render did-you-mean candidates.',
    },
    data: {
      type: 'object',
      description: 'Code-specific structured payload.',
      additionalProperties: true,
    },
  },
}

const bound: JsonSchema = {
  type: 'object',
  required: ['value', 'unit', 'base'],
  additionalProperties: false,
  properties: {
    value: { type: 'number', description: 'Amount in `unit`.' },
    unit: { type: 'string', description: 'Unit id.' },
    base: { type: 'number', description: 'Amount in the kind base unit.' },
    exclusive: { type: 'boolean', description: 'True when the bound is exclusive (< / >).' },
  },
}

const kind: JsonSchema = {
  type: 'string',
  description: 'Measurement kind. Built-ins listed; custom registries may add more.',
  examples: [...BUILTIN_KINDS],
}

const okProps = {
  schemaVersion: { const: 3 },
  ok: { const: true },
  text: { type: 'string', description: 'The full original input string.' },
  span: { $ref: '#/$defs/span' },
  issues: { type: 'array', items: { $ref: '#/$defs/issue' } },
  confidence: { type: 'number', minimum: 0, maximum: 1, description: '0–1 reading confidence.' },
} as const

const quantity: JsonSchema = {
  type: 'object',
  title: 'Quantity result',
  required: [
    'schemaVersion',
    'ok',
    'type',
    'kind',
    'value',
    'unit',
    'base',
    'baseUnit',
    'text',
    'span',
    'issues',
    'confidence',
  ],
  additionalProperties: false,
  properties: {
    ...okProps,
    type: { const: 'quantity' },
    kind: { $ref: '#/$defs/kind' },
    value: { type: 'number', description: 'The amount in `unit` (the 72 in "72 in").' },
    unit: { type: 'string', description: 'The unit it was expressed/requested in.' },
    base: {
      type: 'number',
      description: 'The canonical amount in `baseUnit` — the authoritative value.',
    },
    baseUnit: { type: 'string', description: 'The kind base unit `base` is in.' },
    parts: {
      type: 'array',
      description: 'Compound breakdown ("5 ft 11 in").',
      items: {
        type: 'object',
        required: ['value', 'unit'],
        properties: { value: { type: 'number' }, unit: { type: 'string' } },
      },
    },
    approximate: { type: 'boolean' },
    alternatives: {
      type: 'array',
      description: 'Ranked secondary readings (e.g. the other side of an ambiguous number).',
      items: {
        type: 'object',
        required: ['type', 'reason', 'confidence', 'quantity'],
        additionalProperties: false,
        properties: {
          type: { const: 'quantity' },
          reason: { type: 'string' },
          confidence: { type: 'number' },
          quantity: {
            type: 'object',
            required: ['schemaVersion', 'type', 'kind', 'value', 'unit', 'base', 'baseUnit'],
            properties: {
              schemaVersion: { const: 3 },
              type: { const: 'quantity' },
              kind: { $ref: '#/$defs/kind' },
              value: { type: 'number' },
              unit: { type: 'string' },
              base: { type: 'number' },
              baseUnit: { type: 'string' },
            },
          },
        },
      },
    },
  },
}

const rangeProps = {
  type: { const: 'range' },
  kind: { $ref: '#/$defs/kind' },
  baseUnit: { type: 'string' },
  min: { $ref: '#/$defs/bound' },
  max: { $ref: '#/$defs/bound' },
  plusMinus: {
    type: 'object',
    required: ['center', 'delta'],
    properties: { center: { $ref: '#/$defs/bound' }, delta: { $ref: '#/$defs/bound' } },
  },
  fuzzy: {
    type: 'object',
    required: ['term', 'profile'],
    properties: { term: { type: 'string' }, profile: { type: 'string' } },
  },
  approximate: { type: 'boolean' },
} as const

const range: JsonSchema = {
  type: 'object',
  title: 'Range result',
  required: [
    'schemaVersion',
    'ok',
    'type',
    'kind',
    'baseUnit',
    'text',
    'span',
    'issues',
    'confidence',
  ],
  additionalProperties: false,
  properties: { ...okProps, ...rangeProps },
}

const conversion: JsonSchema = {
  type: 'object',
  title: 'Conversion result',
  required: [
    'schemaVersion',
    'ok',
    'type',
    'kind',
    'source',
    'converted',
    'text',
    'span',
    'issues',
    'confidence',
  ],
  additionalProperties: false,
  properties: {
    ...okProps,
    type: { const: 'conversion' },
    kind: { $ref: '#/$defs/kind' },
    source: {
      description: 'The value as typed, minus schemaVersion/kind (both at the conversion top).',
      oneOf: [
        {
          type: 'object',
          required: ['type', 'value', 'unit', 'base', 'baseUnit'],
          properties: {
            type: { const: 'quantity' },
            value: { type: 'number' },
            unit: { type: 'string' },
            base: { type: 'number' },
            baseUnit: { type: 'string' },
          },
        },
        {
          type: 'object',
          required: ['type', 'baseUnit'],
          properties: {
            type: { const: 'range' },
            baseUnit: { type: 'string' },
            min: { $ref: '#/$defs/bound' },
            max: { $ref: '#/$defs/bound' },
            plusMinus: {
              type: 'object',
              required: ['center', 'delta'],
              properties: { center: { $ref: '#/$defs/bound' }, delta: { $ref: '#/$defs/bound' } },
            },
          },
        },
      ],
    },
    converted: {
      description:
        'The target — value + unit only (magnitude is preserved, so base equals the source).',
      oneOf: [
        {
          type: 'object',
          required: ['value', 'unit'],
          additionalProperties: false,
          properties: { value: { type: 'number' }, unit: { type: 'string' } },
        },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            min: {
              type: 'object',
              required: ['value', 'unit'],
              properties: { value: { type: 'number' }, unit: { type: 'string' } },
            },
            max: {
              type: 'object',
              required: ['value', 'unit'],
              properties: { value: { type: 'number' }, unit: { type: 'string' } },
            },
            plusMinus: { type: 'object' },
          },
        },
      ],
    },
  },
}

const numberResult: JsonSchema = {
  type: 'object',
  title: 'Number result',
  required: ['schemaVersion', 'ok', 'type', 'value', 'text', 'span', 'issues', 'confidence'],
  additionalProperties: false,
  properties: {
    ...okProps,
    type: { const: 'number' },
    value: { type: 'number' },
    approximate: { type: 'boolean' },
  },
}

const failure: JsonSchema = {
  type: 'object',
  title: 'Failure result',
  required: ['schemaVersion', 'ok', 'type', 'text', 'issues'],
  additionalProperties: false,
  properties: {
    schemaVersion: { const: 3 },
    ok: { const: false },
    type: { const: 'failure' },
    text: { type: 'string' },
    span: { $ref: '#/$defs/span' },
    issues: { type: 'array', items: { $ref: '#/$defs/issue' } },
    candidate: {
      description:
        'The successful reading strictness rejected (for confirm UX) — a flat v3 result.',
      type: 'object',
      required: ['schemaVersion', 'ok', 'type'],
      properties: {
        schemaVersion: { const: 3 },
        ok: { const: true },
        type: { enum: ['quantity', 'range', 'conversion', 'number'] },
      },
    },
  },
}

/**
 * JSON Schema (Draft 2020-12) for the v3 compact wire JSON that
 * `JSON.stringify(lingo(...))` / `result.toJSON()` produces. A discriminated
 * union on `type`. Also valid as OpenAPI 3.1 schema objects — see `toOpenApi()`.
 * @example
 * ```ts
 * import { lingoJsonSchema } from '@pascal-app/lingo/schema'
 * lingoJsonSchema.$id // 'https://pascal.app/lingo/schema/v3'
 * ```
 */
export const lingoJsonSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://pascal.app/lingo/schema/v3',
  title: 'Lingo parse result (v3)',
  description:
    'The compact wire JSON lingo() emits. Switch on `type` (check `ok` first for failures).',
  oneOf: [
    { $ref: '#/$defs/quantity' },
    { $ref: '#/$defs/range' },
    { $ref: '#/$defs/conversion' },
    { $ref: '#/$defs/number' },
    { $ref: '#/$defs/failure' },
  ],
  $defs: {
    span,
    issue,
    bound,
    kind,
    quantity,
    range,
    conversion,
    number: numberResult,
    failure,
  },
}

/**
 * Wrap the JSON Schema as an OpenAPI 3.1 document under `components.schemas`,
 * ready to drop into an API spec.
 * @example
 * ```ts
 * import { toOpenApi } from '@pascal-app/lingo/schema'
 * toOpenApi().openapi // '3.1.0'
 * ```
 */
export function toOpenApi(): JsonSchema {
  const defs = (lingoJsonSchema.$defs ?? {}) as Record<string, JsonSchema>
  const schemas: Record<string, JsonSchema> = {
    LingoResult: { oneOf: lingoJsonSchema.oneOf as JsonSchema[] },
  }
  for (const [name, def] of Object.entries(defs)) {
    schemas[`Lingo${name[0]!.toUpperCase()}${name.slice(1)}`] = rewriteRefs(def)
  }
  schemas.LingoResult = rewriteRefs(schemas.LingoResult)
  return {
    openapi: '3.1.0',
    info: { title: 'Lingo parse result', version: '3' },
    components: { schemas },
  }
}

/** Rewrite JSON Schema `#/$defs/x` refs to OpenAPI `#/components/schemas/Lingox`. */
function rewriteRefs(node: unknown): JsonSchema {
  if (Array.isArray(node)) {
    return node.map(rewriteRefs) as unknown as JsonSchema
  }
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') {
        const name = value.replace('#/$defs/', '')
        out.$ref = `#/components/schemas/Lingo${name[0]!.toUpperCase()}${name.slice(1)}`
      } else {
        out[key] = rewriteRefs(value)
      }
    }
    return out as JsonSchema
  }
  return node as JsonSchema
}
