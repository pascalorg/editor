import { describe, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, DoorNode, LevelNode, WallNode } from '@pascal-app/core'
import {
  buildCabinetPlacementSizeDimensions,
  getCabinetPlacementCoordinates,
  resolveCabinetPlacementDimensionPosition,
  resolveCabinetPlacementDimensions,
  resolveCabinetTypedPlacementPosition,
} from '../placement-dimensions'
import { findClosestCabinetWallInPlan } from '../wall-snap'

describe('cabinet placement dimensions', () => {
  test('reports the distance from a wall start to the cabinet edge', () => {
    const level = LevelNode.parse({ id: 'level_placement-dimensions' })
    const wall = WallNode.parse({
      id: 'wall_placement-dimensions',
      parentId: level.id,
      start: [0, 0],
      end: [4, 0],
    })
    const nodes = Object.fromEntries(
      [level, wall].map((node) => [node.id, node as AnyNode]),
    ) as Record<string, AnyNode>

    const dimensions = resolveCabinetPlacementDimensions({
      depth: 0.6,
      levelId: level.id,
      nodes: nodes as Record<`${string}_${string}`, AnyNode>,
      position: [1, 0, 0.39],
      rotation: 0,
      width: 0.6,
    })

    expect(dimensions).toHaveLength(1)
    expect(dimensions[0]?.id).toBe('wall-start')
    expect(dimensions[0]?.value).toBeCloseTo(0.7)
  })

  test('reports the nearest gap to a wall-snapped neighbor', () => {
    const level = LevelNode.parse({ id: 'level_placement-neighbor' })
    const wall = WallNode.parse({
      id: 'wall_placement-neighbor',
      parentId: level.id,
      start: [0, 0],
      end: [4, 0],
    })
    const neighbor = {
      id: 'cabinet_placement-neighbor',
      type: 'cabinet',
      parentId: level.id,
      position: [0.5, 0, 0.39],
      rotation: 0,
      width: 0.6,
      depth: 0.6,
    } as AnyNode
    const nodes = Object.fromEntries(
      [level, wall, neighbor].map((node) => [node.id, node as AnyNode]),
    ) as Record<string, AnyNode>

    const dimensions = resolveCabinetPlacementDimensions({
      depth: 0.6,
      levelId: level.id,
      nodes: nodes as Record<`${string}_${string}`, AnyNode>,
      position: [1.5, 0, 0.39],
      rotation: 0,
      width: 0.6,
    })

    expect(dimensions.some((dimension) => dimension.id === 'neighbor-gap')).toBe(true)
    expect(dimensions.find((dimension) => dimension.id === 'neighbor-gap')?.value).toBeCloseTo(0.4)
  })

  test('does not emit a zero wall clearance dimension when already flush', () => {
    const level = LevelNode.parse({ id: 'level_placement-flush' })
    const door = DoorNode.parse({
      id: 'door_placement-flush',
      parentId: 'wall_placement-flush',
      position: [1, 1.05, 0],
      width: 0.9,
      height: 2.1,
    })
    const wall = WallNode.parse({
      id: 'wall_placement-flush',
      parentId: level.id,
      children: [door.id],
      start: [0, 0],
      end: [4, 0],
    })
    const nodes = Object.fromEntries(
      [level, wall, door].map((node) => [node.id, node as AnyNode]),
    ) as Record<string, AnyNode>

    const dimensions = resolveCabinetPlacementDimensions({
      depth: 0.6,
      levelId: level.id,
      nodes: nodes as Record<`${string}_${string}`, AnyNode>,
      position: [1, 0, 0.39],
      rotation: 0,
      width: 0.6,
      wallId: wall.id,
    })

    expect(dimensions.some((dimension) => dimension.id === 'wall-clearance')).toBe(false)
  })

  test('moves the cabinet edge to a typed wall-start distance', () => {
    const level = LevelNode.parse({ id: 'level_placement-input' })
    const wall = WallNode.parse({
      id: 'wall_placement-input',
      parentId: level.id,
      start: [0, 0],
      end: [4, 0],
    })
    const nodes = Object.fromEntries(
      [level, wall].map((node) => [node.id, node as AnyNode]),
    ) as Record<string, AnyNode>

    const result = resolveCabinetPlacementDimensionPosition({
      depth: 0.6,
      dimensionId: 'wall-start',
      levelId: level.id,
      nodes: nodes as Record<`${string}_${string}`, AnyNode>,
      position: [1, 0, 0.39],
      rotation: 0,
      wallId: wall.id,
      value: 1.2,
      width: 0.6,
    })

    expect(result?.wallLocalX).toBeCloseTo(1.5)
    expect(result?.position[0]).toBeCloseTo(1.5)
  })

  test('moves a continuous span to a typed wall-start distance', () => {
    const level = LevelNode.parse({ id: 'level_placement-span-input' })
    const wall = WallNode.parse({
      id: 'wall_placement-span-input',
      parentId: level.id,
      start: [0, 0],
      end: [4, 0],
    })
    const nodes = Object.fromEntries(
      [level, wall].map((node) => [node.id, node as AnyNode]),
    ) as Record<string, AnyNode>

    const result = resolveCabinetPlacementDimensionPosition({
      depth: 0.6,
      dimensionId: 'wall-start',
      levelId: level.id,
      nodes: nodes as Record<`${string}_${string}`, AnyNode>,
      position: [1.5, 0, 0.39],
      rotation: 0,
      wallId: wall.id,
      value: 0.2,
      width: 1.8,
    })

    expect(result?.wallLocalX).toBeCloseTo(1.1)
    expect(result?.position[0]).toBeCloseTo(1.1)
  })

  test('projects typed distance and offset from the same wall reference', () => {
    const level = LevelNode.parse({ id: 'level_typed-coordinate' })
    const wall = WallNode.parse({
      id: 'wall_typed-coordinate',
      parentId: level.id,
      start: [0, 0],
      end: [4, 0],
    })
    const nodes = Object.fromEntries(
      [level, wall].map((node) => [node.id, node as AnyNode]),
    ) as Record<string, AnyNode>
    const typedNodes = nodes as Record<AnyNodeId, AnyNode>
    const hit = findClosestCabinetWallInPlan({
      excludeIds: [],
      nodes: typedNodes,
      parentLevelId: level.id,
      planPoint: [1, 0.35],
    })

    expect(hit).not.toBeNull()
    const coordinates = getCabinetPlacementCoordinates({
      depth: 0.6,
      hit: hit!,
      levelId: level.id,
      nodes: typedNodes,
      position: [1, 0, 0.35],
      width: 0.6,
    })
    expect(coordinates.distance).toBeCloseTo(0.7)
    expect(coordinates.offset).toBeCloseTo(0)

    const result = resolveCabinetTypedPlacementPosition({
      depth: 0.6,
      distance: 1.2,
      hit: hit!,
      levelId: level.id,
      nodes: typedNodes,
      offset: 0.1,
      position: [1, 0, 0.35],
      width: 0.6,
    })
    expect(result?.wallLocalX).toBeCloseTo(1.5)
    expect(result?.position[0]).toBeCloseTo(1.5)
    expect(result?.position[2]).toBeCloseTo(0.45)
    expect(result?.yaw).toBeCloseTo(0)
  })

  test('centers a cabinet wider than the wall on typed entry (no jump off center)', () => {
    const level = LevelNode.parse({ id: 'level_typed-oversize' })
    const wall = WallNode.parse({
      id: 'wall_typed-oversize',
      parentId: level.id,
      start: [0, 0],
      end: [4, 0],
    })
    const nodes = Object.fromEntries(
      [level, wall].map((node) => [node.id, node as AnyNode]),
    ) as Record<string, AnyNode>
    const typedNodes = nodes as Record<AnyNodeId, AnyNode>
    const hit = findClosestCabinetWallInPlan({
      excludeIds: [],
      nodes: typedNodes,
      parentLevelId: level.id,
      planPoint: [2, 0.35],
    })

    expect(hit).not.toBeNull()
    // Wall snap centers an oversized cabinet (empty span → midpoint).
    const coordinates = getCabinetPlacementCoordinates({
      depth: 0.6,
      hit: hit!,
      levelId: level.id,
      nodes: typedNodes,
      position: [2, 0, 0.35],
      width: 5,
    })
    expect(coordinates.distance).toBeCloseTo(0)
    expect(coordinates.offset).toBeCloseTo(0)

    // Typed entry (including committing the default distance 0) must resolve
    // to the same centered pose instead of localX = width / 2.
    const result = resolveCabinetTypedPlacementPosition({
      depth: 0.6,
      distance: 0,
      hit: hit!,
      levelId: level.id,
      nodes: typedNodes,
      offset: 0,
      position: [2, 0, 0.35],
      width: 5,
    })
    expect(result?.wallLocalX).toBeCloseTo(2)
    expect(result?.position[0]).toBeCloseTo(2)
  })

  test('builds editable cabinet size dimensions for the placement views', () => {
    const dimensions = buildCabinetPlacementSizeDimensions({
      depth: 0.6,
      height: 0.75,
      position: [1, 0, 2],
      rotation: 0,
      width: 0.6,
    })

    expect(dimensions.map((dimension) => dimension.id)).toEqual([
      'cabinet-width',
      'cabinet-depth',
      'cabinet-height',
    ])
    expect(dimensions[0]?.value).toBe(0.6)
    expect(dimensions[0]?.renderIn3d).toBe(false)
    expect(dimensions[2]?.renderInFloorplan).toBe(false)
  })
})
