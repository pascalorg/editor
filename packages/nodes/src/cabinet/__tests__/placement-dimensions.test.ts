import { describe, expect, test } from 'bun:test'
import { type AnyNode, DoorNode, LevelNode, WallNode } from '@pascal-app/core'
import {
  buildCabinetPlacementSizeDimensions,
  resolveCabinetPlacementDimensionPosition,
  resolveCabinetPlacementDimensions,
} from '../placement-dimensions'

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
