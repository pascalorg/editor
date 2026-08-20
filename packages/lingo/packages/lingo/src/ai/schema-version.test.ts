import { describe, expect, it } from 'vitest'
import { quantityField, rangeField } from './index'

describe('output JSON Schema schemaVersion matches runtime wire shape', () => {
  it('quantity output schema declares the same schemaVersion the runtime emits', () => {
    const field = quantityField({ kind: 'mass', unit: 'kg', output: 'quantity' })
    const outputSchema = field['~standard'].jsonSchema.output({ target: 'draft-2020-12' }) as {
      properties: { schemaVersion: { enum: number[] } }
    }
    const declaredVersion = outputSchema.properties.schemaVersion.enum[0]!
    const runtimeValue = field.parse('5 kg') as { schemaVersion: number }
    expect(runtimeValue.schemaVersion).toBe(declaredVersion)
  })

  it('range output schema declares the same schemaVersion the runtime emits', () => {
    const field = rangeField({ kind: 'mass', unit: 'kg', output: 'range' })
    const outputSchema = field['~standard'].jsonSchema.output({ target: 'draft-2020-12' }) as {
      properties: { schemaVersion: { enum: number[] } }
    }
    const declaredVersion = outputSchema.properties.schemaVersion.enum[0]!
    const runtimeValue = field.parse('5-10 kg') as { schemaVersion: number }
    expect(runtimeValue.schemaVersion).toBe(declaredVersion)
  })
})
