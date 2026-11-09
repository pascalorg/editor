import { describe, expect, test } from 'bun:test'
import { levelGradeStanding } from '../lib/grade-standing'
import { type AnyNode, type AnyNodeId, BuildingNode, LevelNode } from '../schema'
import { levelFloorWorldY } from '../services/storey'
import { buildLevelBelowChanges } from './level-insertion'

type Nodes = Record<string, AnyNode>

/** A building whose levels are given bottom to top as [ordinal, baseElevation, height]. */
function house(levels: Array<[number, number, number]>): { nodes: Nodes; building: string } {
  const made = levels.map(([level, baseElevation, height]) =>
    LevelNode.parse({ level, baseElevation, height, children: [] }),
  )
  const building = BuildingNode.parse({ children: made.map((level) => level.id) })
  const nodes: Nodes = { [building.id]: building }
  for (const level of made) nodes[level.id] = { ...level, parentId: building.id }
  return { nodes, building: building.id }
}

/** The change set applied the way the store does: creates, then updates. */
function apply(nodes: Nodes, buildingId: string, height: number): { nodes: Nodes; id: string } {
  const { newLevel, create, update } = buildLevelBelowChanges({ nodes, buildingId, height })
  const next: Nodes = { ...nodes }
  for (const { node } of create) next[node.id] = node
  const building = next[buildingId]
  if (building?.type === 'building')
    next[buildingId] = { ...building, children: [...building.children, newLevel.id] } as AnyNode
  for (const { id, data } of update) next[id] = { ...next[id], ...data } as AnyNode
  return { nodes: next, id: newLevel.id }
}

const floors = (nodes: Nodes) =>
  Object.values(nodes)
    .filter((node): node is LevelNode => node.type === 'level')
    .sort((a, b) => a.level - b.level)
    .map((level) => [
      level.level,
      Number(levelFloorWorldY(nodes as never, level.id)?.toFixed(3)) + 0,
    ])

describe('buildLevelBelowChanges', () => {
  test('a basement added to a house at grade goes under it and the house stays where it stood', () => {
    const { nodes, building } = house([
      [0, 0, 3],
      [1, 0, 3],
    ])
    expect(floors(nodes)).toEqual([
      [0, 0],
      [1, 3],
    ])
    const next = apply(nodes, building, 2.5)
    expect(floors(next.nodes)).toEqual([
      [-1, -2.5],
      [0, 0],
      [1, 3],
    ])
    expect(levelGradeStanding(next.nodes as never, next.id)).toBe('below-grade')
  })

  test("the villa's second basement goes under the first, nothing above it moves", () => {
    // Lower Ground at -3.63 m, 3.4 m tall (the stored owner project), a storey over it.
    const { nodes, building } = house([
      [-1, -3.63, 3.4],
      [0, 0, 4.2],
    ])
    expect(floors(nodes)).toEqual([
      [-1, -3.63],
      [0, -0.23],
    ])
    const next = apply(nodes, building, 2.5)
    expect(floors(next.nodes)).toEqual([
      [-2, -6.13],
      [-1, -3.63],
      [0, -0.23],
    ])
  })

  test('four basements in a row, one at a time: each is one storey lower, the rest stay put', () => {
    let state = house([[0, 0, 3]])
    const heights = [2.5, 3.4, 2.5, 3]
    const expected: Array<[number, number]> = [
      [-1, -2.5],
      [-2, -5.9],
      [-3, -8.4],
      [-4, -11.4],
    ]
    for (const [index, height] of heights.entries()) {
      const next = apply(state.nodes, state.building, height)
      state = { nodes: next.nodes, building: state.building }
      expect(floors(state.nodes)).toEqual([...expected.slice(0, index + 1).reverse(), [0, 0]])
    }
  })

  test('an empty building gets its first level at 0', () => {
    const { nodes, building } = house([])
    const next = apply(nodes, building, 2.5)
    expect(floors(next.nodes)).toEqual([[0, 0]])
  })

  test('one change set: the new level and the old lowest level giving up its offset', () => {
    const { nodes, building } = house([
      [-1, -3.63, 3.4],
      [0, 0, 4.2],
    ])
    const { create, update, newLevel } = buildLevelBelowChanges({
      nodes,
      buildingId: building,
      height: 2.5,
    })
    expect(create).toHaveLength(1)
    expect(newLevel.baseElevation).toBeCloseTo(-6.13, 6)
    expect(update).toEqual([
      { id: expect.any(String) as unknown as AnyNodeId, data: { baseElevation: 0 } },
    ])
  })
})
