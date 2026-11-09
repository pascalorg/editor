import { describe, expect, test } from 'bun:test'
import { type AnyNode, LevelNode, WallNode } from '../schema'
import { getWallTopOver } from '../services/storey'
import {
  getWallChordFractionAt,
  getWallCurveLength,
  getWallStationAtChordFraction,
} from '../systems/wall/wall-curve'
import { clampWindowToWall } from './wall-openings'

function scene(wall: Partial<WallNode>) {
  const node = WallNode.parse({
    id: 'wall_slope',
    parentId: 'level_slope',
    start: [0, 0],
    end: [4, 0],
    height: 2.5,
    ...wall,
  })
  const level = LevelNode.parse({ id: 'level_slope', children: [node.id] })
  return { wall: node, nodes: { [level.id]: level, [node.id]: node } as Record<string, AnyNode> }
}

// A semicircle on a 4 m chord: radius 2, so station s sits at angle s / 2 and projects onto the
// chord at (1 - cos(s / 2)) / 2, far from s / 4.
const semicircle = { curveOffset: 2 }

describe('a sloped top on a curved wall runs along the chord', () => {
  test('arc-length stations map to the chord fraction the viewer slopes by, and back', () => {
    const { wall } = scene(semicircle)
    const length = getWallCurveLength(wall)
    expect(getWallChordFractionAt(wall, length / 2)).toBeCloseTo(0.5, 6)
    expect(getWallChordFractionAt(wall, length / 4)).toBeCloseTo((1 - Math.cos(Math.PI / 4)) / 2, 3)
    expect(getWallStationAtChordFraction(wall, 0.25)).toBeCloseTo(
      (length / Math.PI) * (Math.PI / 3),
      4,
    )
    expect(getWallChordFractionAt(wall, getWallStationAtChordFraction(wall, 0.8))).toBeCloseTo(
      0.8,
      6,
    )
  })

  test('the top over a span reads the chord position of its ends', () => {
    const { wall, nodes } = scene({ ...semicircle, endHeightOffset: -1.5 })
    const length = getWallCurveLength(wall)
    // The arc midpoint is the chord midpoint: halfway down the slope, though s / chord would say 0.79.
    expect(getWallTopOver(wall, 'level_slope', nodes, 0, 0, length / 2)).toBeCloseTo(1.75, 3)
  })

  test('a window slides to where the curved, sloped top still clears it', () => {
    const { wall, nodes } = scene({ ...semicircle, endHeightOffset: -1.5 })
    // 2.5 m falling to 1 m: 1.5 m of clearance ends at chord fraction 2/3, angle acos(-1/3).
    const limit = (getWallCurveLength(wall) / Math.PI) * Math.acos(-1 / 3)
    const placed = clampWindowToWall(wall, 100, 0.75, 1, 1.5, nodes)
    expect(placed.fits).toBe(true)
    expect(placed.clampedX).toBeCloseTo(limit - 0.5, 4)
  })
})
