import { describe, expect, test } from 'bun:test'
import { buildEyebrowVentGeometry } from '../geometry'
import { EyebrowVentNode } from '../schema'

function allFinite(geo: { getAttribute: (n: string) => { array: ArrayLike<number> } }): boolean {
  const arr = geo.getAttribute('position').array
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) return false
  }
  return true
}

describe('buildEyebrowVentGeometry', () => {
  test('returns a non-empty BufferGeometry with matching attributes', () => {
    const geo = buildEyebrowVentGeometry(EyebrowVentNode.parse({}))
    const p = geo.getAttribute('position')
    expect(p.count).toBeGreaterThan(0)
    expect(geo.getAttribute('normal').count).toBe(p.count)
    expect(geo.getAttribute('uv').count).toBe(p.count)
    expect(allFinite(geo)).toBe(true)
  })

  test('all three styles build finite geometry', () => {
    for (const style of ['scoop', 'half-round', 'slant-box'] as const) {
      const geo = buildEyebrowVentGeometry(EyebrowVentNode.parse({ style }))
      expect(geo.getAttribute('position').count).toBeGreaterThan(0)
      expect(allFinite(geo)).toBe(true)
    }
  })

  test('louvers add vertices', () => {
    const withLouvers = buildEyebrowVentGeometry(
      EyebrowVentNode.parse({ louverCount: 4 }),
    ).getAttribute('position').count
    const without = buildEyebrowVentGeometry(
      EyebrowVentNode.parse({ louverCount: 0 }),
    ).getAttribute('position').count
    expect(withLouvers).toBeGreaterThan(without)
  })

  test('extreme dimensions never go NaN', () => {
    for (const style of ['scoop', 'half-round', 'slant-box'] as const) {
      const geo = buildEyebrowVentGeometry(
        EyebrowVentNode.parse({ style, width: 0.01, depth: 5, height: 0.01 }),
      )
      expect(geo.getAttribute('position').count).toBeGreaterThan(0)
      expect(allFinite(geo)).toBe(true)
    }
  })
})
