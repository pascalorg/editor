import { describe, expect, test } from 'bun:test'
import { RockNode } from '../schema'
import { ROCK_RINGS, rockRings, rockSection } from './rock-shape'

type Point = [number, number]

const outline: Point[] = [
  [0, 0],
  [6, 0],
  [6, 4],
  [0, 4],
]
const rock = (extra: Partial<RockNode> = {}) =>
  RockNode.parse({ polygon: outline, height: 3, seed: 7, ...extra })

const area = (ring: Point[]) =>
  Math.abs(
    ring.reduce((sum, [x, z], i) => {
      const [nx, nz] = ring[(i + 1) % ring.length] as Point
      return sum + x * nz - nx * z
    }, 0) / 2,
  )

const insideRectangle = ([x, z]: Point, slack = 1e-9) =>
  x >= -slack && x <= 6 + slack && z >= -slack && z <= 4 + slack

describe('a rock’s shape from its outline and seed', () => {
  test('stands on its outline: the base ring covers exactly the outline’s area, corners included', () => {
    const [base] = rockRings(rock())

    expect(area(base as Point[])).toBeCloseTo(24, 6)
    for (const corner of outline)
      expect(
        (base as Point[]).some(([x, z]) => Math.hypot(x - corner[0], z - corner[1]) < 1e-9),
      ).toBe(true)
  })

  test('never spreads past its outline', () => {
    for (const seed of [1, 2, 3, 99])
      for (const ring of rockRings(rock({ seed })))
        for (const point of ring) expect(insideRectangle(point)).toBe(true)
  })

  test('narrows toward its top', () => {
    const rings = rockRings(rock())

    expect(rings).toHaveLength(ROCK_RINGS + 1)
    expect(area(rings.at(-1) as Point[])).toBeLessThan(area(rings[0] as Point[]) * 0.4)
  })

  test('is the same rock for the same seed and another for another', () => {
    const same = rockRings(rock({ seed: 5 }))
    const again = rockRings(rock({ seed: 5 }))
    const other = rockRings(rock({ seed: 6 }))

    expect(again).toEqual(same)
    expect(other).not.toEqual(same)
  })

  test('rings have the same number of points, so the mesh can join them', () => {
    const counts = new Set(rockRings(rock()).map((ring) => ring.length))

    expect(counts.size).toBe(1)
  })

  test('a weathered rock changes less between neighbouring points than a faceted one', () => {
    const roughness = (form: 'faceted' | 'weathered') => {
      const ring = rockRings(rock({ form, seed: 3 }))[ROCK_RINGS / 2] as Point[]
      const [cx, cz] = [3, 2]
      const radii = ring.map(([x, z]) => Math.hypot(x - cx, z - cz))
      return radii.reduce(
        (sum, radius, i) => sum + Math.abs(radius - (radii[(i + 1) % radii.length] as number)),
        0,
      )
    }

    expect(roughness('weathered')).toBeLessThan(roughness('faceted'))
  })
})

describe('a rock’s cross-section at a height', () => {
  test('at the foot it is the base ring, and above the top there is none', () => {
    const shape = rock()

    expect(rockSection(shape, 0)).toEqual(rockRings(shape)[0])
    expect(rockSection(shape, 1.0001)).toBeNull()
    expect(rockSection(shape, -0.0001)).toBeNull()
  })

  test('is smaller the higher it is taken', () => {
    const shape = rock()

    const low = area(rockSection(shape, 0.2) as Point[])
    const high = area(rockSection(shape, 0.8) as Point[])

    expect(high).toBeLessThan(low)
  })

  test('between two rings lies between them', () => {
    const shape = rock()
    const rings = rockRings(shape)
    const between = rockSection(shape, 0.55) as Point[]

    const [lower, upper] = [area(rings[5] as Point[]), area(rings[6] as Point[])]
    expect(area(between)).toBeLessThanOrEqual(Math.max(lower, upper) + 1e-9)
    expect(area(between)).toBeGreaterThanOrEqual(Math.min(lower, upper) - 1e-9)
  })
})
