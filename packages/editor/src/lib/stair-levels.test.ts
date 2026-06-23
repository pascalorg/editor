import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  LevelNode,
  StairNode,
} from '@pascal-app/core/schema'
import {
  getBuildingLevelsForLevel,
  getStairLevelOptions,
  resolveStairDestinationLevel,
  resolveStairFromLevelId,
  resolveStairPlacementLevelId,
  resolveStairToLevelId,
} from './stair-levels'

describe('stair level helpers', () => {
  test('creates a missing upper level in the same building', () => {
    const ground = LevelNode.parse({ level: 0, children: [] })
    const building = BuildingNode.parse({ children: [ground.id] })
    const nodes = {
      [building.id]: building,
      [ground.id]: ground,
    } as Record<AnyNodeId, AnyNode>

    const plan = resolveStairDestinationLevel({
      createMissing: true,
      fromLevelId: ground.id,
      nodes,
    })

    expect(plan?.buildingId).toBe(building.id)
    expect(plan?.fromLevel.id).toBe(ground.id)
    expect(plan?.toLevel.level).toBe(1)
    expect(plan?.toLevel.id).toBe(plan?.createdLevel?.id)
    expect(plan?.createdLevel?.parentId).toBe(building.id)
  })

  test('uses the nearest higher sibling level instead of creating one', () => {
    const building = BuildingNode.parse({})
    const ground = LevelNode.parse({ level: 0, parentId: building.id })
    const second = LevelNode.parse({ level: 1, parentId: building.id })
    const third = LevelNode.parse({ level: 2, parentId: building.id })
    const nodes = {
      [building.id]: { ...building, children: [ground.id, third.id, second.id] },
      [ground.id]: ground,
      [second.id]: second,
      [third.id]: third,
    } as Record<AnyNodeId, AnyNode>

    const plan = resolveStairDestinationLevel({
      createMissing: true,
      fromLevelId: ground.id,
      nodes,
    })

    expect(plan?.createdLevel).toBeNull()
    expect(plan?.toLevel.id).toBe(second.id)
  })

  test('ignores levels from other buildings', () => {
    const buildingA = BuildingNode.parse({})
    const buildingB = BuildingNode.parse({})
    const groundA = LevelNode.parse({ level: 0, parentId: buildingA.id })
    const upperA = LevelNode.parse({ level: 1, parentId: buildingA.id })
    const upperB = LevelNode.parse({ level: 1, parentId: buildingB.id })
    const nodes = {
      [buildingA.id]: { ...buildingA, children: [groundA.id, upperA.id] },
      [buildingB.id]: { ...buildingB, children: [upperB.id] },
      [groundA.id]: groundA,
      [upperA.id]: upperA,
      [upperB.id]: upperB,
    } as Record<AnyNodeId, AnyNode>

    expect(getBuildingLevelsForLevel(nodes, groundA.id).map((level) => level.id)).toEqual([
      groundA.id,
      upperA.id,
    ])
    expect(
      resolveStairDestinationLevel({ createMissing: true, fromLevelId: groundA.id, nodes })?.toLevel
        .id,
    ).toBe(upperA.id)
  })

  test('includes source and parent-linked sibling levels when building children are stale', () => {
    const building = BuildingNode.parse({ children: [] })
    const ground = LevelNode.parse({ level: 0, parentId: building.id })
    const upper = LevelNode.parse({ level: 1, parentId: building.id })
    const nodes = {
      [building.id]: building,
      [ground.id]: ground,
      [upper.id]: upper,
    } as Record<AnyNodeId, AnyNode>

    const levels = getBuildingLevelsForLevel(nodes, ground.id)
    const plan = resolveStairDestinationLevel({
      createMissing: true,
      fromLevelId: ground.id,
      nodes,
    })

    expect(levels.map((level) => level.id)).toEqual([ground.id, upper.id])
    expect(plan?.createdLevel).toBeNull()
    expect(plan?.toLevel.id).toBe(upper.id)
  })

  test('falls back from stale placement level ids to a valid level in the selected building', () => {
    const buildingA = BuildingNode.parse({})
    const groundA = LevelNode.parse({ level: 0, parentId: buildingA.id })
    const buildingB = BuildingNode.parse({})
    const groundB = LevelNode.parse({ level: 0, parentId: buildingB.id })
    const nodes = {
      [buildingA.id]: { ...buildingA, children: [groundA.id] },
      [groundA.id]: groundA,
      [buildingB.id]: { ...buildingB, children: [groundB.id] },
      [groundB.id]: groundB,
    } as Record<AnyNodeId, AnyNode>

    expect(resolveStairPlacementLevelId(nodes, 'level_missing', buildingB.id)).toBe(groundB.id)
  })

  test('repairs panel level ids for stairs with stale from-level data', () => {
    const building = BuildingNode.parse({})
    const ground = LevelNode.parse({ level: 0, parentId: building.id })
    const upper = LevelNode.parse({ level: 1, parentId: building.id })
    const stair = StairNode.parse({
      parentId: ground.id,
      fromLevelId: 'default',
      toLevelId: upper.id,
    })
    const nodes = {
      [building.id]: { ...building, children: [ground.id, upper.id] },
      [ground.id]: ground,
      [upper.id]: upper,
      [stair.id]: stair,
    } as Record<AnyNodeId, AnyNode>

    const levels = getStairLevelOptions(nodes, stair)
    const fromLevelId = resolveStairFromLevelId(nodes, stair, levels)

    expect(levels.map((level) => level.id)).toEqual([ground.id, upper.id])
    expect(fromLevelId).toBe(ground.id)
    expect(resolveStairToLevelId(nodes, stair, fromLevelId, levels)).toBe(upper.id)
  })
})
