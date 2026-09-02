import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { measurement } from './measurement'

describe('measurement()', () => {
  test('parses natural-language length to meters', () => {
    const m = measurement('length', 'm', { min: 0 })
    expect(m.parse('6 in')).toBeCloseTo(0.1524, 6)
    expect(m.parse('180cm')).toBeCloseTo(1.8, 6)
    expect(m.parse('1m80')).toBeCloseTo(1.8, 6)
    expect(m.parse(`5'11"`)).toBeCloseTo(1.8034, 4)
    expect(m.parse('2 ft 3 in')).toBeCloseTo(0.6858, 6)
  })

  test('passes numbers through unchanged (backward compatible)', () => {
    const m = measurement('length', 'm', { min: 0 })
    expect(m.parse(0.15)).toBe(0.15)
    expect(m.parse(3)).toBe(3)
  })

  test('reads a bare numeric string as the field unit', () => {
    expect(measurement('length', 'm').parse('6')).toBe(6)
    expect(measurement('angle', 'deg').parse('45')).toBe(45)
  })

  test('canonicalizes angles to the field unit', () => {
    expect(measurement('angle', 'deg').parse('45°')).toBe(45)
    expect(measurement('angle', 'deg').parse('1.57rad')).toBeCloseTo(89.954, 3)
    expect(measurement('angle', 'rad').parse('90deg')).toBeCloseTo(Math.PI / 2, 6)
    expect(measurement('angle', 'rad').parse('0.25 turn')).toBeCloseTo(Math.PI / 2, 6)
  })

  test('enforces min/max bounds in the field unit', () => {
    const m = measurement('length', 'm', { min: 0, max: 3 })
    expect(m.safeParse('-1').success).toBe(false)
    expect(m.safeParse('900ft').success).toBe(false)
    expect(m.safeParse('2m').success).toBe(true)
    const tooBig = m.safeParse('900ft')
    expect(tooBig.success).toBe(false)
    if (!tooBig.success) expect(tooBig.error.issues[0]?.message).toContain('at most 3 m')
  })

  test('rejects unparseable input with a model-readable message', () => {
    const r = measurement('length', 'm').safeParse('banana')
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0]?.message.toLowerCase()).toContain('number')
  })

  test('positive rejects zero and negatives (restores .positive() behavior)', () => {
    const m = measurement('length', 'm', { positive: true })
    expect(m.safeParse(0).success).toBe(false)
    expect(m.safeParse('0m').success).toBe(false)
    expect(m.safeParse(-1).success).toBe(false)
    expect(m.parse(0.1)).toBe(0.1)
  })

  test('rejects ambiguous separators instead of a silent 1000x reading', () => {
    const r = measurement('length', 'm').safeParse('1,234')
    expect(r.success).toBe(false)
  })

  test('emits a number|string JSON schema advertising natural language', () => {
    const schema = z.toJSONSchema(
      measurement('length', 'm', { min: 0, description: 'Wall thickness.' }),
      {
        io: 'input',
      },
    )

    expect(acceptedJsonTypes(schema)).toEqual(['number', 'string'])
    expect((schema as { description?: string }).description).toContain('natural-language')
  })
})

/**
 * The types a JSON Schema node admits, whichever spelling it uses: zod ≤4.4
 * emitted a primitive union as `anyOf: [{type:'number'},{type:'string'}]`, zod
 * ≥4.5 folds it to `type: ['number','string']`. Both are draft-2020-12
 * equivalent (verified against the ajv the MCP SDK ships), so the tool contract
 * is the accepted type set, not the shape it is written in.
 */
function acceptedJsonTypes(schema: unknown): string[] {
  const node = schema as {
    anyOf?: { type?: string }[]
    type?: string | string[]
  }
  const types = node.anyOf
    ? node.anyOf.flatMap((member) => (member.type ? [member.type] : []))
    : [node.type ?? []].flat()

  return [...new Set(types)].sort()
}
