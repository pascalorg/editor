import { describe, expect, test } from 'bun:test'
import { type AnyNodeId, type WallNode, WallNode as WallSchema } from '@pascal-app/core'
import {
  findWallExtensionSnap,
  WALL_EXTENSION_MAX_REACH,
  type WallPlanPoint,
} from './wall-snap-geometry'

const LEVEL_ID = 'level_test' as AnyNodeId

function makeWall(start: WallPlanPoint, end: WallPlanPoint, id: string): WallNode {
  return {
    ...WallSchema.parse({ start, end, name: id }),
    id: id as WallNode['id'],
    parentId: LEVEL_ID,
  }
}

describe('findWallExtensionSnap', () => {
  test('catches a point on the continuation past an endpoint', () => {
    const wall = makeWall([0, 0], [4, 0], 'wall_w')
    const hit = findWallExtensionSnap([6, 0.1], [wall])
    expect(hit).not.toBeNull()
    expect(hit?.point[0]).toBeCloseTo(6, 6)
    expect(hit?.point[1]).toBeCloseTo(0, 6)
    expect(hit?.wallId).toBe('wall_w')
  })

  test('works on the far side too', () => {
    const wall = makeWall([0, 0], [4, 0], 'wall_w')
    const hit = findWallExtensionSnap([-2, 0.1], [wall])
    expect(hit?.point[0]).toBeCloseTo(-2, 6)
  })

  test('holds a diagonal collinear — the case X/Z guides structurally cannot', () => {
    const wall = makeWall([0, 0], [3, 3], 'wall_w')
    // Just off the 45° line, past the end.
    const hit = findWallExtensionSnap([5.1, 4.9], [wall])
    expect(hit).not.toBeNull()
    const [x, z] = hit?.point as WallPlanPoint
    expect(x).toBeCloseTo(z, 6)
  })

  test('stays out of the segment interior — that is the body snap job', () => {
    const wall = makeWall([0, 0], [4, 0], 'wall_w')
    expect(findWallExtensionSnap([2, 0.05], [wall])).toBeNull()
  })

  test('does not reach across the whole site', () => {
    const wall = makeWall([0, 0], [4, 0], 'wall_w')
    const beyond = 4 + WALL_EXTENSION_MAX_REACH + 1
    expect(findWallExtensionSnap([beyond, 0], [wall])).toBeNull()
  })

  test('ignores a point too far off the line', () => {
    const wall = makeWall([0, 0], [4, 0], 'wall_w')
    expect(findWallExtensionSnap([6, 3], [wall])).toBeNull()
  })

  test('honours ignoreWallIds so a wall never extends itself', () => {
    const wall = makeWall([0, 0], [4, 0], 'wall_w')
    expect(findWallExtensionSnap([6, 0.1], [wall], { ignoreWallIds: ['wall_w'] })).toBeNull()
  })

  test('picks the nearest line when two could claim the point', () => {
    const near = makeWall([0, 0], [4, 0], 'wall_near')
    const far = makeWall([0, 0.3], [4, 0.3], 'wall_far')
    const hit = findWallExtensionSnap([6, 0.02], [near, far])
    expect(hit?.wallId).toBe('wall_near')
  })

  test('a curved wall has no single line to continue', () => {
    const curved = { ...makeWall([0, 0], [4, 0], 'wall_c'), curveOffset: 1.5 } as WallNode
    expect(findWallExtensionSnap([6, 0.1], [curved])).toBeNull()
  })
})
