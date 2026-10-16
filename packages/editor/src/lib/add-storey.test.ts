import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  LevelNode,
  levelFloorWorldY,
  levelGradeStanding,
  RoofNode,
  useScene,
} from '@pascal-app/core'
import { addStoreyBelow, addStoreyOnTop, setGroundFloor } from './add-storey'

// The editor's "add a floor" on a roofed house: the new storey goes under the roof, not over it.
const BUILDING = 'building_add-storey' as BuildingNode['id']

function seed() {
  const ground = LevelNode.parse({ id: 'level_ground', parentId: BUILDING, level: 0 })
  const roofLevel = LevelNode.parse({
    id: 'level_roof',
    parentId: BUILDING,
    level: 1,
    name: 'Roof',
    children: ['roof_main'],
    metadata: { role: 'roof' },
  })
  const roof = RoofNode.parse({ id: 'roof_main', parentId: roofLevel.id })
  const building = BuildingNode.parse({ id: BUILDING, children: [ground.id, roofLevel.id] })
  useScene.setState({
    nodes: Object.fromEntries(
      [building, ground, roofLevel, roof].map((node) => [node.id, node as AnyNode]),
    ),
    rootNodeIds: [BUILDING],
    collections: {},
    dirtyNodes: new Set(),
  } as never)
}

describe('addStoreyOnTop', () => {
  beforeEach(() => {
    useScene.temporal.getState().clear()
    useScene.temporal.getState().resume()
    seed()
  })

  test('puts the new storey under the roof level, which moves up one', () => {
    const level = addStoreyOnTop(BUILDING)
    const nodes = useScene.getState().nodes
    expect(nodes[level.id as AnyNodeId]).toMatchObject({ type: 'level', level: 1 })
    expect(nodes['level_roof' as AnyNodeId]).toMatchObject({ level: 2 })
  })

  test('is one undo step', () => {
    const level = addStoreyOnTop(BUILDING)
    useScene.temporal.getState().undo()
    const nodes = useScene.getState().nodes
    expect(nodes[level.id as AnyNodeId]).toBeUndefined()
    expect(nodes['level_roof' as AnyNodeId]).toMatchObject({ level: 1 })
  })
})

// The editor's "add a basement": under the lowest storey, the building staying where it stands.
describe('addStoreyBelow', () => {
  beforeEach(() => {
    useScene.temporal.getState().clear()
    useScene.temporal.getState().resume()
    seed()
  })

  const floorOf = (id: string) => {
    const floor = levelFloorWorldY(useScene.getState().nodes, id)
    return floor === null ? floor : Math.round(floor * 1000) / 1000 + 0
  }

  test('puts the basement under the ground floor and leaves the building where it was', () => {
    const basement = addStoreyBelow(BUILDING)
    expect(floorOf('level_ground')).toBe(0)
    expect(floorOf('level_roof')).toBe(2.5)
    expect(floorOf(basement.id)).toBe(-2.5)
    expect(levelGradeStanding(useScene.getState().nodes, basement.id)).toBe('below-grade')
  })

  test('three more basements stack down, each under the last, the building untouched', () => {
    const ids = [addStoreyBelow(BUILDING), addStoreyBelow(BUILDING), addStoreyBelow(BUILDING)]
    expect(ids.map((level) => floorOf(level.id))).toEqual([-2.5, -5, -7.5])
    expect(ids.map((level) => level.level)).toEqual([-1, -2, -3])
    expect(floorOf('level_ground')).toBe(0)
    expect(floorOf('level_roof')).toBe(2.5)
    for (const level of ids)
      expect(levelGradeStanding(useScene.getState().nodes, level.id)).toBe('below-grade')
  })

  test('the owner’s villa: a second basement goes under Lower Ground, nothing above it moves', () => {
    useScene.setState({
      nodes: {
        ...useScene.getState().nodes,
        level_ground: { ...useScene.getState().nodes['level_ground' as AnyNodeId], level: 0 },
        level_lower: LevelNode.parse({
          id: 'level_lower',
          parentId: BUILDING,
          level: -1,
          height: 3.4,
          baseElevation: -3.63,
        }),
        [BUILDING]: {
          ...useScene.getState().nodes[BUILDING as AnyNodeId],
          children: ['level_lower', 'level_ground', 'level_roof'],
        },
      } as never,
    })
    const before = ['level_lower', 'level_ground', 'level_roof'].map(floorOf)
    const basement = addStoreyBelow(BUILDING)
    expect(['level_lower', 'level_ground', 'level_roof'].map(floorOf)).toEqual(before)
    expect(floorOf(basement.id)).toBe(Math.round((-3.63 - 2.5) * 1000) / 1000)
  })

  test('is one undo step', () => {
    const basement = addStoreyBelow(BUILDING)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[basement.id as AnyNodeId]).toBeUndefined()
    expect(floorOf('level_ground')).toBe(0)
  })
})

// The editor's "Set as ground floor": the owner's mansion, whose stack stood Lower Ground at grade.
describe('setGroundFloor', () => {
  beforeEach(() => {
    useScene.temporal.getState().clear()
    useScene.temporal.getState().resume()
    const level = (id: string, index: number, baseElevation: number, height: number) =>
      LevelNode.parse({ id, parentId: BUILDING, level: index, baseElevation, height })
    const levels = [
      level('level_b2', -2, -3.4, 3.4),
      level('level_lower', -1, 0, 3.4),
      level('level_reception', 0, 0, 4),
    ]
    const building = BuildingNode.parse({ id: BUILDING, children: levels.map((entry) => entry.id) })
    useScene.setState({
      nodes: Object.fromEntries([building, ...levels].map((node) => [node.id, node as AnyNode])),
      rootNodeIds: [BUILDING],
      collections: {},
      dirtyNodes: new Set(),
    } as never)
  })

  const standing = (id: string) => levelGradeStanding(useScene.getState().nodes, id)

  test('seats the building so the level stands 8 in over grade, the ones under it below it, in one undo step', () => {
    expect(standing('level_lower')).toBe('at-grade')
    expect(setGroundFloor('level_reception' as LevelNode['id'])).toBe(true)
    const nodes = useScene.getState().nodes
    expect((nodes[BUILDING as AnyNodeId] as BuildingNode).position).toEqual([0, -3.197, 0])
    expect((nodes[BUILDING as AnyNodeId] as BuildingNode).groundLevelId).toBe('level_reception')
    expect(standing('level_reception')).toBe('at-grade')
    expect(standing('level_lower')).toBe('below-grade')
    expect(standing('level_b2')).toBe('below-grade')

    useScene.temporal.getState().undo()
    const undone = useScene.getState().nodes[BUILDING as AnyNodeId] as BuildingNode
    expect(undone.position).toEqual([0, 0, 0])
    expect(undone.groundLevelId).toBeUndefined()
    expect(standing('level_lower')).toBe('at-grade')
  })

  test('says nothing changed when the floor is already the ground floor, seated', () => {
    setGroundFloor('level_reception' as LevelNode['id'])
    expect(setGroundFloor('level_reception' as LevelNode['id'])).toBe(false)
  })

  test('a basement added after stacks under the last and the ground floor stays seated', () => {
    setGroundFloor('level_reception' as LevelNode['id'])
    const basement = addStoreyBelow(BUILDING)
    expect(basement.level).toBe(-3)
    expect(standing(basement.id)).toBe('below-grade')
    expect(levelFloorWorldY(useScene.getState().nodes, 'level_reception')).toBeCloseTo(0.203, 9)
  })
})
