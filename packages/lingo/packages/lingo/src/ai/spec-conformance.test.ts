import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec'
import { describe, expect, it } from 'vitest'
import type { QuantityRangeJSON } from '../core/quantity'
import {
  type CanonicalRange,
  dateField,
  lingoObject,
  optional,
  quantityField,
  rangeField,
  toJSONSchema,
} from './index'

const NOW = new Date(2026, 6, 3, 14, 30, 0)

const quantitySchema: StandardSchemaV1<unknown, number> & StandardJSONSchemaV1<unknown, number> =
  quantityField({ kind: 'mass', unit: 'kg' })
const rangeSchema: StandardSchemaV1<unknown, CanonicalRange> &
  StandardJSONSchemaV1<unknown, CanonicalRange> = rangeField({ kind: 'mass', unit: 'kg' })
const rangeJsonSchema: StandardSchemaV1<unknown, QuantityRangeJSON> &
  StandardJSONSchemaV1<unknown, QuantityRangeJSON> = rangeField({
  kind: 'mass',
  unit: 'kg',
  output: 'range',
})
const dateSchema: StandardSchemaV1<unknown, string> & StandardJSONSchemaV1<unknown, string> =
  dateField({ now: NOW })
const optionalSchema: StandardSchemaV1<unknown, number | null> &
  StandardJSONSchemaV1<unknown, number | null> = optional(
  quantityField({ kind: 'mass', unit: 'kg' }),
)
const objectSchema: StandardSchemaV1<unknown, { weight: number; maybeWeight: number | null }> &
  StandardJSONSchemaV1<unknown, { weight: number; maybeWeight: number | null }> = lingoObject({
  weight: quantityField({ kind: 'mass', unit: 'kg' }),
  maybeWeight: optional(quantityField({ kind: 'mass', unit: 'kg' })),
})

const fields: Array<{ readonly '~standard': { readonly version: 1; readonly vendor: string } }> = [
  quantitySchema,
  rangeSchema,
  rangeJsonSchema,
  dateSchema,
  optionalSchema,
  objectSchema,
]

describe('Standard Schema conformance', () => {
  it('exposes Standard Schema v1 lingo fields at runtime', () => {
    for (const field of fields) {
      expect(field['~standard'].version).toBe(1)
      expect(field['~standard'].vendor).toBe('lingo')
    }
  })

  it('returns JSON Schema through the named helper', () => {
    expect(toJSONSchema(quantityField({ kind: 'mass', unit: 'kg' }))).toMatchObject({
      type: 'string',
    })
    expect(
      toJSONSchema(quantityField({ kind: 'mass', unit: 'kg' }), {
        io: 'output',
        target: 'draft-07',
      }),
    ).toEqual({ type: 'number' })
  })
})
