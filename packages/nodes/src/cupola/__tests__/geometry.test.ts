import { describe, expect, test } from 'bun:test'
import { buildCupolaGeometry } from '../geometry'
import { CupolaNode } from '../schema'

function allFinite(geo: { getAttribute: (n: string) => { array: ArrayLike<number> } }): boolean {
  const arr = geo.getAttribute('position').array
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) return false
  }
  return true
}

describe('buildCupolaGeometry', () => {
  test('returns a non-empty BufferGeometry with matching attributes', () => {
    const geo = buildCupolaGeometry(CupolaNode.parse({}))
    const p = geo.getAttribute('position')
    expect(p.count).toBeGreaterThan(0)
    expect(geo.getAttribute('normal').count).toBe(p.count)
    expect(geo.getAttribute('uv').count).toBe(p.count)
  })

  test('both roof styles build finite geometry', () => {
    for (const roofStyle of ['dome', 'pyramid'] as const) {
      const geo = buildCupolaGeometry(CupolaNode.parse({ roofStyle }))
      expect(geo.getAttribute('position').count).toBeGreaterThan(0)
      expect(allFinite(geo)).toBe(true)
    }
  })

  test('finial adds vertices', () => {
    const withFinial = buildCupolaGeometry(CupolaNode.parse({ finial: true })).getAttribute(
      'position',
    ).count
    const without = buildCupolaGeometry(CupolaNode.parse({ finial: false })).getAttribute(
      'position',
    ).count
    expect(withFinial).toBeGreaterThan(without)
  })

  test('extreme dimensions never go NaN', () => {
    const geo = buildCupolaGeometry(
      CupolaNode.parse({ width: 0.01, depth: 5, height: 0.01, roofStyle: 'pyramid' }),
    )
    expect(geo.getAttribute('position').count).toBeGreaterThan(0)
    expect(allFinite(geo)).toBe(true)
  })
})
