import { describe, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, LevelNode, WallNode } from '@pascal-app/core'
import type { WallHit } from '../../shared/wall-attach-target'
import { CabinetModuleNode, CabinetNode } from '../schema'
import {
  collectCabinetWallSnapNeighbors,
  resolveCabinetModuleWallSnapLocal,
  resolveCabinetRunWallSnap,
  resolveCabinetWallFaceOffset,
  resolveCabinetWallSnapPlacement,
} from '../wall-snap'

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

/**
 * L-corner fixture: wall A runs (0,0)→(2,0), wall B joins at (2,0) and runs
 * to (2,2) — into wall A's front (+plan-y) side. Both 0.2 m thick.
 */
function cornerFixture() {
  const level = LevelNode.parse({
    id: 'level_corner',
    children: ['wall_corner-a', 'wall_corner-b' as AnyNodeId],
  })
  const wallA = WallNode.parse({
    id: 'wall_corner-a',
    parentId: level.id,
    start: [0, 0],
    end: [2, 0],
    thickness: 0.2,
  })
  const wallB = WallNode.parse({
    id: 'wall_corner-b',
    parentId: level.id,
    start: [2, 0],
    end: [2, 2],
    thickness: 0.2,
  })
  const nodes = {
    [level.id]: level,
    [wallA.id]: wallA,
    [wallB.id]: wallB,
  } as Record<AnyNodeId, AnyNode>
  return { level, wallA, wallB, nodes }
}

describe('resolveCabinetWallFaceOffset', () => {
  test('resolves half the wall thickness on a straight wall face, signed by side', () => {
    const level = LevelNode.parse({
      id: 'level_straight',
      children: ['wall_snap-test' as AnyNodeId],
    })
    const wall = WallNode.parse({
      id: 'wall_snap-test',
      parentId: level.id,
      start: [0, 0],
      end: [2, 0],
      thickness: 0.2,
    })
    const nodes = { [level.id]: level, [wall.id]: wall } as Record<AnyNodeId, AnyNode>

    const front = resolveCabinetWallFaceOffset({
      hit: wallHit({ wall }),
      nodes,
      parentLevelId: level.id,
    })
    const back = resolveCabinetWallFaceOffset({
      hit: wallHit({ wall, side: 'back' }),
      nodes,
      parentLevelId: level.id,
    })

    expect(front).toBeCloseTo(0.1)
    expect(back).toBeCloseTo(-0.1)
  })

  test('follows the miter diagonal on the joined face of an L-corner', () => {
    const { level, wallA, nodes } = cornerFixture()
    const offsetAt = (localX: number, side: WallHit['side'] = 'front') =>
      resolveCabinetWallFaceOffset({
        hit: wallHit({ wall: wallA, localX, side }),
        nodes,
        parentLevelId: level.id,
      })

    // Away from the junction the front face is the plain half-thickness.
    expect(offsetAt(0.5)).toBeCloseTo(0.1)
    // The miter cuts the front face back linearly toward the corner point.
    expect(offsetAt(1.95)).toBeCloseTo(0.05)
    expect(offsetAt(2)).toBeCloseTo(0)
    // The back face is untouched by a front-side junction.
    expect(offsetAt(1.95, 'back')).toBeCloseTo(-0.1)
  })

  test('falls back to half the wall thickness when the ray misses the footprint', () => {
    const { level, wallA, nodes } = cornerFixture()

    const front = resolveCabinetWallFaceOffset({
      hit: wallHit({ wall: wallA, localX: -1 }),
      nodes,
      parentLevelId: level.id,
    })
    const back = resolveCabinetWallFaceOffset({
      hit: wallHit({ wall: wallA, localX: -1, side: 'back' }),
      nodes,
      parentLevelId: level.id,
    })

    expect(front).toBeCloseTo(0.1)
    expect(back).toBeCloseTo(-0.1)
  })

  test('falls back to half the wall thickness when the level has no walls', () => {
    const offset = resolveCabinetWallFaceOffset({
      hit: wallHit(),
      nodes: {} as Record<AnyNodeId, AnyNode>,
      parentLevelId: 'level_missing' as AnyNodeId,
    })

    expect(offset).toBeCloseTo(0.1)
  })
})

describe('collectCabinetWallSnapNeighbors', () => {
  const levelId = 'level_neighbors' as AnyNodeId

  function neighborFixture(cabinetOverrides: {
    position?: [number, number, number]
    rotation?: number
    parentId?: AnyNodeId
  }) {
    const level = LevelNode.parse({
      id: levelId,
      children: ['wall_snap-test' as AnyNodeId],
    })
    const cabinet = CabinetNode.parse({
      id: 'cabinet_neighbor',
      parentId: cabinetOverrides.parentId ?? level.id,
      // Back flush against the front face of the [0,0]→[2,0] wall:
      // z = thickness/2 + depth/2 = 0.1 + 0.29.
      position: cabinetOverrides.position ?? [0.7, 0, 0.39],
      rotation: cabinetOverrides.rotation ?? 0,
      width: 0.6,
      depth: 0.58,
    })
    return {
      level,
      cabinet,
      nodes: { [level.id]: level, [cabinet.id]: cabinet } as Record<AnyNodeId, AnyNode>,
    }
  }

  test('collects a same-face cabinet as a local-x edge interval', () => {
    const { nodes } = neighborFixture({})

    const neighbors = collectCabinetWallSnapNeighbors({
      hit: wallHit(),
      nodes,
      parentLevelId: levelId,
      width: 0.6,
    })

    expect(neighbors).toHaveLength(1)
    expect(neighbors[0]!.minX).toBeCloseTo(0.4)
    expect(neighbors[0]!.maxX).toBeCloseTo(1.0)
  })

  test('tolerates rotation within the yaw threshold', () => {
    const { nodes } = neighborFixture({ rotation: 0.05 })

    const neighbors = collectCabinetWallSnapNeighbors({
      hit: wallHit(),
      nodes,
      parentLevelId: levelId,
      width: 0.6,
    })

    expect(neighbors).toHaveLength(1)
  })

  test('ignores cabinets whose rotation does not match the wall face yaw', () => {
    const { nodes } = neighborFixture({ rotation: Math.PI / 2 })

    const neighbors = collectCabinetWallSnapNeighbors({
      hit: wallHit(),
      nodes,
      parentLevelId: levelId,
      width: 0.6,
    })

    expect(neighbors).toHaveLength(0)
  })

  test('ignores cabinets standing off the hit wall face', () => {
    // Right yaw, but 21 cm proud of the flush position — past the face-match threshold.
    const { nodes } = neighborFixture({ position: [0.7, 0, 0.6] })

    const neighbors = collectCabinetWallSnapNeighbors({
      hit: wallHit(),
      nodes,
      parentLevelId: levelId,
      width: 0.6,
    })

    expect(neighbors).toHaveLength(0)
  })

  test('ignores cabinets parented to another level', () => {
    const { nodes } = neighborFixture({ parentId: 'level_other' as AnyNodeId })

    const neighbors = collectCabinetWallSnapNeighbors({
      hit: wallHit(),
      nodes,
      parentLevelId: levelId,
      width: 0.6,
    })

    expect(neighbors).toHaveLength(0)
  })

  test('ignores cabinets whose span cannot reach the moving cabinet on the wall', () => {
    // Entirely left of the wall start: maxX = -0.7 < width / 2.
    const { nodes } = neighborFixture({ position: [-1, 0, 0.39] })

    const neighbors = collectCabinetWallSnapNeighbors({
      hit: wallHit(),
      nodes,
      parentLevelId: levelId,
      width: 0.6,
    })

    expect(neighbors).toHaveLength(0)
  })

  test('measures a run with modules from the module span, not the run node width', () => {
    const { level } = neighborFixture({})
    const run = CabinetNode.parse({
      id: 'cabinet_neighbor',
      parentId: level.id,
      position: [0.5, 0, 0.39],
      rotation: 0,
      width: 0.6,
      depth: 0.58,
      children: ['cabinet-module_a', 'cabinet-module_b' as AnyNodeId],
    })
    const moduleA = CabinetModuleNode.parse({
      id: 'cabinet-module_a',
      parentId: run.id,
      position: [0.3, 0.1, 0],
      width: 0.6,
    })
    const moduleB = CabinetModuleNode.parse({
      id: 'cabinet-module_b',
      parentId: run.id,
      position: [0.9, 0.1, 0],
      width: 0.6,
    })
    const nodes = {
      [level.id]: level,
      [run.id]: run,
      [moduleA.id]: moduleA,
      [moduleB.id]: moduleB,
    } as Record<AnyNodeId, AnyNode>

    const neighbors = collectCabinetWallSnapNeighbors({
      hit: wallHit(),
      nodes,
      parentLevelId: levelId,
      width: 0.6,
    })

    // Module span is run-local [0, 1.2] → plan [0.5, 1.7] along the wall.
    expect(neighbors).toHaveLength(1)
    expect(neighbors[0]!.minX).toBeCloseTo(0.5)
    expect(neighbors[0]!.maxX).toBeCloseTo(1.7)
  })
})

describe('resolveCabinetRunWallSnap', () => {
  test('snaps a moved cabinet run flush to the nearest wall while ignoring moving peers', () => {
    const level = LevelNode.parse({
      id: 'level_group-wall-snap',
      children: ['wall_group-snap' as AnyNodeId],
    })
    const wall = WallNode.parse({
      id: 'wall_group-snap',
      parentId: level.id,
      start: [0, 0],
      end: [4, 0],
      thickness: 0.2,
    })
    const movingCabinet = CabinetNode.parse({
      id: 'cabinet_group-snap',
      parentId: level.id,
      position: [1.2, 0, 0.82],
      rotation: 0,
      depth: 0.58,
      children: ['cabinet-module_group-snap'],
    })
    const movingModule = CabinetModuleNode.parse({
      id: 'cabinet-module_group-snap',
      parentId: movingCabinet.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
    })
    const peerMovingCabinet = CabinetNode.parse({
      id: 'cabinet_peer-moving',
      parentId: level.id,
      position: [2.4, 0, 0.82],
      rotation: 0,
      depth: 0.58,
      children: ['cabinet-module_peer-moving'],
    })
    const peerMovingModule = CabinetModuleNode.parse({
      id: 'cabinet-module_peer-moving',
      parentId: peerMovingCabinet.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
    })
    const nodes = {
      [level.id]: level,
      [wall.id]: wall,
      [movingCabinet.id]: movingCabinet,
      [movingModule.id]: movingModule,
      [peerMovingCabinet.id]: peerMovingCabinet,
      [peerMovingModule.id]: peerMovingModule,
    } as Record<AnyNodeId, AnyNode>

    const snapped = resolveCabinetRunWallSnap({
      cabinet: movingCabinet,
      candidatePosition: [1.2, 0, 0.32],
      excludeIds: [movingCabinet.id as AnyNodeId, peerMovingCabinet.id as AnyNodeId],
      gridStep: 0.5,
      nodes,
      parentLevelId: level.id,
    })

    expect(snapped).not.toBeNull()
    expect(snapped![0]).toBeCloseTo(1)
    expect(snapped![2]).toBeCloseTo(0.39)
  })

  test('does not snap to a wall that is moving with the same group', () => {
    const level = LevelNode.parse({
      id: 'level_group-wall-moving',
      children: ['wall_group-moving' as AnyNodeId],
    })
    const wall = WallNode.parse({
      id: 'wall_group-moving',
      parentId: level.id,
      start: [0, 0],
      end: [4, 0],
      thickness: 0.2,
    })
    const cabinet = CabinetNode.parse({
      id: 'cabinet_group-moving',
      parentId: level.id,
      position: [1.2, 0, 0.82],
      rotation: 0,
      depth: 0.58,
      children: ['cabinet-module_group-moving'],
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_group-moving',
      parentId: cabinet.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
    })
    const nodes = {
      [level.id]: level,
      [wall.id]: wall,
      [cabinet.id]: cabinet,
      [module.id]: module,
    } as Record<AnyNodeId, AnyNode>

    const snapped = resolveCabinetRunWallSnap({
      cabinet,
      candidatePosition: [1.2, 0, 0.32],
      excludeIds: [cabinet.id as AnyNodeId, wall.id as AnyNodeId],
      nodes,
      parentLevelId: level.id,
    })

    expect(snapped).toBeNull()
  })
})

describe('resolveCabinetModuleWallSnapLocal', () => {
  function moduleDragFixture(runOverrides: { position?: [number, number, number] } = {}) {
    const level = LevelNode.parse({
      id: 'level_module-drag',
      children: ['wall_module-drag' as AnyNodeId],
    })
    const wall = WallNode.parse({
      id: 'wall_module-drag',
      parentId: level.id,
      start: [0, 0],
      end: [4, 0],
      thickness: 0.2,
    })
    const run = CabinetNode.parse({
      id: 'cabinet_module-drag',
      parentId: level.id,
      position: runOverrides.position ?? [1, 0, 0.39],
      rotation: 0,
      depth: 0.58,
      children: ['cabinet-module_dragged'],
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_dragged',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.6,
      depth: 0.58,
    })
    const nodes = {
      [level.id]: level,
      [wall.id]: wall,
      [run.id]: run,
      [module.id]: module,
    } as Record<AnyNodeId, AnyNode>
    return { level, wall, run, module, nodes }
  }

  test('pulls a dragged module flush to the wall in run-local coordinates', () => {
    const { level, run, module, nodes } = moduleDragFixture()

    // Cursor drifted 10 cm toward the wall (run-local z = plan z - 0.39,
    // so plan z = 0.29 — within the 0.4 m wall-snap range).
    const snapped = resolveCabinetModuleWallSnapLocal({
      candidateLocal: [0.5, 0.1, -0.1],
      module,
      nodes,
      parentLevelId: level.id,
      run,
    })

    expect(snapped).not.toBeNull()
    // Local x preserved (no neighbor stops), local z back to flush = 0.
    expect(snapped![0]).toBeCloseTo(0.5)
    expect(snapped![1]).toBeCloseTo(0.1)
    expect(snapped![2]).toBeCloseTo(0)
  })

  test('returns null when the module faces away from the closest wall', () => {
    const { level, module, nodes } = moduleDragFixture()
    const rotatedRun = CabinetNode.parse({
      id: 'cabinet_module-drag',
      parentId: level.id,
      position: [1, 0, 0.39],
      rotation: Math.PI / 2,
      depth: 0.58,
      children: ['cabinet-module_dragged'],
    })

    const snapped = resolveCabinetModuleWallSnapLocal({
      candidateLocal: [0.5, 0.1, 0.2],
      module,
      nodes: { ...nodes, [rotatedRun.id]: rotatedRun } as Record<AnyNodeId, AnyNode>,
      parentLevelId: level.id,
      run: rotatedRun,
    })

    expect(snapped).toBeNull()
  })

  test('returns null when the closest wall is out of snap range', () => {
    const { level, run, module, nodes } = moduleDragFixture()

    const snapped = resolveCabinetModuleWallSnapLocal({
      candidateLocal: [0.5, 0.1, 2],
      module,
      nodes,
      parentLevelId: level.id,
      run,
    })

    expect(snapped).toBeNull()
  })
})
