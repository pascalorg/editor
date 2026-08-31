import { describe, expect, test } from 'bun:test'
import { RidgeVentNode } from '../schema'

describe('RidgeVentNode schema', () => {
  test('parses with defaults', () => {
    const parsed = RidgeVentNode.parse({})
    expect(parsed.type).toBe('ridge-vent')
    expect(parsed.id).toMatch(/^rvent_/)
    expect(parsed.length).toBe(2.0)
    expect(parsed.width).toBe(0.3)
    expect(parsed.height).toBe(0.1)
    expect(parsed.style).toBe('standard')
    expect(parsed.endCaps).toBe(true)
    expect(parsed.position).toEqual([0, 0, 0])
    expect(parsed.rotation).toBe(0)
    expect(parsed.roofSegmentId).toBeUndefined()
  })

  test('accepts each style', () => {
    expect(RidgeVentNode.parse({ style: 'standard' }).style).toBe('standard')
    expect(RidgeVentNode.parse({ style: 'shingled' }).style).toBe('shingled')
    expect(RidgeVentNode.parse({ style: 'metal' }).style).toBe('metal')
  })

  test('rejects unknown style', () => {
    expect(() => RidgeVentNode.parse({ style: 'foo' })).toThrow()
  })

  test('round-trips dimensions + binding', () => {
    const parsed = RidgeVentNode.parse({
      length: 3.5,
      width: 0.4,
      height: 0.1,
      style: 'metal',
      endCaps: false,
      roofSegmentId: 'rseg_xyz',
      position: [0.5, 0, 0],
      rotation: Math.PI / 2,
    })
    expect(parsed.length).toBe(3.5)
    expect(parsed.style).toBe('metal')
    expect(parsed.endCaps).toBe(false)
    expect(parsed.roofSegmentId).toBe('rseg_xyz')
  })

  test('unique IDs across calls', () => {
    expect(RidgeVentNode.parse({}).id).not.toBe(RidgeVentNode.parse({}).id)
  })
})
