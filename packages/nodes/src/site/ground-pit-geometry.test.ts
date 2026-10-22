import { expect, test } from 'bun:test'
import { buildPitWalls, PIT_WALL_ROWS, type PitContourSource } from './ground-pit-geometry'

// The pit's walls are the hole's threshold walked on a grid: every piece of the contour becomes a
// wall facing into the hole, carrying a drop (0 at grade, 1 at its foot) the shader scales.

function disc(radius: number, extra: Partial<PitContourSource> = {}): PitContourSource {
  return {
    originX: -12,
    originZ: -12,
    span: 24,
    distanceAt: (x, z) => Math.hypot(x, z) - 4,
    radiusAt: () => radius,
    topAt: () => -0.05,
    radiusMin: 1,
    radiusMax: 3,
    ...extra,
  }
}

// A segment is `PIT_WALL_ROWS + 1` pairs of vertices (a, b), top to foot.
const STRIDE = (PIT_WALL_ROWS * 2 + 2) * 3
const quads = (walls: NonNullable<ReturnType<typeof buildPitWalls>>) =>
  walls.positions.length / STRIDE

test('the walls stand on the threshold: a ring at footprint plus radius', () => {
  const walls = buildPitWalls(disc(2))!
  expect(quads(walls)).toBeGreaterThan(100)
  for (let i = 0; i < walls.positions.length; i += STRIDE) {
    const x = walls.positions[i]!
    const z = walls.positions[i + 2]!
    expect(Math.hypot(x, z)).toBeCloseTo(6, 2)
  }
})

test('every wall faces into the hole, by its normal and by its winding', () => {
  const walls = buildPitWalls(disc(2))!
  for (let i = 0; i < walls.positions.length; i += STRIDE) {
    const [ax, az] = [walls.positions[i]!, walls.positions[i + 2]!]
    const [bx, bz] = [walls.positions[i + 3]!, walls.positions[i + 5]!]
    const [mx, mz] = [(ax + bx) / 2, (az + bz) / 2]
    const [nx, nz] = [walls.normals[i]!, walls.normals[i + 2]!]
    expect(nx * -mx + nz * -mz).toBeGreaterThan(0)
    // Front face: the triangle (top a, top b, foot b) has the geometric normal (dz, 0, -dx).
    expect((bz - az) * nx - (bx - ax) * nz).toBeGreaterThan(0)
  }
})

test('a wall hangs from grade: the top vertices at the ground, the foot ones dropping by 1', () => {
  const walls = buildPitWalls(disc(2, { topAt: (x) => 1 + x * 0.1 }))!
  const pairs = PIT_WALL_ROWS + 1
  for (let at = 0; at < walls.positions.length / 3; at += pairs * 2) {
    for (let row = 0; row < pairs; row += 1) {
      expect([...walls.drops.slice(at + row * 2, at + row * 2 + 2)]).toEqual([
        row / PIT_WALL_ROWS,
        row / PIT_WALL_ROWS,
      ])
      // Every row sits at grade: the shader lowers it by its drop.
      expect(walls.positions[(at + row * 2) * 3 + 1]).toBeCloseTo(walls.positions[at * 3 + 1]!, 6)
    }
    const x = walls.positions[at * 3]!
    expect(walls.positions[at * 3 + 1]).toBeCloseTo(1 + x * 0.1, 4)
  }
})

test('every row of a wall shares the contour: the rows differ only by their drop', () => {
  const walls = buildPitWalls(disc(2))!
  for (let i = 0; i < walls.positions.length; i += STRIDE) {
    for (let row = 1; row <= PIT_WALL_ROWS; row += 1) {
      for (let k = 0; k < 6; k += 1) {
        expect(walls.positions[i + row * 6 + k]).toBe(walls.positions[i + k])
        expect(walls.normals[i + row * 6 + k]).toBe(walls.normals[i + k])
      }
    }
  }
})

test('an island of ground inside the hole is walled on its far side too, facing the hole', () => {
  // The hole is everything within 8 m of the origin except a 2 m rock in the middle.
  const walls = buildPitWalls({
    ...disc(0),
    distanceAt: (x, z) => {
      const rock = 2 - Math.hypot(x, z)
      return Math.max(rock, Math.hypot(x, z) - 8)
    },
    radiusAt: () => 0,
    radiusMin: -1,
    radiusMax: 1,
  })!
  let rock = 0
  for (let i = 0; i < walls.positions.length; i += STRIDE) {
    const mx = (walls.positions[i]! + walls.positions[i + 3]!) / 2
    const mz = (walls.positions[i + 2]! + walls.positions[i + 5]!) / 2
    if (Math.hypot(mx, mz) < 3) {
      rock += 1
      expect(walls.normals[i]! * mx + walls.normals[i + 2]! * mz).toBeGreaterThan(0)
    }
  }
  expect(rock).toBeGreaterThan(30)
})

test('no hole, no walls', () => {
  expect(buildPitWalls(disc(2, { distanceAt: () => 50, radiusMin: 1, radiusMax: 3 }))).toBeNull()
})

test('far from the radius’s range nothing is looked up: the noise is asked near the contour only', () => {
  let asked = 0
  buildPitWalls(
    disc(2, {
      radiusAt: () => {
        asked += 1
        return 2
      },
    }),
  )
  // The grid is 200 × 200 cells; the band within the range of 4 + [1, 3] is a small share of it.
  expect(asked).toBeLessThan(200 * 200 * 0.35)
})
