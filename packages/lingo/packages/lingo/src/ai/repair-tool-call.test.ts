import { describe, expect, it } from 'vitest'
import { lingoObject, quantityField, repairToolCallWith } from './index'

describe('repairToolCallWith', () => {
  it('repairs matching tool calls by canonicalizing their JSON input', async () => {
    const repair = repairToolCallWith({
      ship: {
        weight: quantityField({ kind: 'mass', unit: 'kg' }),
        height: quantityField({ kind: 'length', unit: 'm' }),
      },
    })

    const fixed = await repair({
      toolCall: {
        toolCallId: 'call_1',
        toolName: 'ship',
        input: JSON.stringify({ weight: '2kg', height: '180 cm' }),
      },
      error: new Error('schema validation failed'),
    })

    expect(fixed).toEqual({
      toolCallId: 'call_1',
      toolName: 'ship',
      input: JSON.stringify({ weight: 2, height: 1.8 }),
    })
  })

  it('repairs root field specs', async () => {
    const repair = repairToolCallWith({
      weigh: quantityField({ kind: 'mass', unit: 'kg' }),
    })

    const fixed = await repair({
      toolCall: { toolCallId: 'call_1', toolName: 'weigh', input: JSON.stringify('2kg') },
      error: new Error('schema validation failed'),
    })

    expect(fixed?.input).toBe('2')
  })

  it('allows warning-severity canonicalization but rejects remaining errors', async () => {
    const repair = repairToolCallWith({
      ship: { weight: quantityField({ kind: 'mass', unit: 'kg' }) },
    })

    const typo = await repair({
      toolCall: {
        toolCallId: 'call_1',
        toolName: 'ship',
        input: JSON.stringify({ weight: '5 kilogramz' }),
      },
      error: new Error('schema validation failed'),
    })
    const ambiguous = await repair({
      toolCall: {
        toolCallId: 'call_2',
        toolName: 'ship',
        input: JSON.stringify({ weight: '1,234 kg' }),
      },
      error: new Error('schema validation failed'),
    })

    expect(typo?.input).toBe(JSON.stringify({ weight: 5 }))
    expect(ambiguous).toBeNull()
  })

  it('returns null for unknown tools, invalid JSON, and failed field specs', async () => {
    const repair = repairToolCallWith({
      ship: lingoObject({ weight: quantityField({ kind: 'mass', unit: 'kg' }) }),
    })

    await expect(
      repair({
        toolCall: { toolCallId: 'call_1', toolName: 'unknown', input: '{}' },
        error: new Error('schema validation failed'),
      }),
    ).resolves.toBeNull()
    await expect(
      repair({
        toolCall: { toolCallId: 'call_2', toolName: 'ship', input: 'not json' },
        error: new Error('schema validation failed'),
      }),
    ).resolves.toBeNull()
    await expect(
      repair({
        toolCall: {
          toolCallId: 'call_3',
          toolName: 'ship',
          input: JSON.stringify({ weight: 'banana' }),
        },
        error: new Error('schema validation failed'),
      }),
    ).resolves.toBeNull()
  })
})
