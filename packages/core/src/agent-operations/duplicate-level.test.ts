import { describe, expect, test } from 'bun:test'
import { type AnyNode, BuildingNode, LevelNode, WallNode } from '../schema'
import { building, bungalow, level, mainRoof, room, scene } from './__fixtures__/roof-bearing-cases'
import { applySceneChanges } from './apply-changes'
import { deleteNode } from './delete-node'
import { duplicateLevel } from './duplicate-level'
import type { SceneNodes } from './types'

// An agent's build: delete floors 5–7 (they held only their plans), then copy floor 4 three
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

describe('copying a floor with a roof', () => {
  test('the copy’s roof on its walls goes onto a Roof level over the copy, said in a note', () => {
    const nodes = bungalow(...mainRoof())
    const { result, changes } = duplicateLevel(nodes, { levelId: 'level_g' }, context)
    const after = applySceneChanges(nodes, changes)
    const copied = Object.values(after).find((node) => node.type === 'roof' && !nodes[node.id])!
    const holder = after[copied.parentId!] as LevelNode
    expect(holder).toMatchObject({ level: 2, metadata: { role: 'roof' } })
    expect(holder.children).toEqual([copied.id])
    expect((after[result.newLevelId as string] as LevelNode).children).not.toContain(copied.id)
    // the original's own roof, written there before the rule, is left for the repair
    expect(after.roof_main?.parentId).toBe('level_g')
    expect(result.notes).toHaveLength(1)
  })

  test('a walled level someone declared the roof level is copied as a storey', () => {
    const nodes = scene(
      building(),
      level('level_g', 0, { role: 'roof', referenceLevelId: 'level_x' }),
      ...room('level_g', 'g'),
    )
    const { result, changes } = duplicateLevel(nodes, { levelId: 'level_g' }, context)
    const copy = applySceneChanges(nodes, changes)[result.newLevelId as string] as LevelNode
    expect(copy.metadata).toEqual({ referenceLevelId: 'level_x' })
  })
})
