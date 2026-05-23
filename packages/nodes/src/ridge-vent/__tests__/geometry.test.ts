import { describe, expect, test } from 'bun:test'
import { buildRidgeVentGeometry } from '../geometry'
import { RidgeVentNode } from '../schema'

describe('buildRidgeVentGeometry', () => {
  test('returns geometry with matching position / normal / uv counts', () => {
    const geo = buildRidgeVentGeometry(RidgeVentNode.parse({}))
    const p = geo.getAttribute('position').count
    expect(p).toBeGreaterThan(0)
    expect(geo.getAttribute('normal').count).toBe(p)
    expect(geo.getAttribute('uv').count).toBe(p)
  })

  test('each style produces a different vertex count (no accidental fallthrough)', () => {
    const standard = buildRidgeVentGeometry(
      RidgeVentNode.parse({ style: 'standard' }),
    ).getAttribute('position').count
    const shingled = buildRidgeVentGeometry(
      RidgeVentNode.parse({ style: 'shingled' }),
    ).getAttribute('position').count
    const metal = buildRidgeVentGeometry(RidgeVentNode.parse({ style: 'metal' })).getAttribute(
      'position',
    ).count
    expect(new Set([standard, shingled, metal]).size).toBe(3)
  })

  test('endCaps adds vertices on every style', () => {
    for (const style of ['standard', 'shingled', 'metal'] as const) {
      const without = buildRidgeVentGeometry(
        RidgeVentNode.parse({ style, endCaps: false }),
      ).getAttribute('position').count
      const withCaps = buildRidgeVentGeometry(
        RidgeVentNode.parse({ style, endCaps: true }),
      ).getAttribute('position').count
      expect(withCaps).toBeGreaterThan(without)
    }
  })

  test('length scales the X bounds proportionally', () => {
    const geo = buildRidgeVentGeometry(RidgeVentNode.parse({ length: 4, endCaps: false }))
    const pos = geo.getAttribute('position').array as Float32Array
    let maxX = -Infinity
    let minX = Infinity
    for (let i = 0; i < pos.length; i += 3) {
      if (pos[i]! > maxX) maxX = pos[i]!
      if (pos[i]! < minX) minX = pos[i]!
    }
    expect(maxX).toBeCloseTo(2)
    expect(minX).toBeCloseTo(-2)
  })
})
