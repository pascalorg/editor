import { expect, test } from 'bun:test'
import { sceneViewInterior, verifyScene } from '@pascal-app/core/agent-operations'
import {
  type AnyNode,
  BuildingNode,
  CeilingNode,
  ItemNode,
  LevelNode,
  WallNode,
} from '@pascal-app/core/schema'

const asset = {
  id: 'retained',
  name: 'Authored surface',
  category: 'custom',
  thumbnail: '',
  src: '/retained.glb',
  dimensions: [6, 1, 5],
}

function fixture() {
  const building = BuildingNode.parse({
    id: 'building_house',
    children: ['level_ground', 'level_roof'],
  })
  const ground = LevelNode.parse({
    id: 'level_ground',
    parentId: building.id,
    level: 0,
    height: 3,
    children: ['wall_room'],
  })
  const roofLevel = LevelNode.parse({
    id: 'level_roof',
    parentId: building.id,
    level: 1,
    height: 2,
    children: ['item_roof', 'item_vault'],
  })
  const wall = WallNode.parse({ id: 'wall_room', parentId: ground.id, start: [0, 0], end: [6, 0] })
  const roof = ItemNode.parse({
    id: 'item_roof',
    parentId: roofLevel.id,
    metadata: { role: 'roof' },
    position: [3, 0, 2.5],
    asset,
  })
  const ceiling = ItemNode.parse({
    id: 'item_vault',
    parentId: roofLevel.id,
    metadata: { role: 'ceiling' },
    position: [3, -0.3, 2.5],
    asset,
  })
  return Object.fromEntries(
    [building, ground, roofLevel, wall, roof, ceiling].map((n) => [n.id, n]),
  ) as Record<string, AnyNode>
}

test('a retained ceiling shell counts as a ceiling and preserves roof-level ownership', () => {
  const nodes = fixture()
  const before = structuredClone(nodes)
  const result = verifyScene(nodes, {} as never, { activeLevelId: 'level_ground' }).result
  expect(result.levels).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        levelId: 'level_roof',
        role: 'roof',
        content: expect.objectContaining({ roofs: 1, ceilings: 1, items: 0 }),
      }),
    ]),
  )
  expect(result.issues).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ type: 'roof_level_occupied' })]),
  )
  expect(nodes).toEqual(before)

  // Names and categories cannot let furniture bypass the roof-level placement rule.
  nodes.level_roof!.metadata.role = 'roof'
  nodes.item_vault!.metadata = {}
  nodes.item_vault!.name = 'Vault ceiling cabinet'
  expect(verifyScene(nodes, {} as never, { activeLevelId: null }).result.issues).toEqual(
    expect.arrayContaining([expect.objectContaining({ type: 'roof_level_occupied' })]),
  )
  const native = CeilingNode.parse({
    id: 'ceiling_native',
    parentId: 'level_roof',
    polygon: [
      [0, 0],
      [6, 0],
      [6, 5],
      [0, 5],
    ],
  })
  nodes.item_vault!.metadata.role = 'ceiling'
  nodes[native.id] = native
  ;(nodes.level_roof as LevelNode).children.push(native.id)
  expect(verifyScene(nodes, {} as never, { activeLevelId: null }).result.issues).toEqual(
    expect.arrayContaining([expect.objectContaining({ type: 'roof_level_occupied' })]),
  )
})

test('interior capture omits an explicitly classified retained ceiling without hiding ordinary items', () => {
  const nodes = fixture()
  const ceiling = nodes.item_vault as ItemNode
  ;(nodes.level_roof as LevelNode).children = ['item_roof']
  ceiling.parentId = 'level_ground'
  ;(nodes.level_ground as LevelNode).children.push(ceiling.id)
  const ordinary = ItemNode.parse({
    id: 'item_cabinet',
    parentId: 'level_ground',
    name: 'Ceiling-height cabinet',
    asset,
  })
  nodes[ordinary.id] = ordinary
  ;(nodes.level_ground as LevelNode).children.push(ordinary.id)
  const before = structuredClone(nodes)
  const view = sceneViewInterior(nodes, 'level_ground')
  expect(view.hiddenIds).toContain(ceiling.id)
  expect(view.hiddenIds).not.toContain(ordinary.id)
  expect(nodes).toEqual(before)
})
