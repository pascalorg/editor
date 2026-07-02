import { describe, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, LevelNode, WallNode } from '@pascal-app/core'
import type { WallHit } from '../../shared/wall-attach-target'
import { resolveCabinetWallFaceOffset, resolveCabinetWallSnapPlacement } from '../wall-snap'

function wallHit(overrides: Partial<WallHit> = {}): WallHit {
  const wall = WallNode.parse({
    id: 'wall_snap-test',
    start: [0, 0],
    end: [2, 0],
    thickness: 0.2,
  })
  return {
    wall,
    localX: 0.73,
    perpDistance: 0.25,
    side: 'front',
    dirX: 1,
    dirY: 0,
    wallLength: 2,
    itemRotation: 0,
    ...overrides,
  }
}

describe('resolveCabinetWallSnapPlacement', () => {
  test('places the cabinet back flush to the selected wall face', () => {
    const placement = resolveCabinetWallSnapPlacement({
      depth: 0.58,
      hit: wallHit(),
      width: 0.6,
    })

    expect(placement).not.toBeNull()
    expect(placement!.position[0]).toBeCloseTo(0.73)
    expect(placement!.position[2]).toBeCloseTo(0.39)
    expect(placement!.yaw).toBeCloseTo(0)
  })

  test('snaps along the wall axis when grid snap is active', () => {
    const placement = resolveCabinetWallSnapPlacement({
      depth: 0.58,
      gridStep: 0.5,
      hit: wallHit(),
      width: 0.6,
    })

    expect(placement).not.toBeNull()
    expect(placement!.localX).toBeCloseTo(0.5)
    expect(placement!.position[0]).toBeCloseTo(0.5)
  })

  test('clamps the cabinet center so its edges stay inside the wall span', () => {
    const placement = resolveCabinetWallSnapPlacement({
      depth: 0.58,
      hit: wallHit({ localX: 1.95 }),
      width: 0.6,
    })

    expect(placement).not.toBeNull()
    expect(placement!.localX).toBeCloseTo(1.7)
    expect(placement!.position[0]).toBeCloseTo(1.7)
  })

  test('snaps cabinet edges to adjacent cabinet edges on the same wall span', () => {
    const placement = resolveCabinetWallSnapPlacement({
      depth: 0.58,
      hit: wallHit({ localX: 1.13 }),
      neighbors: [{ minX: 0.2, maxX: 0.8 }],
      width: 0.6,
    })

    expect(placement).not.toBeNull()
    expect(placement!.localX).toBeCloseTo(1.1)
    expect(placement!.snapReason).toBe('cabinet-edge')
  })

  test('snaps cabinet edges cleanly to wall corners', () => {
    const placement = resolveCabinetWallSnapPlacement({
      depth: 0.58,
      hit: wallHit({ localX: 0.34 }),
      width: 0.6,
    })

    expect(placement).not.toBeNull()
    expect(placement!.localX).toBeCloseTo(0.3)
    expect(placement!.snapReason).toBe('corner')
  })

  test('places the cabinet back against a resolved wall face offset', () => {
    const placement = resolveCabinetWallSnapPlacement({
      depth: 0.58,
      faceOffset: 0.08,
      hit: wallHit(),
      width: 0.6,
    })

    expect(placement).not.toBeNull()
    expect(placement!.position[2]).toBeCloseTo(0.37)
  })

  test('resolves the visible face offset from mitered wall footprint', () => {
    const level = LevelNode.parse({
      id: 'level_wall-snap-test',
      children: ['wall_snap-test', 'wall_snap-cross' as AnyNodeId],
    })
    const wall = WallNode.parse({
      id: 'wall_snap-test',
      parentId: level.id,
      start: [0, 0],
      end: [2, 0],
      thickness: 0.2,
    })
    const crossWall = WallNode.parse({
      id: 'wall_snap-cross',
      parentId: level.id,
      start: [1, -1],
      end: [1, 1],
      thickness: 0.2,
    })
    const nodes = {
      [level.id]: level,
      [wall.id]: wall,
      [crossWall.id]: crossWall,
    } as Record<AnyNodeId, AnyNode>

    const offset = resolveCabinetWallFaceOffset({
      hit: wallHit({ localX: 1, wall }),
      nodes,
      parentLevelId: level.id,
    })

    expect(offset).toBeGreaterThan(0.09)
  })
})
