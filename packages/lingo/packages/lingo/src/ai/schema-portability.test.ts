import { describe, expect, it } from 'vitest'
import { dateField, lingoObject, optional, quantityField, rangeField } from './index'

const FORBIDDEN = new Set([
  'prefixItems',
  '$dynamicRef',
  '$dynamicAnchor',
  'unevaluatedProperties',
  'unevaluatedItems',
  'dependentSchemas',
  'dependentRequired',
])

const TARGETS = ['draft-07', 'draft-2020-12', 'openapi-3.0'] as const
const DIRECTIONS = ['input', 'output'] as const
const NOW = new Date(2026, 6, 3, 14, 30, 0)

describe('AI JSON Schema portability', () => {
  it('emits schemas without target-specific 2020-only keywords', () => {
    const fields = [
      quantityField({ kind: 'mass', unit: 'kg' }),
      rangeField({ kind: 'mass', unit: 'kg' }),
      rangeField({ kind: 'mass', unit: 'kg', output: 'range' }),
      dateField({ now: NOW }),
      lingoObject({
        weight: quantityField({ kind: 'mass', unit: 'kg' }),
        window: rangeField({ kind: 'mass', unit: 'kg' }),
        eta: dateField({ now: NOW }),
      }),
      optional(
        lingoObject({
          weight: quantityField({ kind: 'mass', unit: 'kg' }),
        }),
      ),
      optional(rangeField({ kind: 'mass', unit: 'kg' })),
    ]

    for (const field of fields) {
      for (const target of TARGETS) {
        for (const direction of DIRECTIONS) {
          const schema = field['~standard'].jsonSchema[direction]({ target })
          expect(forbiddenPaths(schema)).toEqual([])
        }
      }
    }
  })
})

function forbiddenPaths(value: unknown): string[] {
  const paths: string[] = []
  walk(value, '$', paths)
  return paths
}

function walk(value: unknown, path: string, paths: string[]): void {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      walk(value[index], `${path}[${index}]`, paths)
    }
    return
  }
  if (typeof value !== 'object' || value === null) {
    return
  }
  for (const [key, child] of Object.entries(value)) {
    const nextPath = `${path}.${key}`
    if (FORBIDDEN.has(key)) {
      paths.push(nextPath)
    }
    walk(child, nextPath, paths)
  }
}
