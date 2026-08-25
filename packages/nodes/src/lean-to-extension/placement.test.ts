import { describe, expect, test } from 'bun:test'
import { type AnyNode, BuildingNode, LevelNode, SlabNode, WallNode } from '@pascal-app/core'
import {
  findLeanToSlabEdgePlacement,
  nextLeanToPlacementRotation,
  reconcileLeanToSlabEdgePlacement,
  resolveLeanToCommitTarget,
  resolveLeanToFreestandingPlacement,
  resolveLeanToPlanPlacement,
  resolveLeanToSlabEdgePlacement,
} from './placement'

describe('lean-to canopy placement', () => {
  test('places a freestanding canopy on the active level with two supported sides', () => {
    const node = resolveLeanToFreestandingPlacement('level_ground', [4, 6])

    expect(node).toMatchObject({
      parentId: 'level_ground',
      hostKind: 'freestanding',
      highSideMode: 'independent-high-beam',
      connectionMode: 'manual',
      position: [4, 0, 6],
      rotation: [0, 0, 0],
    })
    expect(node.hostRoofId).toBeUndefined()
  })

  test('keeps the requested rotation for a freestanding placement target', () => {
    const target = resolveLeanToPlanPlacement({
      activeLevelId: 'level_ground',
      freestandingPoint: [4, 6],
      freestandingRotationY: Math.PI / 4,
      nodes: {},
      point: [4, 6],
    })

    expect(target.node).toMatchObject({
      hostKind: 'freestanding',
      rotation: [0, Math.PI / 4, 0],
    })
  })

  test('maps R and T to opposite 45 degree placement rotations', () => {
    expect(nextLeanToPlacementRotation(0, 'r')).toBeCloseTo(Math.PI / 4)
    expect(nextLeanToPlacementRotation(0, 't')).toBeCloseTo(-Math.PI / 4)
  })

  test('commits the visible ghost when the click ray resolves a different target', () => {
    const visibleWallTarget = { kind: 'wall', span: 9 }
    const clickRayTarget = { kind: 'freestanding', span: 4 }

    expect(resolveLeanToCommitTarget(visibleWallTarget, clickRayTarget)).toBe(visibleWallTarget)
  })

  test('snaps a ground-plane target near a wall before falling back to freestanding', () => {
    const building = BuildingNode.parse({ id: 'building_wall_snap' })
    const wallId = 'wall_snap_target'
    const level = LevelNode.parse({
      id: 'level_wall_snap',
      parentId: building.id,
      level: 0,
      height: 3,
      children: [wallId],
    })
    const wall = WallNode.parse({
      id: wallId,
      parentId: level.id,
      start: [0, 0],
      end: [8, 0],
      height: 3,
    })
    const nodes = {
      [building.id]: building,
      [level.id]: level,
      [wall.id]: wall,
    } as Record<string, AnyNode>

    const target = resolveLeanToPlanPlacement({
      activeLevelId: level.id,
      freestandingPoint: [3, 0],
      nodes,
      point: [3, 0.2],
    })

    expect(target.valid).toBe(true)
    expect(target.wall?.id).toBe(wall.id)
    expect(target.node).toMatchObject({
      parentId: wall.id,
      hostKind: 'wall',
      highSideMode: 'wall-ledger',
    })
  })

  test('attaches the high edge to an upper slab and keeps posts on the front edge', () => {
    const building = BuildingNode.parse({ id: 'building_home' })
    const ground = LevelNode.parse({
      id: 'level_ground',
      parentId: building.id,
      level: 0,
      height: 3,
    })
    const first = LevelNode.parse({
      id: 'level_first',
      parentId: building.id,
      level: 1,
      height: 3,
    })
    const slab = SlabNode.parse({
      id: 'slab_first_floor',
      parentId: first.id,
      polygon: [
        [0, 0],
        [6, 0],
        [6, 4],
        [0, 4],
      ],
      elevation: 0.05,
      thickness: 0.2,
    })
    const nodes = {
      [building.id]: building,
      [ground.id]: ground,
      [first.id]: first,
      [slab.id]: slab,
    } as Record<string, AnyNode>

    const node = resolveLeanToSlabEdgePlacement({
      activeLevelId: ground.id,
      edgeIndex: 0,
      edgeT: 0.5,
      nodes,
      slab,
    })

    expect(node).toMatchObject({
      parentId: ground.id,
      hostKind: 'slab-edge',
      hostSlabId: slab.id,
      hostSlabEdgeIndex: 0,
      hostSlabEdgeT: 0.5,
      highSideMode: 'wall-ledger',
      connectionMode: 'manual',
      position: [3, 0, 0],
      rotation: [0, Math.PI, 0],
      span: 5.9,
    })
    expect(node?.highEdgeHeight).toBeCloseTo(2.85, 6)
    expect(node?.hostRoofId).toBeUndefined()
  })

  test('finds the nearest eligible upper slab edge from a plan point', () => {
    const building = BuildingNode.parse({ id: 'building_edge_search' })
    const ground = LevelNode.parse({
      id: 'level_edge_search_ground',
      parentId: building.id,
      level: 0,
      height: 3,
    })
    const first = LevelNode.parse({
      id: 'level_edge_search_first',
      parentId: building.id,
      level: 1,
      height: 3,
    })
    const slab = SlabNode.parse({
      id: 'slab_edge_search',
      parentId: first.id,
      polygon: [
        [0, 0],
        [6, 0],
        [6, 4],
        [0, 4],
      ],
      elevation: 0.05,
      thickness: 0.2,
    })
    const nodes = {
      [building.id]: building,
      [ground.id]: ground,
      [first.id]: first,
      [slab.id]: slab,
    } as Record<string, AnyNode>

    const node = findLeanToSlabEdgePlacement([5.9, 2], nodes, ground.id)

    expect(node).toMatchObject({
      hostSlabId: slab.id,
      hostSlabEdgeIndex: 1,
      hostSlabEdgeT: 0.5,
      position: [6, 0, 2],
      rotation: [0, Math.PI / 2, 0],
      span: 3.9,
    })
  })

  test('keeps a slab-attached canopy aligned when its host slab changes', () => {
    const building = BuildingNode.parse({ id: 'building_slab_tracking' })
    const ground = LevelNode.parse({
      id: 'level_slab_tracking_ground',
      parentId: building.id,
      level: 0,
      height: 3,
    })
    const first = LevelNode.parse({
      id: 'level_slab_tracking_first',
      parentId: building.id,
      level: 1,
      height: 3,
    })
    const originalSlab = SlabNode.parse({
      id: 'slab_tracking',
      parentId: first.id,
      polygon: [
        [0, 0],
        [6, 0],
        [6, 4],
        [0, 4],
      ],
      elevation: 0.05,
      thickness: 0.2,
    })
    const originalNodes = {
      [building.id]: building,
      [ground.id]: ground,
      [first.id]: first,
      [originalSlab.id]: originalSlab,
    } as Record<string, AnyNode>
    const canopy = resolveLeanToSlabEdgePlacement({
      activeLevelId: ground.id,
      edgeIndex: 0,
      edgeT: 0.5,
      nodes: originalNodes,
      slab: originalSlab,
    })!
    const changedSlab = {
      ...originalSlab,
      polygon: [
        [0, 0],
        [8, 0],
        [8, 4],
        [0, 4],
      ] as [number, number][],
      elevation: 0.15,
    }
    const changedNodes = {
      ...originalNodes,
      [changedSlab.id]: changedSlab,
      [canopy.id]: canopy,
    } as Record<string, AnyNode>

    const reconciled = reconcileLeanToSlabEdgePlacement(canopy, changedNodes)

    expect(reconciled).toMatchObject({
      position: [4, 0, 0],
      span: 7.9,
      rotation: [0, Math.PI, 0],
    })
    expect(reconciled.highEdgeHeight).toBeCloseTo(2.95, 6)
  })
})
