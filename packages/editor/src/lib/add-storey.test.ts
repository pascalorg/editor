import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  LevelNode,
  RoofNode,
  useScene,
} from '@pascal-app/core'
import { addStoreyOnTop } from './add-storey'

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
