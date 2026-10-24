import { describe, expect, test } from 'bun:test'
import { buildEyebrowVentGeometry, EyebrowVentNode } from '../index'

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
    expect(geo.getAttribute('uv2').count).toBe(p.count)
    expect(new Set(geo.groups.map((group) => group.materialIndex))).toEqual(new Set([0, 1]))
    expect(geo.groups.reduce((count, group) => count + group.count, 0)).toBe(p.count)
    expect(allFinite(geo)).toBe(true)
  })

  test('all three styles build finite geometry', () => {
    for (const style of ['scoop', 'half-round', 'slant-box'] as const) {
      const geo = buildEyebrowVentGeometry(EyebrowVentNode.parse({ style }))
      expect(geo.getAttribute('position').count).toBeGreaterThan(0)
      expect(allFinite(geo)).toBe(true)
      if (style === 'slant-box') {
        expect(new Set(geo.groups.map((group) => group.materialIndex))).toEqual(new Set([0, 1]))
      }
    }
  })

  test('unwraps the curved hood continuously at metre scale', () => {
    const geo = buildEyebrowVentGeometry(
      EyebrowVentNode.parse({ width: 2, depth: 3, height: 1, style: 'half-round' }),
    )
    const uv = geo.getAttribute('uv')
    const u = Array.from({ length: uv.count }, (_, index) => uv.getX(index))

    expect(Math.max(...u) - Math.min(...u)).toBeGreaterThan(3)
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

test('half-round vents render the requested number of separate louver blades', () => {
  for (const count of [0, 1, 2, 3, 4, 8]) {
    const geometry = buildEyebrowVentGeometry(
      EyebrowVentNode.parse({ style: 'half-round', louverCount: count }),
    )
    const positions = geometry.getAttribute('position')
    // Blades are disconnected solids in the front material group. Counting
    // their disjoint vertical ranges checks the visible result, not tessellation.
    const ranges: [number, number][] = []
    for (const group of geometry.groups.filter((group) => group.materialIndex === 1)) {
      for (let i = group.start; i < group.start + group.count; i += 3) {
        // Ignore the recessed backing so only the separate blades are counted.
        if (Math.max(positions.getZ(i), positions.getZ(i + 1), positions.getZ(i + 2)) < 0.241)
          continue
        const ys = [positions.getY(i), positions.getY(i + 1), positions.getY(i + 2)]
        ranges.push([Math.min(...ys), Math.max(...ys)])
      }
    }
    ranges.sort((a, b) => a[0] - b[0])
    let components = 0
    let high = -Infinity
    for (const [low, top] of ranges) {
      if (low > high + 1e-6) components++
      high = Math.max(high, top)
    }
    expect(components).toBe(count)
    geometry.dispose()
  }
})

for (const style of ['scoop', 'half-round', 'slant-box'] as const) {
  test(`${style} respects requested height and contains louvers in a shallow hood`, () => {
    for (const louverCount of [0, 1, 8]) {
      const node = EyebrowVentNode.parse({ style, width: 0.2, depth: 0.15, height: 2, louverCount })
      const geometry = buildEyebrowVentGeometry(node)
      geometry.computeBoundingBox()
      const bounds = geometry.boundingBox!
      expect(bounds.max.y).toBeCloseTo(node.height, 6)
      expect(bounds.min.y).toBeGreaterThanOrEqual(-1e-6)
      expect(bounds.max.z).toBeLessThanOrEqual(node.depth / 2 + 1e-6)
      expect(bounds.min.z).toBeGreaterThanOrEqual(-node.depth / 2 - 1e-6)
      expect(bounds.max.x).toBeLessThanOrEqual(node.width / 2 + 1e-6)
      expect(geometry.groups.some((g) => g.materialIndex === 1 && g.count > 0)).toBe(true)
      geometry.dispose()
    }
  })
}
