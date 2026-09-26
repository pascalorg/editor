import { describe, expect, test } from 'bun:test'
import { createTerrainField, quantize, surfaceHeightAt } from '@pascal-app/core'
import {
  buildPatternedRibbon,
  PROPERTY_LINE_PATTERN,
  SETBACK_LINE_PATTERN,
  updateRibbonHeights,
} from './line-ribbon'
import { classifyEdges, resolveFrontEdge, setbackEnvelope } from './setbacks'

// a 20 × 30 m lot; edge 0 runs along z = −15 (north), 1 east, 2 south, 3 west
const LOT: [number, number][] = [
  [-10, -15],
  [10, -15],
  [10, 15],
  [-10, 15],
]

describe('setbacks (the 3D copy of the site plan rules)', () => {
  test('the front edge names the roles and the envelope shrinks by each side', () => {
    expect(resolveFrontEdge(LOT, 2)).toBe(2)
    expect(resolveFrontEdge(LOT, undefined)).toBe(0) // most north-facing
    const roles = classifyEdges(LOT, 2)
    expect(roles[2]).toBe('front')
    expect(roles[0]).toBe('rear')
    expect(new Set([roles[1], roles[3]])).toEqual(new Set(['left', 'right']))
    const env = setbackEnvelope(LOT, { front: 6, side: 1.5, rear: 4.5 }, 2)
    expect(env).toHaveLength(4)
    const xs = env.map((p) => p[0])
    const zs = env.map((p) => p[1])
    expect(Math.min(...xs)).toBeCloseTo(-8.5, 6)
    expect(Math.max(...xs)).toBeCloseTo(8.5, 6)
    expect(Math.max(...zs)).toBeCloseTo(9, 6) // the front (south) edge moved in 6 m
    expect(Math.min(...zs)).toBeCloseTo(-10.5, 6) // the rear 4.5 m
    // left / right overrides
    const env2 = setbackEnvelope(LOT, { front: 6, side: 1.5, rear: 4.5, left: 3, right: 1 }, 2)
    expect(Math.max(...env2.map((p) => p[0])) - Math.min(...env2.map((p) => p[0]))).toBeCloseTo(
      20 - 4,
      6,
    )
    // setbacks bigger than the lot: nothing
    expect(setbackEnvelope(LOT, { front: 20, side: 1, rear: 20 }, 2)).toEqual([])
  })
})

describe('the patterned ribbon', () => {
  const ring = new Float32Array([0, 0, 0, 10, 0, 0, 10, 0, 10, 0, 0, 10, 0, 0, 0])

  test('a property line: dashes and dots as flat quads along the ring, nothing off the line', () => {
    const g = buildPatternedRibbon(ring, PROPERTY_LINE_PATTERN, 0.2)
    const pos = g.getAttribute('position')
    expect(pos.count).toBeGreaterThan(20)
    // every vertex within 0.1 m of the ring's edges and on the ground
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const y = pos.getY(i)
      const z = pos.getZ(i)
      expect(y).toBeCloseTo(0, 9)
      const onEdge = Math.min(Math.abs(x), Math.abs(x - 10), Math.abs(z), Math.abs(z - 10))
      expect(onEdge).toBeLessThanOrEqual(0.1 + 1e-6)
    }
    // the pattern leaves gaps: a 40 m perimeter of 6 m periods covers ~ (3 + 0.35 + 0.35) / 6 of the length
    const dashed = buildPatternedRibbon(ring, SETBACK_LINE_PATTERN, 0.1)
    expect(dashed.getAttribute('position').count).toBeGreaterThan(20)
    expect(g.index?.count ?? 0).toBeGreaterThan(0)
  })

  test('degenerate input gives an empty geometry', () => {
    expect(
      buildPatternedRibbon(new Float32Array([0, 0, 0]), PROPERTY_LINE_PATTERN, 0.2).getAttribute(
        'position',
      ),
    ).toBeUndefined()
  })
})

describe('updateRibbonHeights (a sculpt stroke mid-flight)', () => {
  test('every vertex takes the ground under it plus the lift; XZ untouched', () => {
    const ring = new Float32Array([0, 0, 0, 10, 0, 0, 10, 0, 10, 0, 0, 10, 0, 0, 0])
    const g = buildPatternedRibbon(ring, PROPERTY_LINE_PATTERN, 0.2)
    const before = Array.from(g.getAttribute('position').array as Float32Array)
    const field = createTerrainField({ origin: [-5, -5], spacing: 1, cols: 21, rows: 21 })
    const heights = new Int16Array(field.heights)
    for (let row = 0; row < 21; row++)
      for (let col = 0; col < 21; col++) heights[row * 21 + col] = quantize(field, col * 0.1) // rises 0.1 m per metre east
    const sloped = { ...field, heights }
    updateRibbonHeights(g, sloped, 0.05)
    const pos = g.getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getX(i)).toBeCloseTo(before[i * 3]!, 6)
      expect(pos.getZ(i)).toBeCloseTo(before[i * 3 + 2]!, 6)
      expect(pos.getY(i)).toBeCloseTo(surfaceHeightAt(sloped, pos.getX(i), pos.getZ(i)) + 0.05, 5)
    }
    // no field: flat at the lift
    updateRibbonHeights(g, null, 0.02)
    for (let i = 0; i < pos.count; i++) expect(pos.getY(i)).toBeCloseTo(0.02, 6)
  })
})
