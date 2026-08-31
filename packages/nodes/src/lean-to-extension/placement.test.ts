import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  getWallCurveLength,
  LevelNode,
  SlabNode,
  WallNode,
} from '@pascal-app/core'
import { readLeanToCornerJointMetadata } from './corner-joint'
import { resolveLeanToLayout, resolveLeanToWallPlacement } from './layout'
import {
  findLeanToSlabEdgePlacement,
  LEAN_TO_RUN_CONNECT_SNAP_RADIUS,
  LEAN_TO_RUN_MAGNETIC_SNAP_RADIUS,
  nextLeanToCanopyForm,
  nextLeanToPlacementRotation,
  reconcileLeanToSlabEdgePlacement,
  resolveLeanToCommitTarget,
  resolveLeanToFreestandingPlacement,
  resolveLeanToFreestandingRunEndpointSnap,
  resolveLeanToFreestandingRunPlacement,
  resolveLeanToFreestandingRunTarget,
  resolveLeanToPlanPlacement,
  resolveLeanToSlabEdgePlacement,
  resolveLeanToWallPlanTarget,
} from './placement'
import { applyLeanToWallAutoSpan } from './roof-attachment'

describe('lean-to canopy placement', () => {
  test('keeps continuous endpoint connection radius enabled in every snap mode', () => {
    expect(LEAN_TO_RUN_CONNECT_SNAP_RADIUS).toBe(LEAN_TO_RUN_MAGNETIC_SNAP_RADIUS)
    expect(LEAN_TO_RUN_CONNECT_SNAP_RADIUS).toBe(0.5)
  })

  test('places a freestanding canopy on the active level with two supported sides', () => {
    const node = resolveLeanToFreestandingPlacement('level_ground', [4, 6])

    expect(node).toMatchObject({
      parentId: 'level_ground',
      hostKind: 'freestanding',
      highSideMode: 'independent-high-beam',
      connectionMode: 'manual',
      position: [4, 0, 4.625],
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

  test('places the freestanding footprint center at the requested plan point', () => {
    const point: readonly [number, number] = [4, 6]
    const rotationY = Math.PI / 4
    const node = resolveLeanToFreestandingPlacement('level_ground', point, rotationY)
    const { roofCenterX, roofCenterZ } = resolveLeanToLayout(node)
    const cos = Math.cos(rotationY)
    const sin = Math.sin(rotationY)
    const footprintCenter: [number, number] = [
      node.position[0] + roofCenterX * cos + roofCenterZ * sin,
      node.position[2] - roofCenterX * sin + roofCenterZ * cos,
    ]

    expect(footprintCenter[0]).toBeCloseTo(point[0], 6)
    expect(footprintCenter[1]).toBeCloseTo(point[1], 6)
  })

  test('maps R and T to opposite 45 degree placement rotations', () => {
    expect(nextLeanToPlacementRotation(0, 'r')).toBeCloseTo(Math.PI / 4)
    expect(nextLeanToPlacementRotation(0, 't')).toBeCloseTo(-Math.PI / 4)
  })

  test('cycles freestanding placement through mono, gable, and butterfly forms', () => {
    expect(nextLeanToCanopyForm('mono', 'f')).toBe('gable')
    expect(nextLeanToCanopyForm('gable', 'F')).toBe('butterfly')
    expect(nextLeanToCanopyForm('butterfly', 'f')).toBe('mono')
    expect(nextLeanToCanopyForm('gable', 'r')).toBe('gable')

    const target = resolveLeanToPlanPlacement({
      activeLevelId: 'level_ground',
      freestandingPoint: [4, 6],
      freestandingCanopyForm: 'gable',
      nodes: {},
      point: [4, 6],
    })
    expect(target.node).toMatchObject({
      canopyForm: 'gable',
      hostKind: 'freestanding',
      position: [4, 0, 6],
    })

    expect(
      resolveLeanToFreestandingPlacement('level_ground', [4, 6], 0, 'butterfly'),
    ).toMatchObject({
      name: 'Freestanding Butterfly Canopy',
      canopyForm: 'butterfly',
      position: [4, 0, 6],
    })
  })

  test('resolves a continuous freestanding run from its clicked endpoints', () => {
    const node = resolveLeanToFreestandingRunPlacement('level_ground', [1, 2], [5, 5])

    expect(node).not.toBeNull()
    expect(node?.canopyForm).toBe('mono')
    expect(node?.span).toBeCloseTo(5)
    expect(node?.position).toEqual([3, 0, 3.5])
    expect(node?.rotation[1]).toBeCloseTo(-Math.atan2(3, 4))
  })

  test('flips the projection side without changing the continuous run endpoints', () => {
    const normal = resolveLeanToFreestandingRunPlacement('level_ground', [0, 0], [4, 0])
    const flipped = resolveLeanToFreestandingRunPlacement('level_ground', [0, 0], [4, 0], true)

    expect(flipped?.span).toBe(normal?.span)
    expect(flipped?.position).toEqual(normal?.position)
    expect(Math.abs((flipped?.rotation[1] ?? 0) - (normal?.rotation[1] ?? 0))).toBeCloseTo(Math.PI)
  })

  test('rejects a continuous run shorter than the canopy minimum span', () => {
    expect(resolveLeanToFreestandingRunPlacement('level_ground', [0, 0], [0.2, 0])).toBeNull()
  })

  test.each([
    'gable',
    'butterfly',
  ] as const)('keeps the %s canopy form throughout a continuous run', (canopyForm) => {
    const node = resolveLeanToFreestandingRunPlacement(
      'level_ground',
      [0, 0],
      [4, 0],
      false,
      canopyForm,
    )
    const target = resolveLeanToFreestandingRunTarget({
      activeLevelId: 'level_ground',
      canopyForm,
      start: [4, 0],
      end: [4, 4],
      nodes: node ? { [node.id]: node } : {},
    })

    expect(node?.canopyForm).toBe(canopyForm)
    expect(target?.node.canopyForm).toBe(canopyForm)
  })

  test.each([
    'mono',
    'gable',
    'butterfly',
  ] as const)('magnetically closes a continuous %s loop at an exposed endpoint', (canopyForm) => {
    const first = resolveLeanToFreestandingRunPlacement(
      'level_ground',
      [0, 0],
      [4, 0],
      false,
      canopyForm,
    )!
    const second = resolveLeanToFreestandingRunPlacement(
      'level_ground',
      [4, 0],
      [4, 4],
      false,
      canopyForm,
    )!
    const third = resolveLeanToFreestandingRunPlacement(
      'level_ground',
      [4, 4],
      [0, 4],
      false,
      canopyForm,
    )!
    const snap = resolveLeanToFreestandingRunEndpointSnap({
      activeLevelId: 'level_ground',
      canopyForm,
      maxDistance: 0.5,
      nodes: Object.fromEntries([first, second, third].map((node) => [node.id, node])),
      proposedEnd: [0.18, 0.12],
      start: [0, 4],
    })

    expect(snap).toMatchObject({
      nodeId: first.id,
      point: [0, 0],
      side: 'left',
    })
  })

  test('does not magnetize to an occupied, incompatible, or out-of-range endpoint', () => {
    const occupied = {
      ...resolveLeanToFreestandingRunPlacement('level_ground', [0, 0], [4, 0])!,
      leftEndCondition: 'joined' as const,
    }
    const gable = resolveLeanToFreestandingRunPlacement(
      'level_ground',
      [8, 0],
      [12, 0],
      false,
      'gable',
    )!
    const nodes = { [occupied.id]: occupied, [gable.id]: gable }

    expect(
      resolveLeanToFreestandingRunEndpointSnap({
        activeLevelId: 'level_ground',
        nodes,
        proposedEnd: [0.1, 0.1],
        start: [0, 4],
      }),
    ).toBeNull()
    expect(
      resolveLeanToFreestandingRunEndpointSnap({
        activeLevelId: 'level_ground',
        nodes,
        proposedEnd: [8.1, 0.1],
        start: [8, 4],
      }),
    ).toBeNull()
    expect(
      resolveLeanToFreestandingRunEndpointSnap({
        activeLevelId: 'level_ground',
        maxDistance: 0.05,
        nodes: { [occupied.id]: { ...occupied, leftEndCondition: 'open' } },
        proposedEnd: [0.1, 0.1],
        start: [0, 4],
      }),
    ).toBeNull()
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

  test('snaps a ground-plane target near a curved wall before falling back to freestanding', () => {
    const building = BuildingNode.parse({ id: 'building_curved_wall_snap' })
    const wallId = 'wall_curved_snap_target'
    const level = LevelNode.parse({
      id: 'level_curved_wall_snap',
      parentId: building.id,
      level: 0,
      height: 3,
      children: [wallId],
    })
    const wall = WallNode.parse({
      id: wallId,
      parentId: level.id,
      start: [0, 0],
      end: [6, 0],
      curveOffset: 1,
      height: 3,
    })
    const nodes = {
      [building.id]: building,
      [level.id]: level,
      [wall.id]: wall,
    } as Record<string, AnyNode>

    const target = resolveLeanToPlanPlacement({
      activeLevelId: level.id,
      freestandingPoint: [3, -1.1],
      nodes,
      point: [3, -1.1],
    })

    expect(target.valid).toBe(true)
    expect(target.wall?.id).toBe(wall.id)
    expect(target.node).toMatchObject({
      parentId: wall.id,
      hostKind: 'wall',
      highSideMode: 'wall-ledger',
    })
  })

  test('includes a connected curved-wall corner in the wall canopy preview', () => {
    const curvedWall = WallNode.parse({
      id: 'wall_preview_curved_corner',
      parentId: 'level_preview_corner',
      start: [0, 0],
      end: [6, 0],
      curveOffset: -0.5,
    })
    const straightWall = WallNode.parse({
      id: 'wall_preview_straight_corner',
      parentId: 'level_preview_corner',
      start: [6, 0],
      end: [6, -6],
    })
    const existing = {
      ...applyLeanToWallAutoSpan(
        resolveLeanToWallPlacement(curvedWall, getWallCurveLength(curvedWall) / 2, 'front')!,
        curvedWall,
      ),
      id: 'leanto_preview_existing',
    }
    const draft = {
      ...applyLeanToWallAutoSpan(
        resolveLeanToWallPlacement(straightWall, 3, 'front')!,
        straightWall,
      ),
      id: 'leanto_preview_draft',
    }
    const nodes = Object.fromEntries(
      [curvedWall, straightWall, existing].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>

    const target = resolveLeanToWallPlanTarget(straightWall, 3, 'front', nodes)
    const joints = readLeanToCornerJointMetadata(target!.node)

    expect(target?.valid).toBe(true)
    expect(joints.left?.gutterMitre).toBeCloseTo(0.577309, 5)
    expect(joints.left?.seam).toHaveLength(2)
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
