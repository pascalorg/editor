import { describe, expect, test } from 'bun:test'
import { BoxVentNode } from '../schema'

describe('BoxVentNode schema', () => {
  test('parses with sensible defaults', () => {
    const parsed = BoxVentNode.parse({})
    expect(parsed.type).toBe('box-vent')
    expect(parsed.id).toMatch(/^bvent_/)
    expect(parsed.width).toBe(0.4)
    expect(parsed.depth).toBe(0.4)
    expect(parsed.height).toBe(0.15)
    expect(parsed.hoodOverhang).toBe(0.04)
    expect(parsed.style).toBe('cap')
    expect(parsed.position).toEqual([0, 0, 0])
    expect(parsed.rotation).toBe(0)
    expect(parsed.material).toBeUndefined()
    expect(parsed.materialPreset).toBe('preset-white')
    expect(parsed.roofSegmentId).toBeUndefined()
  })

  test('accepts each style', () => {
    expect(BoxVentNode.parse({ style: 'box' }).style).toBe('box')
    expect(BoxVentNode.parse({ style: 'cap' }).style).toBe('cap')
    expect(BoxVentNode.parse({ style: 'dome' }).style).toBe('dome')
  })

  test('rejects unknown style', () => {
    expect(() => BoxVentNode.parse({ style: 'unknown' })).toThrow()
  })

  test('round-trips dimensions and segment binding', () => {
    const parsed = BoxVentNode.parse({
      width: 0.6,
      depth: 0.5,
      height: 0.2,
      hoodOverhang: 0.08,
      style: 'dome',
      roofSegmentId: 'rseg_abc',
      position: [1.2, 0, -0.5],
      rotation: Math.PI / 4,
    })
    expect(parsed.width).toBe(0.6)
    expect(parsed.depth).toBe(0.5)
    expect(parsed.height).toBe(0.2)
    expect(parsed.hoodOverhang).toBe(0.08)
    expect(parsed.style).toBe('dome')
    expect(parsed.roofSegmentId).toBe('rseg_abc')
    expect(parsed.position).toEqual([1.2, 0, -0.5])
    expect(parsed.rotation).toBeCloseTo(Math.PI / 4)
  })

  test('generates unique IDs across calls', () => {
    const a = BoxVentNode.parse({})
    const b = BoxVentNode.parse({})
    expect(a.id).not.toBe(b.id)
  })
})
