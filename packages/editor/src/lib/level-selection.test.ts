import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  LevelNode,
  RoofNode,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { selectPlacedNode } from './level-selection'

// A roof drawn over the ground floor's walls lands on the Roof level, which the editor hides while
// the ground floor is selected: selecting the roof there alone left it out of sight.
const BUILDING = 'building_select' as BuildingNode['id']
const GROUND = 'level_ground' as LevelNode['id']

beforeEach(() => {
  const ground = LevelNode.parse({ id: GROUND, parentId: BUILDING, level: 0, children: ['wall_a'] })
  const wall = WallNode.parse({ id: 'wall_a', parentId: GROUND, start: [0, 0], end: [4, 0] })
  const roofLevel = LevelNode.parse({
    id: 'level_roof',
    parentId: BUILDING,
    level: 1,
    children: ['roof_main'],
    metadata: { role: 'roof' },
  })
  const roof = RoofNode.parse({ id: 'roof_main', parentId: roofLevel.id })
  const building = BuildingNode.parse({ id: BUILDING, children: [GROUND, roofLevel.id] })
  useScene.setState({
    nodes: Object.fromEntries(
      [building, ground, wall, roofLevel, roof].map((node) => [node.id, node as AnyNode]),
    ),
    rootNodeIds: [BUILDING],
  } as never)
  useViewer.getState().setSelection({ buildingId: BUILDING, levelId: GROUND })
})

describe('selectPlacedNode', () => {
  test('a node placed on another level is selected with its level', () => {
    selectPlacedNode('roof_main' as AnyNodeId)
    expect(useViewer.getState().selection).toMatchObject({
      buildingId: BUILDING,
      levelId: 'level_roof',
      selectedIds: ['roof_main'],
    })
  })

  test('a node placed on the level in view leaves the level as it is', () => {
    selectPlacedNode('wall_a' as AnyNodeId)
    expect(useViewer.getState().selection).toMatchObject({
      levelId: GROUND,
      selectedIds: ['wall_a'],
    })
  })
})
