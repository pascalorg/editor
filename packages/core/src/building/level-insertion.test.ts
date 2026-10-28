import { describe, expect, test } from 'bun:test'
import { levelGradeStanding } from '../lib/grade-standing'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  DEFAULT_UPPER_FLOOR_THICKNESS,
  LevelNode,
  SlabNode,
} from '../schema'
import { levelFloorWorldY } from '../services/storey'
import { buildLevelBelowChanges } from './level-insertion'
import { buildLevelRemovalChanges } from './level-removal'

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

  test('the floor over a new basement is framed: its top held, the framing hanging into the basement, which is that much taller', () => {
    const { nodes, building } = house([[0, 0, 2.5]])
    const ground = Object.values(nodes).find((node) => node.type === 'level') as LevelNode
    const plate = SlabNode.parse({
      parentId: ground.id,
      plateRole: 'base',
      polygon: [
        [0, 0],
        [10, 0],
        [10, 8],
        [0, 8],
      ],
    })
    nodes[plate.id] = plate
    nodes[ground.id] = { ...ground, children: [plate.id] }
    const next = apply(nodes, building, 2.5)
    const framed = next.nodes[plate.id] as SlabNode
    expect(framed.thickness).toBeCloseTo(DEFAULT_UPPER_FLOOR_THICKNESS, 9)
    expect(framed.elevation).toBe(plate.elevation)
    const hang = DEFAULT_UPPER_FLOOR_THICKNESS - plate.thickness
    const basement = next.nodes[next.id] as LevelNode
    expect(basement.height).toBeCloseTo(2.5 + hang, 6)
    // The ground floor stays where it stood; the basement's rooms keep 2.5 m under the joists.
    expect(levelFloorWorldY(next.nodes as never, ground.id)).toBeCloseTo(0.05, 6)
    const underJoists = plate.elevation - DEFAULT_UPPER_FLOOR_THICKNESS
    expect(underJoists - (basement.baseElevation ?? 0)).toBeCloseTo(2.5, 6)
  })
})

/** The deletion applied the way the editor does: the level and its contents go, then the updates. */
function remove(nodes: Nodes, levelId: string): Nodes {
  const update = buildLevelRemovalChanges({ nodes: nodes as never, levelId })
  const next: Nodes = { ...nodes }
  const level = next[levelId] as LevelNode
  for (const child of level.children) delete next[child]
  delete next[levelId]
  const building = next[level.parentId!]
  if (building?.type === 'building')
    next[building.id] = {
      ...building,
      children: building.children.filter((id) => id !== levelId),
    } as AnyNode
  for (const { id, data } of update) next[id] = { ...next[id], ...data } as AnyNode
  return next
}

describe('buildLevelRemovalChanges', () => {
  test('a basement deleted again puts the floor over it back on the ground, its top held', () => {
    const { nodes, building } = house([[0, 0, 2.5]])
    const ground = Object.values(nodes).find((node) => node.type === 'level') as LevelNode
    const plate = SlabNode.parse({
      parentId: ground.id,
      plateRole: 'base',
      polygon: [
        [0, 0],
        [10, 0],
        [10, 8],
        [0, 8],
      ],
    })
    nodes[plate.id] = plate
    nodes[ground.id] = { ...ground, children: [plate.id] }
    const added = apply(nodes, building, 2.5)
    expect((added.nodes[plate.id] as SlabNode).buildUp).toBeDefined()
    const removed = remove(added.nodes, added.id)
    const back = removed[plate.id] as SlabNode
    expect(back.buildUp).toBeUndefined()
    expect(back.thickness).toBe(plate.thickness)
    expect(back.elevation).toBe(plate.elevation)
    expect(levelFloorWorldY(removed as never, ground.id)).toBeCloseTo(0.05, 6)
  })

  test('a basement added and deleted again leaves the house where it stood', () => {
    const { nodes, building } = house([
      [0, 0, 3],
      [1, 0, 3],
    ])
    const added = apply(nodes, building, 2.5)
    expect(buildLevelRemovalChanges({ nodes: added.nodes as never, levelId: added.id })).toEqual([])
    expect(floors(remove(added.nodes, added.id))).toEqual([
      [0, 0],
      [1, 3],
    ])
  })

  test('a basement made taller after it was added: the floors over it stay put when it goes', () => {
    const { nodes, building } = house([
      [0, 0, 3],
      [1, 0, 3],
    ])
    const added = apply(nodes, building, 2.5)
    added.nodes[added.id] = { ...added.nodes[added.id], height: 2.7432 } as AnyNode
    const before = floors(added.nodes).slice(1)
    expect(floors(remove(added.nodes, added.id))).toEqual(before)
  })

  test('a deleted middle floor closes up: the floors over it come down by its height', () => {
    const { nodes } = house([
      [0, 0, 3],
      [1, 0, 3],
      [2, 0, 3],
    ])
    const middle = Object.values(nodes).find(
      (node) => node.type === 'level' && node.level === 1,
    ) as LevelNode
    // The floor over it closes up its number too.
    expect(floors(remove(nodes, middle.id))).toEqual([
      [0, 0],
      [1, 3],
    ])
  })

  test('a basement deleted from over another: the one under it comes up into its place and takes its number', () => {
    const { nodes } = house([
      [-2, -5, 2.5],
      [-1, 0, 2.5],
      [0, 0, 2.5],
    ])
    const first = Object.values(nodes).find(
      (node) => node.type === 'level' && node.level === -1,
    ) as LevelNode
    expect(floors(remove(nodes, first.id))).toEqual([
      [-1, -2.5],
      [0, 0],
    ])
  })

  test('the floor the house was seated on deleted: the building comes down so the floor now at grade sits on its foundation', () => {
    // A basement set as the ground floor stood the house a storey up; it goes.
    const { nodes, building } = house([
      [-1, -2.5, 2.5],
      [0, 0, 2.5],
    ])
    const levels = Object.values(nodes).filter((node): node is LevelNode => node.type === 'level')
    const basement = levels.find((level) => level.level === -1)!
    const ground = levels.find((level) => level.level === 0)!
    const seatedOn = (nodes[building] as BuildingNode).position
    nodes[building] = {
      ...nodes[building],
      groundLevelId: basement.id,
      position: [seatedOn[0], 2.5 + 0.203, seatedOn[2]],
    } as AnyNode
    const update = buildLevelRemovalChanges({ nodes: nodes as never, levelId: basement.id })
    const moved = update.find((entry) => entry.id === building)
    expect(moved?.data).toMatchObject({ groundLevelId: ground.id })
    const after = remove(nodes, basement.id)
    expect(levelFloorWorldY(after as never, ground.id)).toBeCloseTo(0.203, 3)
  })
})
