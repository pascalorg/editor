import { describe, expect, it } from 'vitest'
import { listKinds } from '../catalog/index'
import { lingo } from '../index'
import { BUILTIN_KINDS, ISSUE_CODES, lingoJsonSchema, SEVERITIES, toOpenApi } from './index'

type Schema = Record<string, any>

// Minimal Draft-2020-12 validator covering the subset lingoJsonSchema uses —
// enough to keep the published schema honest against real lingo() output.
function validate(value: unknown, schema: Schema, root: Schema, path = '$'): string[] {
  if (schema.$ref) {
    const name = String(schema.$ref).replace('#/$defs/', '')
    return validate(value, root.$defs[name], root, path)
  }
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((s: Schema) => validate(value, s, root, path).length === 0)
    return matches.length === 1 ? [] : [`${path}: matched ${matches.length} of oneOf (want 1)`]
  }
  if (schema.const !== undefined) {
    return value === schema.const
      ? []
      : [`${path}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`]
  }
  if (schema.enum) {
    return (schema.enum as unknown[]).includes(value)
      ? []
      : [`${path}: ${JSON.stringify(value)} not in enum`]
  }
  const errors: string[] = []
  const t = schema.type
  if (t === 'integer' && !Number.isInteger(value)) {
    errors.push(`${path}: not an integer`)
  } else if (t === 'number' && typeof value !== 'number') {
    errors.push(`${path}: not a number`)
  } else if (t === 'string' && typeof value !== 'string') {
    errors.push(`${path}: not a string`)
  } else if (t === 'boolean' && typeof value !== 'boolean') {
    errors.push(`${path}: not a boolean`)
  } else if (t === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${path}: not an array`)
    } else if (schema.items) {
      for (const [i, item] of value.entries()) {
        errors.push(...validate(item, schema.items, root, `${path}[${i}]`))
      }
    }
  } else if (t === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      errors.push(`${path}: not an object`)
    } else {
      const obj = value as Record<string, unknown>
      for (const key of schema.required ?? []) {
        if (!(key in obj)) {
          errors.push(`${path}.${key}: required, missing`)
        }
      }
      if (schema.additionalProperties === false && schema.properties) {
        for (const key of Object.keys(obj)) {
          if (!(key in schema.properties)) {
            errors.push(`${path}.${key}: unexpected property`)
          }
        }
      }
      for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        if (key in obj) {
          errors.push(...validate(obj[key], sub as Schema, root, `${path}.${key}`))
        }
      }
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path}: below minimum`)
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path}: above maximum`)
    }
  }
  return errors
}

const cases = [
  '2 ft',
  '5 meterz', // typo-corrected → issue with a sub-span
  '72 in to cm', // conversion
  'between 5 and 10 kg', // range
  '5 ft 11 in', // compound parts
  '10 ± 0.5 mm', // plus-minus range
  '5-10 kg to lb', // range conversion
  '72', // number
  'about 2 ft please', // sub-span
  '1,234 kg', // quantity with ranked alternatives
]

describe('JSON Schema stays honest against real lingo() output', () => {
  for (const input of cases) {
    it(`validates ${JSON.stringify(input)} against lingoJsonSchema`, () => {
      const result = JSON.parse(
        JSON.stringify(lingo(input, { kind: input.includes('meterz') ? 'length' : undefined })),
      )
      const errors = validate(result, lingoJsonSchema, lingoJsonSchema)
      expect(errors, errors.join('\n')).toEqual([])
    })
  }

  it('validates a strict failure result', () => {
    const result = JSON.parse(
      JSON.stringify(lingo('5 meterz', { kind: 'length', strictness: 'strict' })),
    )
    expect(result.ok).toBe(false)
    expect(validate(result, lingoJsonSchema, lingoJsonSchema)).toEqual([])
  })
})

describe('schema reference data', () => {
  it('kinds match the runtime registry', () => {
    expect(BUILTIN_KINDS).toEqual(listKinds())
  })

  it('every issue code has a dictionary description', () => {
    expect(Object.keys(ISSUE_CODES).length).toBe(33)
    for (const desc of Object.values(ISSUE_CODES)) {
      expect(desc.length).toBeGreaterThan(5)
    }
  })

  it('severities are the three fixed values', () => {
    expect([...SEVERITIES]).toEqual(['error', 'warning', 'info'])
  })

  it('toOpenApi() produces a 3.1 document with rewritten refs', () => {
    const oa = toOpenApi() as any
    expect(oa.openapi).toBe('3.1.0')
    expect(oa.components.schemas.LingoResult).toBeDefined()
    expect(JSON.stringify(oa)).not.toContain('#/$defs/')
    expect(JSON.stringify(oa)).toContain('#/components/schemas/Lingo')
  })
})
