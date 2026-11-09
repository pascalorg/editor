import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  BuildingNode,
  type Capabilities,
  DoorNode,
  ItemNode,
  LevelNode,
  loadPlugin,
  nodeRegistry,
  RoofNode,
  RoofSegmentNode,
  SiteNode,
  WallNode,
} from '@pascal-app/core'
import { anyExterior, isExteriorNode } from './follow-pascal-exterior'
import { openingExterior, wallExterior } from './follow-pascal-exterior.test-fixture'

// The kinds are the nodes package's (it declares `capabilities.exterior` on them); fixtures of the
// same kind stand in for them here, and plugin-style kinds that declare the same fields are held to
// the same rules.
const kind = (type: string, schema: unknown, exterior?: Capabilities['exterior']) =>
  ({
    kind: type,
    schemaVersion: 1,
    schema,
    category: 'structure',
    defaults: () => ({}),
    capabilities: exterior === undefined ? {} : { exterior },
    geometry: () => null,
  }) as unknown as AnyNodeDefinition

let restoreRegistry: () => void = () => {}
beforeAll(async () => {
  restoreRegistry = nodeRegistry._snapshot()
  nodeRegistry._reset()
  await loadPlugin({
    id: 'fixture:exterior',
    apiVersion: 1,
    nodes: [
      kind('site', SiteNode, true),
      kind('building', BuildingNode, false),
      kind('level', LevelNode, false),
      kind('roof', RoofNode, true),
      kind('roof-segment', RoofSegmentNode, true),
      kind('wall', WallNode, wallExterior),
      kind('door', DoorNode, openingExterior),
      kind('item', ItemNode),
      // A plugin's own kinds: outdoors, outdoors by a field, and saying nothing.
      kind('fixture:deck', ItemNode, true),
      kind('fixture:cover', ItemNode, (node) => (node.name === 'seen' ? true : undefined)),
      kind('fixture:cable', ItemNode),
    ],
  })
})
afterAll(() => restoreRegistry())

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
  // Only their kind, name and parent matter here.
  const plugin = (id: string, type: string, parentId: string, name?: string) =>
    ({ id, type, parentId, name }) as unknown as AnyNode
  const deck = plugin('deck_x', 'fixture:deck', site.id)
  const deckOnLevel = plugin('deck_level', 'fixture:deck', level.id)
  const underDeck = plugin('cable_deck', 'fixture:cable', deckOnLevel.id)
  const underRoof = plugin('cable_roof', 'fixture:cable', roof.id)
  const cableInRoom = plugin('cable_room', 'fixture:cable', level.id)
  const seen = plugin('cover_seen', 'fixture:cover', level.id, 'seen')
  const unseen = plugin('cover_unseen', 'fixture:cover', level.id)
  const coverOnSite = plugin('cover_site', 'fixture:cover', site.id)
  return Object.fromEntries(
    [
      site,
      building,
      level,
      outer,
      inner,
      onOuter,
      onInner,
      sofa,
      bench,
      roof,
      segment,
      deck,
      deckOnLevel,
      underDeck,
      underRoof,
      cableInRoom,
      seen,
      unseen,
      coverOnSite,
    ].map((node) => [node.id, node as AnyNode]),
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
    for (const id of ['roof_x', 'rseg_x', 'deck_x', 'item_bench'])
      expect(isExteriorNode(nodes, id)).toBe(true)
  })

  // A kind that declares what the built-ins declare is treated as the built-in is.
  test('a plugin kind is outdoors as its definition says: always, by a field, or by what holds it', () => {
    expect(isExteriorNode(nodes, 'deck_level')).toBe(true)
    expect(isExteriorNode(nodes, 'cover_seen')).toBe(true)
    expect(isExteriorNode(nodes, 'cover_unseen')).toBe(false)
    expect(isExteriorNode(nodes, 'cable_deck')).toBe(true)
    expect(isExteriorNode(nodes, 'cable_roof')).toBe(true)
    expect(isExteriorNode(nodes, 'cable_room')).toBe(false)
    expect(isExteriorNode(nodes, 'cover_site')).toBe(true)
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
