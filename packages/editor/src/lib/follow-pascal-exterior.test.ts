import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  DoorNode,
  ItemNode,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  SiteNode,
  WallNode,
} from '@pascal-app/core'
import { anyExterior, isExteriorNode } from './follow-pascal-exterior'

function scene() {
  const site = SiteNode.parse({ id: 'site_x' })
  const building = BuildingNode.parse({ id: 'building_x', parentId: site.id })
  const level = LevelNode.parse({ id: 'level_x', parentId: building.id, level: 0 })
  const outer = WallNode.parse({
    id: 'wall_outer',
    parentId: level.id,
    start: [0, 0],
    end: [4, 0],
    frontSide: 'interior',
    backSide: 'exterior',
  })
  const inner = WallNode.parse({
    id: 'wall_inner',
    parentId: level.id,
    start: [0, 2],
    end: [4, 2],
    frontSide: 'interior',
    backSide: 'interior',
  })
  const onOuter = DoorNode.parse({ id: 'door_outer', parentId: outer.id, wallId: outer.id })
  const onInner = DoorNode.parse({ id: 'door_inner', parentId: inner.id, wallId: inner.id })
  const sofa = ItemNode.parse({
    id: 'item_sofa',
    parentId: level.id,
    asset: {
      id: 'sofa',
      category: 'furniture',
      name: 'Sofa',
      thumbnail: '',
      src: '/sofa.glb',
      dimensions: [2, 1, 1],
    },
  })
  const bench = ItemNode.parse({ ...sofa, id: 'item_bench', parentId: site.id })
  const segment = RoofSegmentNode.parse({ id: 'rseg_x', parentId: 'roof_x' })
  const roof = RoofNode.parse({ id: 'roof_x', parentId: level.id, children: [segment.id] })
  // Only its kind and parent matter here; its samples are not read.
  const tile = {
    id: 'terrain-tile_x',
    type: 'terrain-tile',
    parentId: site.id,
  } as unknown as AnyNode
  return Object.fromEntries(
    [site, building, level, outer, inner, onOuter, onInner, sofa, bench, roof, segment, tile].map(
      (node) => [node.id, node as AnyNode],
    ),
  )
}

describe('what a change is seen from', () => {
  const nodes = scene()

  test('a wall with an exterior face, and an opening in it, are seen from outside', () => {
    expect(isExteriorNode(nodes, 'wall_outer')).toBe(true)
    expect(isExteriorNode(nodes, 'door_outer')).toBe(true)
  })

  test('an interior wall, an opening in it and furniture are looked at through a cutaway', () => {
    expect(isExteriorNode(nodes, 'wall_inner')).toBe(false)
    expect(isExteriorNode(nodes, 'door_inner')).toBe(false)
    expect(isExteriorNode(nodes, 'item_sofa')).toBe(false)
  })

  test('a roof and what stands on it, the ground, and furnishing standing in no storey are outside', () => {
    for (const id of ['roof_x', 'rseg_x', 'terrain-tile_x', 'item_bench'])
      expect(isExteriorNode(nodes, id)).toBe(true)
  })

  test('a node that is not in the scene is nothing', () => {
    expect(isExteriorNode(nodes, 'wall_gone')).toBe(false)
  })

  test('a group is outside when any of its nodes is', () => {
    expect(anyExterior(nodes, ['item_sofa', 'door_outer'])).toBe(true)
    expect(anyExterior(nodes, ['item_sofa', 'wall_inner'])).toBe(false)
    expect(anyExterior(nodes, [])).toBe(false)
  })
})
