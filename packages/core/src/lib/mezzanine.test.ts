import { afterEach, expect, test } from 'bun:test'
import { createMezzanine, deleteZone, setZoneIntent } from '../commands/structure'
import { spatialGridManager } from '../hooks/spatial-grid/spatial-grid-manager'
import { AnyNode, ItemNode, type SlabNode, StairNode } from '../schema'
import { assertDerivedNodeWrites, filterDerivedNodeWrites } from '../store/derived-node-guard'
import { computeWallSlabSupport } from '../systems/slab/slab-support'
import { resolveStairTotalRise } from '../systems/stair/stair-rise-query'
import { migrateFloorPlates } from '../utils/floor-plate-migration'
import { reconcileStructureOnLoad } from '../utils/reconcile-structure-on-load'
import { migrateCeilingRoomLinks, migrateRoomZones } from '../utils/room-zone-migration'
import { mezzanineFixture, mezzaninePolygon } from './__fixtures__/mezzanine'
import { area } from './polygon-boolean'
import { deriveZoneQuantityReport } from './zone-quantities'

afterEach(() => spatialGridManager.clear())

test('mezzanine preserves host identity, whole plate, area, quantities and walls', () => {
  const { before, nodes, host, walls, reconcile } = mezzanineFixture()
  expect(nodes[host.id]).toEqual(host)
  const ground = Object.values(before).find((n) => n.type === 'slab')!
  expect(nodes[ground.id]).toEqual(ground)
  const initial = deriveZoneQuantityReport(host, before)
  const current = deriveZoneQuantityReport(host, nodes)
  expect(current.footprintArea).toBe(initial.footprintArea)
  expect(current.floorSurface).toEqual(initial.floorSurface)
  expect(current.wallSurface).toEqual(initial.wallSurface)
  const slabs = Object.values(nodes).filter((n): n is SlabNode => n.type === 'slab')
  for (const wall of walls) {
    expect(nodes[wall.id]).toEqual(before[wall.id])
    expect(computeWallSlabSupport(wall, slabs, walls, undefined, undefined, 0, nodes)).toEqual(
      computeWallSlabSupport(wall, [ground as SlabNode], walls, undefined, undefined, 0, before),
    )
  }
  expect(reconcile(nodes).patches).toEqual([])
})

test('mezzanine thin plate stops at wall faces with railing only on open intervals', () => {
  const { zone, plate } = mezzanineFixture()
  expect(plate).toMatchObject({
    boundary: 'auto',
    support: 'open',
    zoneIds: [zone.id],
    elevation: 2.5,
    thickness: 0.2,
    fillToTerrain: false,
  })
  expect(plate.polygon).toEqual(mezzaninePolygon)
  expect(
    plate.railing?.map(({ start, end }) => ({
      start: start.map((v) => Math.round(v * 1e4) / 1e4),
      end: end.map((v) => Math.round(v * 1e4) / 1e4),
    })),
  ).toEqual([
    { start: [4, 0.1], end: [4, 3] },
    { start: [4, 3], end: [0.1, 3] },
  ])
})

test('host ceiling has a room hole; mezzanine ceiling requires two metres and honors opt-out', () => {
  for (const [height, expected] of [
    [3.9, false],
    [4, true],
    [5, true],
  ] as const) {
    const { nodes, host, zone, plate, apply } = mezzanineFixture(height)
    const ceilings = Object.values(nodes).filter((n) => n.type === 'ceiling')
    const hostCeiling = ceilings.find((n) => n.zoneId === host.id)!
    expect(hostCeiling.holeMetadata).toEqual([{ source: 'room' }])
    expect(area(hostCeiling.holes.map((outer) => ({ outer, holes: [] })))).toBeCloseTo(
      area([{ outer: plate.polygon, holes: [] }]),
    )
    expect(ceilings.some((n) => n.zoneId === zone.id)).toBe(expected)
    const changed = apply(
      nodes,
      setZoneIntent(nodes, { zoneId: zone.id, patch: { hasCeiling: false } }),
    )
    expect(Object.values(changed).some((n) => n.type === 'ceiling' && n.zoneId === zone.id)).toBe(
      false,
    )
  }
})

test('mezzanine support election follows the pointed surface and stairs target its plate', () => {
  const { nodes, plate, level } = mezzanineFixture()
  for (const slab of Object.values(nodes).filter((n) => n.type === 'slab'))
    spatialGridManager.handleNodeCreated(slab, level.id)
  const pointed = spatialGridManager.getPointedSupportSurface(level.id, [2, 6, 2], [0, -1, 0])
  expect(pointed).toEqual({ slabId: plate.id, elevation: 2.5, point: [2, 2] })
  expect(
    spatialGridManager.getSlabSupportForItem(
      level.id,
      [2, 0, 2],
      [0.5, 1, 0.5],
      [0, 0, 0],
      pointed.elevation,
    ),
  ).toEqual({ slabId: plate.id, elevation: plate.elevation })
  expect(
    spatialGridManager.getPointedSupportSurface(level.id, [2, 1, 2], [0, -1, 0]).elevation,
  ).toBe(0.05)
  const stair = StairNode.parse({ parentId: level.id, deckSlabId: plate.id })
  expect(resolveStairTotalRise(stair, nodes, () => 0.05)).toBeCloseTo(2.45)
})

test('mezzanine intent updates preserve its plate ID and deletion removes construction and ceiling hole', () => {
  const { nodes, zone, host, plate, apply } = mezzanineFixture()
  const changed = apply(
    nodes,
    setZoneIntent(nodes, {
      zoneId: zone.id,
      patch: { floor: { elevation: 3.2, thickness: 0.3, finish: 'wood' } },
    }),
  )
  expect(changed[plate.id]).toMatchObject({ elevation: 3.2, thickness: 0.3 })
  expect(Object.values(changed).some((n) => n.type === 'ceiling' && n.zoneId === zone.id)).toBe(
    false,
  )
  const removed = apply(changed, deleteZone(changed, { zoneId: zone.id, contents: 'keep' }))
  expect(removed[plate.id]).toBeUndefined()
  expect(removed[host.id]).toEqual(host)
  expect(Object.values(removed).filter((n) => n.type === 'ceiling')).toMatchObject([
    { zoneId: host.id, holes: [] },
  ])
})

test('deleting mezzanine contents preserves items pinned to the host floor', () => {
  const { nodes, zone, plate, apply, host } = mezzanineFixture()
  const ground = Object.values(nodes).find(
    (n) => n.type === 'slab' && n.zoneIds?.includes(host.id),
  )!
  const asset = {
    id: 'chair',
    category: 'seating',
    name: 'Chair',
    thumbnail: '',
    src: 'https://example.com/chair.glb',
  }
  const lower = ItemNode.parse({
    id: 'item_lower',
    parentId: zone.parentId,
    position: [2, 0, 2],
    supportSlabId: ground.id,
    asset,
  })
  const upper = ItemNode.parse({ ...lower, id: 'item_upper', supportSlabId: plate.id })
  const withItems = { ...nodes, [lower.id]: lower, [upper.id]: upper }
  const removed = apply(withItems, deleteZone(withItems, { zoneId: zone.id, contents: 'delete' }))
  expect(removed[lower.id]).toEqual(lower)
  expect(removed[upper.id]).toBeUndefined()
})

test('MCP refuses and in-app filtering ignores hand-written mezzanine plate, railing, construction and ceiling holes', () => {
  const { nodes, plate, host } = mezzanineFixture()
  expect(() =>
    assertDerivedNodeWrites(nodes, { create: [{ node: { ...plate, id: 'slab_illegal' } }] }),
  ).toThrow()
  for (const data of [
    { railing: [] },
    { support: undefined },
    { elevation: 4 },
    { thickness: 1 },
    { boundary: undefined },
  ]) {
    expect(() => assertDerivedNodeWrites(nodes, { update: [{ id: plate.id, data }] })).toThrow()
    expect(filterDerivedNodeWrites(nodes, { update: [{ id: plate.id, data }] }).update).toEqual([])
  }
  const ceiling = Object.values(nodes).find((n) => n.type === 'ceiling' && n.zoneId === host.id)!
  expect(() =>
    assertDerivedNodeWrites(nodes, { update: [{ id: ceiling.id, data: { holes: [] } }] }),
  ).toThrow()
})

test('createMezzanine validates reference containment, simple polygon, area and snapped defaults', () => {
  const { before, host, mintId } = mezzanineFixture(5.13)
  const plan = createMezzanine(before, { hostZoneId: host.id, polygon: mezzaninePolygon, mintId })
  expect(plan.changes[0]).toMatchObject({
    op: 'create',
    node: { floor: { elevation: 2.55, thickness: 0.2, support: 'open' } },
  })
  for (const polygon of [
    [
      [-1, 0],
      [2, 0],
      [2, 2],
      [-1, 2],
    ],
    [
      [1, 1],
      [1.5, 1],
      [1.5, 1.5],
      [1, 1.5],
    ],
    [
      [1, 1],
      [4, 4],
      [1, 4],
      [4, 1],
    ],
  ] as [number, number][][])
    expect(createMezzanine(before, { hostZoneId: host.id, polygon, mintId }).changes).toEqual([])
})

test('full-clear mezzanine stays independent and survives schema/load roundtrip', () => {
  const { before, host, apply, reconcile } = mezzanineFixture()
  const plan = createMezzanine(before, {
    hostZoneId: host.id,
    polygon: [
      [0.1, 0.1],
      [7.9, 0.1],
      [7.9, 5.9],
      [0.1, 5.9],
    ],
    elevation: 0.3,
    mintId: () => 'zone_zzzz',
  })
  const nodes = apply(before, plan)
  expect(Object.values(nodes).filter((n) => n.type === 'slab')).toHaveLength(2)
  expect(nodes[host.id]).toEqual(host)
  const parsed = Object.fromEntries(Object.entries(nodes).map(([id, n]) => [id, AnyNode.parse(n)]))
  const rooms = migrateRoomZones(parsed).nodes
  const ceilings = migrateCeilingRoomLinks(rooms).nodes
  const plates = migrateFloorPlates(ceilings).nodes
  const loaded = reconcileStructureOnLoad(plates).nodes
  expect(loaded[plan.zoneId]).toEqual(nodes[plan.zoneId])
  expect(Object.values(loaded).filter((n) => n.type === 'ceiling')).toEqual(
    Object.values(nodes).filter((n) => n.type === 'ceiling'),
  )
  expect(reconcile(loaded).patches).toEqual([])
})

test('geometry determines the host cutout without hostZoneId; wall edits clip the derived plate only', () => {
  const { nodes, zone, plate, host, walls, reconcile } = mezzanineFixture()
  const ungrouped = { ...zone }
  delete ungrouped.hostZoneId
  const wall = walls[0]!
  const updated = reconcile({
    ...nodes,
    [zone.id]: ungrouped,
    [wall.id]: { ...nodes[wall.id]!, thickness: 0.6 } as AnyNode,
  }).nodes
  const clipped = updated[plate.id] as SlabNode
  expect(Math.min(...clipped.polygon.map(([, z]) => z))).toBeCloseTo(0.3)
  expect(updated[zone.id]).toEqual(ungrouped)
  expect(updated[wall.id]).toEqual({ ...nodes[wall.id]!, thickness: 0.6 })
  expect(
    Object.values(updated).find((n) => n.type === 'ceiling' && n.zoneId === host.id),
  ).toMatchObject({ holeMetadata: [{ source: 'room' }] })
})
