import { describe, expect, test } from 'bun:test'
import { type AnyNode, BuildingNode, LevelNode, WallNode } from '../schema'
import { applySceneChanges } from './apply-changes'
import { deleteNode } from './delete-node'
import { duplicateLevel } from './duplicate-level'
import type { SceneNodes } from './types'

// Victor run 10, call 22: delete floors 5–7 (they held only their plans), then copy floor 4 three
// times. Floor 8 must stay at index 7 and the copies must take 4, 5 and 6.
function eightFloors(): Record<string, AnyNode> {
  const building = BuildingNode.parse({ id: 'building_main' })
  const levels = Array.from({ length: 8 }, (_, index) =>
    LevelNode.parse({ id: `level_f${index + 1}`, parentId: building.id, level: index }),
  )
  const walls = levels.map((level) =>
    WallNode.parse({ id: `wall_${level.id}`, parentId: level.id, start: [0, 0], end: [4, 0] }),
  )
  const nodes = [
    { ...building, children: levels.map((level) => level.id) },
    ...levels.map((level) => ({ ...level, children: [`wall_${level.id}`] })),
    ...walls,
  ]
  return Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<string, AnyNode>
}

const context = { activeLevelId: null }

describe('copying a floor up after deleting the floors above it', () => {
  test('fills the freed floors and leaves the top floor where it was', () => {
    let nodes = eightFloors() as SceneNodes
    for (const id of ['level_f5', 'level_f6', 'level_f7'])
      nodes = applySceneChanges(nodes as never, deleteNode(nodes, { id } as never, context).changes)
    for (let copy = 0; copy < 3; copy++)
      nodes = applySceneChanges(
        nodes as never,
        duplicateLevel(nodes, { levelId: 'level_f4' } as never, context).changes,
      )
    const levels = Object.values(nodes)
      .filter((node) => node.type === 'level')
      .map((node) => (node as LevelNode).level)
      .sort((a, b) => a - b)
    expect(levels).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect((nodes.level_f8 as LevelNode).level).toBe(7)
  })
})
