import { describe, expect, test } from 'bun:test'
import { type AnyNode, BuildingNode, ElevatorNode, LevelNode } from '../../schema'
import { getLevelElevations } from '../../services/storey'
import { resolveElevatorLevels } from './elevator-service'

describe('resolveElevatorLevels', () => {
  test('matches offset-aware stacked level positions', () => {
    const levels = [
      LevelNode.parse({ id: 'level_0', parentId: 'building_1', level: 0, height: 2.5 }),
      LevelNode.parse({
        id: 'level_1',
        parentId: 'building_1',
        level: 1,
        baseElevation: 0.4,
        height: 3,
      }),
      LevelNode.parse({
        id: 'level_2',
        parentId: 'building_1',
        level: 2,
        baseElevation: -0.2,
        height: 2.5,
      }),
    ]
    const elevator = ElevatorNode.parse({
      id: 'elevator_1',
      parentId: 'building_1',
      fromLevelId: 'level_0',
      toLevelId: 'level_2',
    })
    const building = BuildingNode.parse({
      id: 'building_1',
      children: [...levels.map((level) => level.id), elevator.id],
    })
    const nodes = Object.fromEntries(
      [building, ...levels, elevator].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>

    const stacked = getLevelElevations(nodes)
    const resolved = resolveElevatorLevels(elevator, nodes)

    expect(resolved.entries.map((entry) => entry.baseY)).toEqual(
      levels.map((level) => stacked.get(level.id)?.baseY),
    )
    expect(resolved.shaftBaseY).toBe(stacked.get('level_0')?.baseY)
    expect(resolved.shaftTopY).toBeCloseTo(8.2)
  })

  // A negative offset large enough to sink the top level's ceiling below the
  // one beneath it must not drag the shaft top down with it — the cab travels
  // to the highest served ceiling, so a lower shaft top would clip it.
  test('a sunken top level does not pull the shaft top below the level beneath it', () => {
    const levels = [
      LevelNode.parse({ id: 'level_0', parentId: 'building_1', level: 0, height: 3 }),
      LevelNode.parse({
        id: 'level_1',
        parentId: 'building_1',
        level: 1,
        baseElevation: -2.5,
        height: 2,
      }),
    ]
    const elevator = ElevatorNode.parse({
      id: 'elevator_1',
      parentId: 'building_1',
      fromLevelId: 'level_0',
      toLevelId: 'level_1',
    })
    const building = BuildingNode.parse({
      id: 'building_1',
      children: [...levels.map((level) => level.id), elevator.id],
    })
    const nodes = Object.fromEntries(
      [building, ...levels, elevator].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>

    // level_0 ceiling is 3; level_1 sits at 3 - 2.5 = 0.5 and tops out at 2.5.
    expect(resolveElevatorLevels(elevator, nodes).shaftTopY).toBeCloseTo(3)
  })
})
