import { describe, expect, test } from 'bun:test'
import { ChimneyNode } from '../schema'

describe('ChimneyNode schema', () => {
  test('parses with defaults', () => {
    const parsed = ChimneyNode.parse({})
    expect(parsed.type).toBe('chimney')
    expect(parsed.id).toMatch(/^chimney_/)
    expect(parsed.width).toBe(0.6)
    expect(parsed.depth).toBe(0.6)
    expect(parsed.heightAboveRidge).toBe(1.0)
    expect(parsed.bodyShape).toBe('square')
    expect(parsed.cap).toBe(true)
    expect(parsed.capShape).toBe('sloped')
    expect(parsed.flueCount).toBe(1)
    expect(parsed.shoulderStyle).toBe('none')
    expect(parsed.cricketStyle).toBe('none')
  })

  test('accepts every body shape and cap shape', () => {
    for (const bodyShape of ['square', 'round'] as const) {
      expect(ChimneyNode.parse({ bodyShape }).bodyShape).toBe(bodyShape)
    }
    for (const capShape of ['none', 'sloped', 'flat', 'stepped'] as const) {
      expect(ChimneyNode.parse({ capShape }).capShape).toBe(capShape)
    }
  })

  test('rejects flueCount out of [0,4]', () => {
    expect(() => ChimneyNode.parse({ flueCount: -1 })).toThrow()
    expect(() => ChimneyNode.parse({ flueCount: 5 })).toThrow()
    expect(() => ChimneyNode.parse({ flueCount: 1.5 })).toThrow()
  })

  test('rejects unknown enums', () => {
    expect(() => ChimneyNode.parse({ shoulderStyle: 'bogus' })).toThrow()
    expect(() => ChimneyNode.parse({ cricketSide: 'side' })).toThrow()
  })
})
