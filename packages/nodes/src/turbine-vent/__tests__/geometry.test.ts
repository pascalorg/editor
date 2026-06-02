import { describe, expect, test } from 'bun:test'
import { buildTurbineVentBase, buildTurbineVentGeometry, buildTurbineVentHead } from '../geometry'
import { TurbineVentNode } from '../schema'

function allFinite(geo: { getAttribute: (n: string) => { array: ArrayLike<number> } }): boolean {
  const arr = geo.getAttribute('position').array
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) return false
  }
  return true
}

describe('turbine vent geometry', () => {
  test('combined geometry is a non-empty BufferGeometry with matching attributes', () => {
    const geo = buildTurbineVentGeometry(TurbineVentNode.parse({}))
    const positions = geo.getAttribute('position')
    const normals = geo.getAttribute('normal')
    const uvs = geo.getAttribute('uv')
    expect(positions.count).toBeGreaterThan(0)
    expect(normals.count).toBe(positions.count)
    expect(uvs.count).toBe(positions.count)
  })

  test('base and head both produce finite, non-empty geometry', () => {
    const node = TurbineVentNode.parse({})
    const base = buildTurbineVentBase(node)
    const head = buildTurbineVentHead(node)
    expect(base.getAttribute('position').count).toBeGreaterThan(0)
    expect(head.getAttribute('position').count).toBeGreaterThan(0)
    expect(allFinite(base)).toBe(true)
    expect(allFinite(head)).toBe(true)
  })

  test('both styles build finite geometry', () => {
    for (const style of ['globe', 'cylinder'] as const) {
      const geo = buildTurbineVentGeometry(TurbineVentNode.parse({ style }))
      expect(geo.getAttribute('position').count).toBeGreaterThan(0)
      expect(allFinite(geo)).toBe(true)
    }
  })

  test('vane count scales the head vertex count', () => {
    const few = buildTurbineVentHead(TurbineVentNode.parse({ vaneCount: 8 }))
    const many = buildTurbineVentHead(TurbineVentNode.parse({ vaneCount: 30 }))
    expect(many.getAttribute('position').count).toBeGreaterThan(few.getAttribute('position').count)
  })

  test('legacy / extreme dimensions never go NaN', () => {
    const geo = buildTurbineVentGeometry(
      TurbineVentNode.parse({ diameter: 0.01, height: 0.01, neckHeight: 5, vaneCount: 100 }),
    )
    expect(geo.getAttribute('position').count).toBeGreaterThan(0)
    expect(allFinite(geo)).toBe(true)
  })
})
