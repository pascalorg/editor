import { expect, test } from 'bun:test'
import {
  type AnyNode,
  FloorOpeningNode,
  LevelNode,
  SlabNode,
  StairNode,
  ZoneNode,
} from '@pascal-app/core'
import { Raycaster, Vector3 } from 'three'
import { migrateOwnedFloorOpenings } from '../../../../core/src/utils/owned-floor-opening-migration'
import { buildSlabGeometry } from '../geometry'

test('a stacked Floor 1 plate still has a rendered walking surface after stair-opening healing', () => {
  const polygon: [number, number][] = [
    [-1.45, 1.05],
    [3.95, 1.05],
    [3.95, 5.95],
    [-1.45, 5.95],
  ]
  const stairHole: [number, number][] = [
    [-1.18, 2.03],
    [-0.18, 2.03],
    [-0.18, 5.39],
    [-1.18, 5.39],
  ]
  const manualHole: [number, number][] = [
    [1.5, 2],
    [3, 2],
    [3, 5],
    [1.5, 5],
  ]
  const level = LevelNode.parse({ id: 'level_floor_one' })
  const zone = ZoneNode.parse({
    id: 'zone_floor_one',
    name: 'Floor 1 room',
    parentId: level.id,
    spaceRole: 'room',
    polygon,
    floor: { elevation: 0.35 },
  })
  const base = SlabNode.parse({
    id: 'slab_floor_one_base',
    parentId: level.id,
    plateRole: 'base',
    boundary: 'auto',
    autoFromWalls: true,
    polygon,
    zoneIds: [zone.id],
    elevation: 0.1,
    thickness: 0.1,
  })
  const platform = SlabNode.parse({
    id: 'slab_floor_one_platform',
    parentId: level.id,
    plateRole: 'platform',
    boundary: 'auto',
    autoFromWalls: true,
    polygon,
    zoneIds: [zone.id],
    elevation: 0.35,
    thickness: 0.25,
    holes: [manualHole, stairHole, stairHole],
    holeMetadata: [
      { source: 'manual' },
      { source: 'floor-opening', openingId: 'floor-opening_floor_one_a' },
      { source: 'floor-opening', openingId: 'floor-opening_floor_one_b' },
    ],
  })
  const stair = StairNode.parse({ id: 'stair_floor_one', parentId: level.id })
  const first = FloorOpeningNode.parse({
    id: 'floor-opening_floor_one_a',
    parentId: level.id,
    polygon: stairHole,
    source: 'stair',
    ownerId: stair.id,
    surfaceId: platform.id,
    cutsAdjacent: false,
    legacyPlateCuts: { [platform.id]: [stairHole] },
  })
  const duplicate = FloorOpeningNode.parse({
    ...first,
    id: 'floor-opening_floor_one_b',
    surfaceId: undefined,
  })
  level.children = [zone.id, base.id, platform.id, stair.id, first.id, duplicate.id]
  const source = Object.fromEntries(
    [level, zone, base, platform, stair, first, duplicate].map((node) => [node.id, node]),
  ) as Record<string, AnyNode>
  const nodes = migrateOwnedFloorOpenings(source).nodes as Record<string, AnyNode>
  const healed = nodes[platform.id] as SlabNode
  expect(healed.holes).toHaveLength(2)
  const context = {
    parent: nodes[level.id]!,
    resolve: (id: string) => nodes[id],
    children: [],
    siblings: [base, zone, stair],
  }
  const geometry = buildSlabGeometry(healed, context, 'rendered', true)
  geometry.updateMatrixWorld(true)
  const hits = new Raycaster(new Vector3(0.5, 1, 1.5), new Vector3(0, -1, 0), 0, 2).intersectObject(
    geometry,
    true,
  )
  expect(hits[0]?.point.y).toBeCloseTo(0.35)
  expect(hits[0]?.object.userData.slotId).toBe(`room:${zone.id}`)
})
