import { describe, expect, test } from 'bun:test'
import { castYardDimensions, castYardDimensionsOriented, type Pt } from './geometry'

// 20 m × 30 m lot centred on the origin, y south
const LOT: Pt[] = [
  [-10, -15],
  [10, -15],
  [10, 15],
  [-10, 15],
]
const box = (w: number, d: number, cx: number, cz: number, yaw: number): Pt[] => {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  const corners: Pt[] = [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ]
  return corners.map(([lx, lz]) => [cx + c * lx + s * lz, cz - s * lx + c * lz])
}
const by = (yards: ReturnType<typeof castYardDimensions>) =>
  Object.fromEntries(yards.map((y) => [y.side, Math.round(y.distance * 1000) / 1000]))

describe('castYardDimensionsOriented', () => {
  test('with no rotation it is the axis-aligned cast', () => {
    const house = box(8, 10, 0, -2, 0)
    const oriented = castYardDimensionsOriented(LOT, [house], 0)
    const bbox = castYardDimensions(LOT, { minX: -4, minY: -7, maxX: 4, maxY: 3 })
    expect(by(oriented)).toEqual(by(bbox))
    expect(by(oriented)).toEqual({ north: 8, south: 12, west: 6, east: 6 })
  })

  test('a house turned 90° measures square to its own faces', () => {
    // 8 wide × 10 deep, turned a quarter: its 10 m side now runs east-west
    const house = box(8, 10, 0, -2, Math.PI / 2)
    const yards = by(castYardDimensionsOriented(LOT, [house], Math.PI / 2))
    expect(yards).toEqual({ north: 9, south: 13, west: 5, east: 5 })
  })

  test('a house on a diagonal reads its true yards, not the bbox ones', () => {
    // a 10 × 10 house turned 45° at the origin: its corners reach 7.07 m out,
    // its faces 5 m — the axis-aligned bbox would put the north yard at 7.93
    const house = box(10, 10, 0, 0, Math.PI / 4)
    const oriented = castYardDimensionsOriented(LOT, [house], Math.PI / 4)
    for (const y of oriented) {
      // each face midpoint sits 5 m from the centre; the ray runs diagonally to the lot line
      const fromDist = Math.hypot(y.from[0], y.from[1])
      expect(fromDist).toBeCloseTo(5, 9)
    }
    const bbox = castYardDimensions(LOT, { minX: -7.071, minY: -7.071, maxX: 7.071, maxY: 7.071 })
    expect(by(bbox).north).toBeCloseTo(7.929, 3)
    expect(oriented.length).toBe(4)
  })

  test('no footprint, no yards', () => {
    expect(castYardDimensionsOriented(LOT, [], 0.3)).toEqual([])
    expect(
      castYardDimensionsOriented(
        [
          [0, 0],
          [1, 0],
        ],
        [box(1, 1, 0, 0, 0)],
        0,
      ),
    ).toEqual([])
  })
})
