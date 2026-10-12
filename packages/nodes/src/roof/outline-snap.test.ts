import { describe, expect, test } from 'bun:test'
import { WallNode } from '@pascal-app/core'
import { buildingOutlines, snapToBuildingOutline, squareFromFace } from './outline-snap'

const wall = (start: [number, number], end: [number, number]) =>
  WallNode.parse({ type: 'wall', start, end, thickness: 0.2 })

/** A 10 × 6 box of walls (axes on its edges) with one partition across it. */
const walls = [
  wall([0, 0], [10, 0]),
  wall([10, 0], [10, 6]),
  wall([10, 6], [0, 6]),
  wall([0, 6], [0, 0]),
  wall([5, 0], [5, 6]),
]

describe('building outline snap', () => {
  test('the outline is the outer faces of the walls, partitions excluded', () => {
    const rings = buildingOutlines(walls)
    expect(rings.length).toBe(1)
    const xs = rings[0]!.map((point) => point[0])
    const zs = rings[0]!.map((point) => point[1])
    expect(Math.min(...xs)).toBeCloseTo(-0.1, 6)
    expect(Math.max(...xs)).toBeCloseTo(10.1, 6)
    expect(Math.min(...zs)).toBeCloseTo(-0.1, 6)
    expect(Math.max(...zs)).toBeCloseTo(6.1, 6)
    expect(rings[0]!.some(([x]) => Math.abs(x - 5) < 0.2)).toBe(false)
  })

  test('a point near a corner takes the corner, near a face lands on it, far away is left', () => {
    const rings = buildingOutlines(walls)
    const corner = snapToBuildingOutline([0.3, 0.2], rings)!
    expect(corner.point[0]).toBeCloseTo(-0.1, 6)
    expect(corner.point[1]).toBeCloseTo(-0.1, 6)
    expect(corner.face).toBeNull()
    const face = snapToBuildingOutline([4, 0.2], rings)!
    expect(face.point[0]).toBeCloseTo(4, 6)
    expect(face.point[1]).toBeCloseTo(-0.1, 6)
    expect(face.face).not.toBeNull()
    expect(snapToBuildingOutline([4, 3], rings)).toBeNull()
  })

  test('leaving a wall mid-face, the line goes square across to the opposite face', () => {
    const rings = buildingOutlines(walls)
    const start = snapToBuildingOutline([4, 0.2], rings)!
    // The cursor drifts sideways by 0.6 m near the far wall: the point stays square.
    const across = squareFromFace(start.point, start.face!, [4.6, 5.9], rings)!
    expect(across.point[0]).toBeCloseTo(4, 6)
    expect(across.point[1]).toBeCloseTo(6.1, 6)
    expect(across.face).not.toBeNull()
    // Half way across, the point still sits on the square line.
    const middle = squareFromFace(start.point, start.face!, [4.5, 3], rings)!
    expect(middle.point[0]).toBeCloseTo(4, 6)
    expect(middle.face).toBeNull()
    // Heading along the wall, the square lock lets go.
    expect(squareFromFace(start.point, start.face!, [8, 0.5], rings)).toBeNull()
  })
})
