import { expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  HedgeNode,
  ItemNode,
  LevelNode,
  PlantingNode,
  SiteNode,
  SlabNode,
  WallNode,
  ZoneNode,
} from '@pascal-app/core'
import { builtinPlugin } from '@pascal-app/nodes'
import { hedgesOnChangedGround } from '../hedge/ground-invalidation'
import { plantingsOnChangedScene } from '../planting/ground-invalidation'

const ring: [number, number][] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
]
const site = SiteNode.parse({ id: 'site_supported', children: ['building_supported'] })
const otherSite = SiteNode.parse({ id: 'site_unrelated_support', children: ['slab_other_support'] })
const building = BuildingNode.parse({
  id: 'building_supported',
  parentId: site.id,
  children: ['level_supported'],
})
const level = LevelNode.parse({
  id: 'level_supported',
  parentId: building.id,
  level: 0,
  children: ['slab_supported', 'wall_supported', 'zone_supported'],
})
const slab = SlabNode.parse({
  id: 'slab_supported',
  parentId: level.id,
  polygon: ring,
  elevation: 1,
  thickness: 1,
  associatedZoneIds: ['zone_supported'],
  children: ['item_support_cut'],
})
const wall = WallNode.parse({
  id: 'wall_supported',
  parentId: level.id,
  start: [0, 10],
  end: [0, 0],
  thickness: 0.3,
})
const zone = ZoneNode.parse({
  id: 'zone_supported',
  parentId: level.id,
  name: 'Supported room',
  polygon: ring,
  floor: { elevation: 1, sourceSlabId: slab.id },
})
const cutter = ItemNode.parse({
  id: 'item_support_cut',
  parentId: slab.id,
  position: [5, 0, 5],
  asset: {
    id: 'support-cut-fixture',
    category: 'test',
    name: 'Support opening',
    thumbnail: '',
    src: 'https://example.invalid/support-cut.glb',
    dimensions: [2, 2, 2],
  },
  source: {
    kind: 'script',
    script: 'a'.repeat(64),
    artifact: 'b'.repeat(64),
    manifest: {
      bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
      triangles: 12,
      cutters: [
        {
          host: 'mounted',
          polygon: [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ],
          minY: -1,
          maxY: 1,
        },
      ],
    },
  },
})
const otherSlab = SlabNode.parse({
  ...slab,
  id: 'slab_other_support',
  parentId: otherSite.id,
  associatedZoneIds: [],
  children: ['item_other_cut'],
})
const otherCutter = ItemNode.parse({ ...cutter, id: 'item_other_cut', parentId: otherSlab.id })
const hedge = HedgeNode.parse({
  id: 'hedge_supported',
  parentId: site.id,
  path: [
    [0, 5],
    [10, 5],
  ],
})
const planting = PlantingNode.parse({
  id: 'planting_supported',
  parentId: site.id,
  outline: ring,
})
const otherHedge = HedgeNode.parse({ ...hedge, id: 'hedge_other_support', parentId: otherSite.id })
const otherPlanting = PlantingNode.parse({
  ...planting,
  id: 'planting_other_support',
  parentId: otherSite.id,
})
const nodes = Object.fromEntries(
  [
    site,
    otherSite,
    building,
    level,
    slab,
    wall,
    zone,
    cutter,
    otherSlab,
    otherCutter,
    hedge,
    planting,
    otherHedge,
    otherPlanting,
  ].map((node) => [node.id, node]),
) as Record<AnyNodeId, AnyNode>

test.each([
  ['hedge', hedgesOnChangedGround, hedge, otherHedge],
  ['planting', plantingsOnChangedScene, planting, otherPlanting],
] as const)(
  '%s rebuilds for changed rendered-support inputs only in the owning Site',
  (_kind, invalidate, node, other) => {
    const initial = invalidate(nodes, new Map())
    expect(initial.dirty).toEqual([])
    expect(invalidate(nodes, initial.parts).dirty).toEqual([])
    const changes: AnyNode[] = [
      { ...wall, thickness: 0.5 },
      { ...zone, floor: { ...zone.floor, elevation: 0.6 } },
      { ...cutter, position: [7, 0, 5] },
    ]
    for (const changed of changes) {
      expect(invalidate({ ...nodes, [changed.id]: changed }, initial.parts).dirty).toEqual([
        node.id,
      ])
    }
    const withoutCutter = { ...nodes }
    delete withoutCutter[cutter.id]
    expect(invalidate(withoutCutter, initial.parts).dirty).toEqual([node.id])
    expect(
      invalidate(
        {
          ...nodes,
          [otherCutter.id]: { ...otherCutter, position: [7, 0, 5] },
        },
        initial.parts,
      ).dirty,
    ).toEqual([other.id])

    const definition = builtinPlugin.nodes!.find((candidate) => candidate.kind === node.type)!
    const dependencies = definition.floorplanDependencies!(node, nodes)
    for (const dependency of [wall, zone, cutter]) expect(dependencies).toContain(dependency.id)
    expect(dependencies).not.toContain(otherCutter.id)
  },
)
