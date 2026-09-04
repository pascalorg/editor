import { describe, expect, it } from 'vitest'
import { lingoObject, optional, quantityField, rangeField } from './index'
import { createField } from './standard-schema'

describe('optional AI fields', () => {
  it('maps null and undefined to null and delegates real values', () => {
    const field = optional(quantityField({ kind: 'mass', unit: 'kg' }))

    expect(field.parse(null)).toBeNull()
    expect(field.parse(undefined)).toBeNull()
    expect(field.parse('2 lbs')).toBeCloseTo(0.907_184_74, 10)
  })

  it('keeps lingoObject keys required while missing optional values become null', () => {
    const schema = lingoObject({
      weight: optional(quantityField({ kind: 'mass', unit: 'kg' })),
    })

    expect(schema.parse({})).toEqual({ weight: null })

    const input = schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' })
    expect(input.required).toEqual(['weight'])
    expect(input.properties).toMatchObject({
      weight: { type: ['string', 'null'] },
    })
  })

  it('emits nullable input and output schemas for scalar schemas', () => {
    const field = optional(quantityField({ kind: 'mass', unit: 'kg' }))

    expect(field['~standard'].jsonSchema.input({ target: 'draft-07' })).toMatchObject({
      type: ['string', 'null'],
    })
    expect(field['~standard'].jsonSchema.output({ target: 'draft-07' })).toEqual({
      type: ['number', 'null'],
    })
  })

  it('emits anyOf nullable schemas for object and range output schemas', () => {
    const object = optional(
      lingoObject({
        weight: quantityField({ kind: 'mass', unit: 'kg' }),
      }),
    )
    const objectInput = object['~standard'].jsonSchema.input({ target: 'draft-2020-12' })
    expect(objectInput).toMatchObject({
      anyOf: [
        {
          type: 'object',
          properties: { weight: { type: 'string' } },
          required: ['weight'],
          additionalProperties: false,
        },
        { type: 'null' },
      ],
    })

    const range = optional(rangeField({ kind: 'mass', unit: 'kg' }))
    expect(range['~standard'].jsonSchema.input({ target: 'draft-2020-12' })).toMatchObject({
      type: ['string', 'null'],
    })
    expect(range['~standard'].jsonSchema.output({ target: 'draft-2020-12' })).toMatchObject({
      anyOf: [
        {
          type: 'object',
          properties: {
            min: { type: 'number' },
            max: { type: 'number' },
          },
          required: ['min', 'max'],
          additionalProperties: false,
        },
        { type: 'null' },
      ],
    })
  })

  it('wraps schemas without a scalar type in anyOf and preserves description', () => {
    const field = createField<string>(
      (value) => (value === 'ok' ? { value } : { issues: [{ message: 'Expected ok.' }] }),
      {
        input: () => ({ enum: ['ok'], description: 'Only ok.' }),
        output: () => ({ enum: ['ok'], description: 'Only ok.' }),
      },
    )

    expect(optional(field)['~standard'].jsonSchema.input({ target: 'draft-2020-12' })).toEqual({
      anyOf: [{ enum: ['ok'], description: 'Only ok.' }, { type: 'null' }],
      description: 'Only ok.',
    })
  })

  it('keeps delegate failures intact', () => {
    const result = optional(quantityField({ kind: 'mass', unit: 'kg' })).safeParse('banana')

    if ('value' in result) {
      throw new Error('expected delegate failure')
    }
    expect(result.issues[0]).toMatchObject({
      message: expect.stringContaining('[NO_VALUE]'),
      code: 'NO_VALUE',
      severity: 'error',
      span: { start: 0, end: 6 },
      data: { example: '"5 kg"' },
    })
  })
})
