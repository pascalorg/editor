import { describe, expect, test } from 'bun:test'
import { moveNode } from '../agent-operations/move-node'
import { isAgentRefusal } from '../agent-tools/refusal'
import { type AnyNode, DoorNode, LevelNode, WallNode, WindowNode } from '../schema'
import { getWallTopOver } from '../services/storey'
import {
  getWallChordFractionAt,
  getWallCurveLength,
  getWallStationAtChordFraction,
} from '../systems/wall/wall-curve'
import { clampDoorToWall, clampWindowToWall, planWallOpening } from './wall-openings'

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

describe('a flat wall places openings as it did before tops could slope', () => {
  test('an opening taller than a 1 m wall still fits and clamps', () => {
    const { wall, nodes } = scene({ height: 1 })
    expect(clampWindowToWall(wall, 2, 0.5, 1, 1.2, nodes)).toEqual({
      clampedX: 2,
      clampedY: 0.6,
      fits: true,
    })
    expect(clampDoorToWall(wall, 2, 0.9, 2.1, undefined, nodes)).toEqual({
      clampedX: 2,
      clampedY: 1.05,
      fits: true,
    })
  })

  test('an opening wider than the wall still fits, pinned to the start', () => {
    const { wall, nodes } = scene({})
    expect(clampWindowToWall(wall, 3, 1, 5, 1, nodes)).toMatchObject({ clampedX: 2.5, fits: true })
  })

  test('a sloped wall too low everywhere does not fit', () => {
    const { wall, nodes } = scene({ height: 1, endHeightOffset: 0.1 })
    expect(clampWindowToWall(wall, 2, 0.5, 1, 1.2, nodes).fits).toBe(false)
    expect(clampDoorToWall(wall, 2, 0.9, 2.1, undefined, nodes).fits).toBe(false)
  })
})

describe('agents refuse an opening no stretch of a sloped wall can take', () => {
  // 2.5 m at the start falling to 1 m at the end; a flat 2.5 m wall is the control.
  const sloped = { endHeightOffset: -1.5 }
  const refusal = (run: () => unknown) => {
    try {
      run()
    } catch (error) {
      if (isAgentRefusal(error)) return error.code
      throw error
    }
    return null
  }
  const withOpening = (wall: Partial<WallNode>, opening: DoorNode | WindowNode) => {
    const { nodes } = scene({ ...wall, children: [opening.id] })
    return { ...nodes, [opening.id]: opening } as Record<string, AnyNode>
  }
  const window = (height: number) =>
    WindowNode.parse({
      id: 'window_slope',
      parentId: 'wall_slope',
      wallId: 'wall_slope',
      position: [1, 1.2, 0],
      width: 1.2,
      height,
    })
  const door = DoorNode.parse({
    id: 'door_slope',
    parentId: 'wall_slope',
    wallId: 'wall_slope',
    position: [0.6, 1.2, 0],
    width: 0.9,
    height: 2.4,
  })
  const move = (nodes: Record<string, AnyNode>, id: string) =>
    moveNode(nodes as never, { id, by: [0.1, 0] } as never, { activeLevelId: null })

  test('placing a window', () => {
    const tall = { kind: 'window', wallId: 'wall_slope', t: 0.2, width: 1.2, height: 2.4 } as const
    expect(refusal(() => planWallOpening(scene(sloped).nodes as never, tall))).toBe('wall_too_low')
    expect(refusal(() => planWallOpening(scene({}).nodes as never, tall))).toBeNull()
    // One that fits only near the high end slides there instead.
    const planned = planWallOpening(scene(sloped).nodes as never, { ...tall, t: 0.9, height: 1.5 })
    expect(planned.clamped).toBe(true)
  })

  test('placing a door', () => {
    const tall = { kind: 'door', wallId: 'wall_slope', t: 0.15, width: 0.9, height: 2.4 } as const
    expect(refusal(() => planWallOpening(scene(sloped).nodes as never, tall))).toBe('wall_too_low')
    expect(refusal(() => planWallOpening(scene({}).nodes as never, tall))).toBeNull()
  })

  test('moving a window or a door', () => {
    expect(refusal(() => move(withOpening(sloped, window(2.4)), 'window_slope'))).toBe(
      'wall_too_low',
    )
    expect(refusal(() => move(withOpening({}, window(2.4)), 'window_slope'))).toBeNull()
    expect(refusal(() => move(withOpening(sloped, door), 'door_slope'))).toBe('wall_too_low')
    expect(refusal(() => move(withOpening({}, door), 'door_slope'))).toBeNull()
  })
})
