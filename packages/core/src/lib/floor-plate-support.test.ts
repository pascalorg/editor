import { expect, test } from 'bun:test'
import { LevelNode, SlabNode, WallNode, ZoneNode } from '../schema'
import { computeWallSlabSupport } from '../systems/slab/slab-support'
import { migrateFloorPlates } from '../utils/floor-plate-migration'
import { getRenderableSlabPolygon } from './slab-polygon'

const ring = (x0: number, z0: number, x1: number, z1: number): [number, number][] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
]
function fixture(highThickness = 0.45) {
  const polygon = ring(0, 0, 8, 4)
  const walls = polygon.map((start, i) =>
    WallNode.parse({
      id: `wall_${i}`,
      parentId: 'level_support',
      start,
      end: polygon[(i + 1) % 4],
      thickness: 0.2,
    }),
  )
  walls.push(
    WallNode.parse({
      id: 'wall_divider',
      parentId: 'level_support',
      start: [4, 0],
      end: [4, 4],
      thickness: 0.2,
    }),
  )
  const zones = [
    ZoneNode.parse({
      id: 'zone_low',
      parentId: 'level_support',
      polygon: ring(0, 0, 4, 4),
      name: 'Room',
      spaceRole: 'room',
      enclosureStatus: 'enclosed',
    }),
    ZoneNode.parse({
      id: 'zone_high',
      parentId: 'level_support',
      polygon: ring(4, 0, 8, 4),
      name: 'Room',
      spaceRole: 'room',
      enclosureStatus: 'enclosed',
    }),
  ]
  const slabs = zones.map((zone, i) =>
    SlabNode.parse({
      id: `slab_${i}`,
      parentId: 'level_support',
      polygon: zone.polygon,
      autoFromWalls: true,
      elevation: i ? 0.45 : 0.05,
      thickness: i ? highThickness : 0.05,
    }),
  )
  const level = LevelNode.parse({
    id: 'level_support',
    children: [...walls, ...zones, ...slabs].map((node) => node.id),
  })
  const nodes = Object.fromEntries(
    [level, ...walls, ...zones, ...slabs].map((node) => [node.id, node]),
  )
  const migrated = migrateFloorPlates(nodes).nodes as typeof nodes
  const plates = Object.values(migrated).filter((node): node is SlabNode => node.type === 'slab')
  return { walls, slabs, plates, nodes: migrated }
}

test.each([
  0.05, 0.45,
])('base plate carries every wall regardless of legacy thickness %s', (thickness) => {
  const { walls, plates, nodes } = fixture(thickness)
  const baseHeight = plates.find((plate) => plate.plateRole === 'base')!.elevation
  expect(baseHeight).toBe(0.05)
  expect(plates.every((plate) => plate.floorHeight === undefined)).toBe(true)
  for (const wall of walls) {
    const actual = computeWallSlabSupport(wall, plates, walls, undefined, undefined, 0, nodes)
    expect(actual.elevation).toBe(baseHeight)
    expect(actual.baseSegments).toEqual([{ start: 0, end: 1, elevation: baseHeight }])
  }
  const divider = computeWallSlabSupport(walls[4]!, plates, walls, undefined, undefined, 0, nodes)
  expect(divider.faceDatum.a[0]!.elevation).toBe(0.05)
  expect(divider.faceDatum.b[0]!.elevation).toBe(0.45)
  for (const plate of plates)
    expect(getRenderableSlabPolygon(plate, { walls, siblingSlabs: plates })).toBe(plate.polygon)
})

test('a zero-height exterior deck cannot pull a wall off the continuous base', () => {
  const { walls, plates, nodes } = fixture(0.05)
  const deck = SlabNode.parse({
    parentId: 'level_support',
    polygon: ring(4, -4, 8, 0),
    elevation: 0,
  })
  const wall = WallNode.parse({ start: [4.2, 0], end: [7.8, 0], thickness: 0.2 })
  const actual = computeWallSlabSupport(
    wall,
    [...plates, deck],
    walls,
    undefined,
    undefined,
    0,
    nodes,
  )
  expect(actual.elevation).toBe(0.05)
  expect(actual.baseElevation).toBe(0.05)
})
