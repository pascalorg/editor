import { expect, test } from 'bun:test'
import { CeilingNode, LevelNode, SlabNode, UnitNode, WallNode, ZoneNode } from '../schema'
import { containsPoint, distanceToBoundary, type Ring } from './polygon-boolean'
import { polygonInteriorPoint } from './polygon-label'
import { reconcileSceneStructure } from './structure-reconcile'
import { buildUnitReport } from './unit-report'
import { deriveZoneQuantityReport } from './zone-quantities'

const polygon: Ring = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
]
const hole: Ring = [
  [3, 3],
  [7, 3],
  [7, 7],
  [3, 7],
]
const level = LevelNode.parse({ id: 'level_holes', height: 3 })
const walls = [polygon, hole].flatMap((ring, loop) =>
  ring.map((start, i) =>
    WallNode.parse({
      id: `wall_${loop}_${i}`,
      parentId: level.id,
      start,
      end: ring[(i + 1) % ring.length],
      thickness: 0.2,
    }),
  ),
)
const zone = ZoneNode.parse({
  id: 'zone_ring',
  name: 'Hall',
  polygon,
  holes: [hole],
  parentId: level.id,
})
const nodes = Object.fromEntries([level, ...walls, zone].map((node) => [node.id, node]))

test('zone quantities exclude the hole, include its wall perimeter, and ignore surfaces inside it', () => {
  const surfaces = [
    SlabNode.parse({ parentId: level.id, polygon, holes: [hole], elevation: 0 }),
    CeilingNode.parse({ parentId: level.id, polygon, holes: [hole], height: 3 }),
    SlabNode.parse({ parentId: level.id, polygon: hole, elevation: 1 }),
    CeilingNode.parse({ parentId: level.id, polygon: hole, height: 2 }),
  ]
  const report = deriveZoneQuantityReport(zone, {
    ...nodes,
    ...Object.fromEntries(surfaces.map((n) => [n.id, n])),
  })
  expect(report.footprintArea).toBe(84)
  expect(report.perimeter).toBe(56)
  expect(report.classification).toBe('enclosed-room')
  expect(report.floorSurface).toMatchObject({ status: 'available', value: 84 })
  expect(report.volume).toMatchObject({ status: 'available', value: 252 })
  expect(report.boundaryWallIds).toHaveLength(8)
})

test('unit reports sum usable footprints including holes', () => {
  const unit = UnitNode.parse({ name: 'Suite', members: [zone.id] })
  expect(buildUnitReport(unit, nodes)).toMatchObject({ grossAreaM2: 84, members: [{ areaM2: 84 }] })
})

test('label pole is in the outer minus holes even when its centroid is in the hole', () => {
  const footprint = [{ outer: polygon, holes: [hole] }]
  const point = polygonInteriorPoint({ polygon, holes: [hole] })
  expect(containsPoint(footprint, point)).toBe(true)
  expect(distanceToBoundary(footprint, point)).toBeGreaterThan(1.75)
})

test('nested room floors merge into one plate; opting out the inner room restores the managed hole', () => {
  let sequence = 0
  const mintId = (kind: string) => `${kind}_${sequence++}`
  const initial = reconcileSceneStructure({ nodes, mintId }).nodes
  const slabs = Object.values(initial).filter((node): node is SlabNode => node.type === 'slab')
  expect(slabs).toHaveLength(1)
  expect(slabs[0]!.holes).toEqual([])
  const inner = Object.values(initial).find(
    (node): node is ZoneNode => node.type === 'zone' && node.holes.length === 0,
  )!
  const result = reconcileSceneStructure({
    nodes: { ...initial, [inner.id]: { ...inner, hasFloor: false } },
    mintId,
  }).nodes
  const plate = result[slabs[0]!.id] as SlabNode
  expect(plate.holeMetadata).toEqual([{ source: 'room' }])
  expect(containsPoint([{ outer: plate.polygon, holes: plate.holes }], [5, 5])).toBe(false)
  expect(reconcileSceneStructure({ nodes: result, mintId }).patches).toEqual([])
})
