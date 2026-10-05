import { describe, expect, spyOn, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import clipping from 'polygon-clipping'
import { buildFloorPlates, footprintIoU, slabFootprint } from '../lib/floor-plates'
import { plateFootprint } from '../lib/level-footprints'
import {
  area,
  containsPoint,
  difference,
  distanceToBoundary,
  intersection,
  type Ring,
  union,
} from '../lib/polygon-boolean'
import { extractRooms } from '../lib/room-graph'
import { getRenderableSlabPolygon } from '../lib/slab-polygon'
import { createRoomTopologyIndex } from '../lib/space-detection'
import type { AnyNode, SlabNode, WallNode, ZoneNode } from '../schema'
import { getWallCurveFrameAt } from '../systems/wall/wall-curve'
import { getWallPlanFootprint } from '../systems/wall/wall-footprint'
import { getWallFaceOffsets } from '../systems/wall/wall-frame'
import { calculateLevelMiters, getWallMiterBoundaryPoints } from '../systems/wall/wall-mitering'
import {
  healSceneNodes,
  migrateCeilingRoomLinks,
  migrateFloorPlates,
  migrateRoomZones,
  migrateSlabSlots,
  migrateVerticalSceneNodes,
} from './scene-migrations'

type Fixture = { sceneId: string; levelId: string; nodes: Record<string, AnyNode> }
const directory = new URL('../lib/__fixtures__/plate-corpus/migrations/', import.meta.url)
const fixtures: Fixture[] = readdirSync(directory)
  .filter((file) => file.endsWith('.json'))
  .sort()
  .map((file) => JSON.parse(readFileSync(new URL(file, directory), 'utf8')))
function rooms(nodes: Record<string, unknown>) {
  return migrateCeilingRoomLinks(migrateRoomZones(nodes).nodes).nodes as Record<string, AnyNode>
}
function migrate(nodes: Record<string, unknown>) {
  return migrateSlabSlots(migrateFloorPlates(rooms(nodes)).nodes).nodes as Record<string, AnyNode>
}
function plates(nodes: Record<string, unknown>): SlabNode[] {
  return Object.values(nodes)
    .filter(
      (node): node is SlabNode =>
        (node as AnyNode).type === 'slab' && (node as SlabNode).boundary === 'auto',
    )
    .sort((a, b) => a.id.localeCompare(b.id))
}
function visible(nodes: Record<string, AnyNode>) {
  const walls = Object.values(nodes).filter((node): node is WallNode => node.type === 'wall')
  const slabs = Object.values(nodes).filter((node): node is SlabNode => node.type === 'slab')
  const miters = calculateLevelMiters(walls)
  const quantize = (ring: Ring) =>
    ring.map(([x, z]) => [Math.round(x * 1e7) / 1e7, Math.round(z * 1e7) / 1e7] as [number, number])
  const polygons = slabs.map((slab) => [
    quantize(getRenderableSlabPolygon(slab, { walls, siblingSlabs: slabs })),
    ...(slab.holes ?? []).map(quantize),
  ])
  const boundaries = walls.map((wall) => [
    quantize(getWallPlanFootprint(wall, miters).map(({ x, y }) => [x, y])),
  ])
  if (!polygons.length) return 0
  const floor = clipping.union(polygons[0]!, ...polygons.slice(1))
  const result = boundaries.length ? clipping.difference(floor, ...boundaries) : floor
  const ringArea = (ring: Ring) =>
    Math.abs(
      ring.reduce((sum, p, i) => {
        const q = ring[(i + 1) % ring.length]!
        return sum + p[0] * q[1] - q[0] * p[1]
      }, 0),
    ) / 2
  return result.reduce(
    (sum, [outer, ...holes]) =>
      sum + ringArea(outer!) - holes.reduce((total, hole) => total + ringArea(hole), 0),
    0,
  )
}

function expectPreservedSlab(
  before: Record<string, AnyNode>,
  after: Record<string, AnyNode>,
  source: SlabNode,
  demoted = false,
) {
  const current = after[source.id] as SlabNode
  const { associatedZoneIds, ...construction } = current
  const reason = (current.metadata?.plateMigration as { demoted?: string } | undefined)?.demoted
  const oldWalls = Object.values(before).filter((node): node is WallNode => node.type === 'wall')
  const oldSlabs = Object.values(before).filter((node): node is SlabNode => node.type === 'slab')
  const rendered =
    reason === 'wall-supported-floor' &&
    JSON.stringify(current.polygon) !== JSON.stringify(source.polygon)
      ? getRenderableSlabPolygon(source, { walls: oldWalls, siblingSlabs: oldSlabs })
      : source.polygon
  expect(construction).toEqual(
    demoted
      ? {
          ...source,
          polygon: rendered,
          autoFromWalls: false,
          metadata: { ...source.metadata, plateMigration: { demoted: expect.any(String) } },
        }
      : source,
  )
  if (associatedZoneIds !== undefined)
    expect(associatedZoneIds).toEqual(
      Object.values(after)
        .filter(
          (node): node is ZoneNode =>
            node.type === 'zone' &&
            node.spaceRole === 'room' &&
            area(intersection(slabFootprint(node), slabFootprint(current))) > 1e-4,
        )
        .map((zone) => zone.id)
        .sort(),
    )
}

describe('M4/M5 trimmed production levels', () => {
  test.each(
    fixtures,
  )('$sceneId $levelId is deterministic, pure and stable across the server reload', ({ nodes }) => {
    const original = JSON.stringify(nodes)
    const warning = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const after = migrate(nodes)
      expect(JSON.stringify(nodes)).toBe(original)
      const reversed = migrate(Object.fromEntries(Object.entries(nodes).reverse()))
      expect(plates(reversed)).toEqual(plates(after))
      const reloaded = migrate(migrateVerticalSceneNodes(healSceneNodes(after).nodes).nodes)
      expect(reloaded).toEqual(after)
      expect(
        warning.mock.calls.filter(
          ([message, details]) =>
            message === '[floor plates] Keeping existing level construction' &&
            (details as { error: unknown }).error !== 'recessed-legacy: preserved verbatim',
        ),
      ).toEqual([])
      for (const plate of plates(after)) {
        if (!plate.zoneIds!.length) expect(plate.plateRole).toBe('base')
        expect(plate.zoneIds).toEqual([...plate.zoneIds!].sort())
        expect(
          (after[plate.parentId!] as { children: string[] }).children.filter(
            (id) => id === plate.id,
          ),
        ).toHaveLength(1)
      }
    } finally {
      warning.mockRestore()
    }
  })

  test.each(fixtures)('$sceneId $levelId preserves visible floor area within 1%', ({ nodes }) => {
    const before = visible(nodes),
      after = visible(migrate(nodes))
    expect(Math.abs(after - before)).toBeLessThanOrEqual(Math.max(1e-6, before * 0.01))
  })

  test.each([
    'scene-23',
  ])('%s keeps stale small floors without filling larger moved rooms', (sceneId) => {
    const fixture = fixtures.find((fixture) => fixture.sceneId === sceneId)!
    const after = migrate(fixture.nodes)
    expect(plates(after)).toEqual([])
    for (const slab of Object.values(fixture.nodes).filter((node) => node.type === 'slab'))
      expectPreservedSlab(fixture.nodes, after, slab, !!slab.autoFromWalls)
  })

  test('a room buried inside thick walls stays at zero visible floor area', () => {
    const fixture = fixtures.find(({ sceneId }) => sceneId === 'scene-11')!
    const after = migrate(fixture.nodes)
    expect(visible(fixture.nodes)).toBe(0)
    expect(visible(after)).toBe(0)
    expect(plates(after)).toEqual([])
    for (const slab of Object.values(fixture.nodes).filter((node) => node.type === 'slab'))
      expectPreservedSlab(fixture.nodes, after, slab, !!slab.autoFromWalls)
  })

  test.each(['scene-03'])('%s keeps one real room and one floor supplier', (sceneId) => {
    const fixture = fixtures.find((fixture) => fixture.sceneId === sceneId)!
    const after = migrate(fixture.nodes)
    const zones = Object.values(after).filter(
      (node): node is ZoneNode => node.type === 'zone' && node.spaceRole === 'room',
    )
    expect(zones).toHaveLength(1)
    expect(zones[0]!.holes).toEqual([])
    const suppliers = Object.values(after).filter(
      (node): node is SlabNode =>
        node.type === 'slab' &&
        (node.zoneIds?.includes(zones[0]!.id) || node.associatedZoneIds?.includes(zones[0]!.id)),
    )
    expect(suppliers).toHaveLength(1)
    expect(suppliers[0]!.plateRole === 'base' || !suppliers[0]!.autoFromWalls).toBe(true)
    expect(Math.abs(visible(after) - visible(fixture.nodes))).toBeLessThan(0.01)
  })

  test.each(
    fixtures.filter(({ sceneId }) => ['scene-05', 'scene-08'].includes(sceneId)),
  )('$sceneId IDs do not depend on legacy material representation', ({ nodes }) => {
    const materialized = Object.fromEntries(
      Object.entries(nodes).map(([id, node]) => [
        id,
        node.type === 'slab' && node.material !== undefined
          ? { ...node, material: undefined, slots: { surface: `scene:material_${id}` } }
          : node,
      ]),
    )
    const raw = migrate(nodes),
      resolved = migrate(materialized)
    expect(plates(raw).map((plate) => plate.id)).toEqual(plates(resolved).map((plate) => plate.id))
    if (Object.values(nodes).some((node) => node.type === 'slab' && node.autoFromWalls))
      expect(
        plates(raw).length > 0 ||
          Object.values(nodes)
            .filter((node) => node.type === 'slab' && node.autoFromWalls)
            .every((slab) => raw[slab.id]?.type === 'slab' && !raw[slab.id].autoFromWalls),
      ).toBe(true)
    for (const source of Object.values(nodes)) {
      if (source.type !== 'slab' || source.material === undefined || raw[source.id]) continue
      const retained = Object.values(raw).flatMap((node) =>
        node.type === 'slab'
          ? [node.material]
          : node.type === 'zone'
            ? [node.floor?.finish, ...(node.floor?.regions ?? []).map((region) => region.finish)]
            : [],
      )
      expect(
        retained.some((finish) => JSON.stringify(finish) === JSON.stringify(source.material)),
      ).toBe(true)
    }
  })

  test('recessed legacy construction is byte-identical and its room is excluded', () => {
    const fixture = fixtures.find(({ nodes }) =>
      Object.values(nodes).some((node) => node.type === 'slab' && node.recessed),
    )!
    const before = rooms(fixture.nodes),
      after = migrate(fixture.nodes)
    const pools = Object.values(before).filter(
      (node): node is SlabNode => node.type === 'slab' && node.recessed,
    )
    expect(pools.length).toBeGreaterThan(0)
    for (const pool of pools) {
      expect(after[pool.id]).toEqual(pool)
      for (const plate of plates(after))
        for (const id of plate.zoneIds!)
          expect(
            footprintIoU({ outer: pool.polygon, holes: [] }, slabFootprint(after[id] as ZoneNode)),
          ).toBeLessThan(0.6)
    }
  })

  test.each(['scene-27'])('%s emits every disconnected component with stable IDs', (sceneId) => {
    const fixture = fixtures.find((fixture) => fixture.sceneId === sceneId)!
    const nodes = rooms(fixture.nodes),
      index = createRoomTopologyIndex()
    index.rebuild(nodes)
    const topology = index.getLevelTopology(fixture.levelId)!
    const zones = Object.values(nodes).filter(
      (node): node is ZoneNode => node.type === 'zone' && node.spaceRole === 'room',
    )
    const room = topology.rooms.find((room) => plateFootprint([room]).length > 1)!
    expect(room).toBeDefined()
    const zone = zones.find((zone) => footprintIoU(slabFootprint(zone), slabFootprint(room)) > 0.9)!
    const members = [{ ...room, zone }]
    const footprint = plateFootprint(members)
    const input = {
      levelId: fixture.levelId,
      rooms: members,
      slabs: [] as SlabNode[],
      mintId: (_ids: string[], component = 0) => `slab_component_${component}`,
    }
    const plan = buildFloorPlates(input)
    expect(plan.plates).toHaveLength(footprint.length)
    expect(new Set(plan.plates.map((plate) => plate.id)).size).toBe(footprint.length)
    expect(area(difference(footprint, union(plan.plates.map(slabFootprint))))).toBeLessThan(1e-6)
    expect(buildFloorPlates({ ...input, slabs: plan.plates }).plates).toEqual(plan.plates)
  })

  test('M3 does not adopt an oversized generic zone over a real production face', () => {
    const fixture = fixtures.find(({ sceneId }) => sceneId === 'scene-03')!
    const generic = {
      id: 'zone_generic_site',
      type: 'zone',
      name: 'Site analysis',
      spaceRole: 'generic',
      parentId: fixture.levelId,
      polygon: [
        [-100, -100],
        [100, -100],
        [100, 100],
        [-100, 100],
      ],
      holes: [],
    }
    const migrated = migrateRoomZones({ ...fixture.nodes, [generic.id]: generic })
    expect(migrated.nodes[generic.id]).toBe(generic)
    expect(migrated.createdZoneIds).toHaveLength(1)
    expect(migrated.adoptedZoneIds).not.toContain(generic.id)
  })

  test('snapped production junctions produce the same rooms in M3 and either index insertion order', () => {
    const fixture = fixtures.find(({ sceneId }) => sceneId === 'scene-12')!
    const nodes = rooms(fixture.nodes)
    const forward = createRoomTopologyIndex(),
      reverse = createRoomTopologyIndex()
    forward.rebuild(nodes)
    reverse.rebuild(Object.fromEntries(Object.entries(nodes).reverse()))
    const snapshot = (index: ReturnType<typeof createRoomTopologyIndex>) =>
      index
        .getLevelTopology(fixture.levelId)!
        .rooms.map(({ polygon, holes, spans }) => ({ polygon, holes, spans }))
    expect(snapshot(forward)).toEqual(snapshot(reverse))
    expect(snapshot(forward)).toHaveLength(4)
    const result = plates(migrate(nodes))
    expect(result).toHaveLength(1)
    expect(result[0]!.zoneIds).toHaveLength(4)
  })

  test.each([
    'scene-20',
  ])('%s does not plate a room entirely inside a legacy opening', (sceneId) => {
    const fixture = fixtures.find((fixture) => fixture.sceneId === sceneId)!
    const after = migrate(fixture.nodes)
    for (const plate of plates(after)) {
      expect(area(union([slabFootprint(plate)]))).toBeGreaterThan(1e-6)
      for (const id of plate.zoneIds!) {
        const zone = after[id] as ZoneNode
        expect(
          Object.values(fixture.nodes).some(
            (node) =>
              node.type === 'slab' &&
              node.autoFromWalls &&
              footprintIoU(slabFootprint(node), slabFootprint(zone)) > 0,
          ),
        ).toBe(true)
      }
    }
  })

  test.each([
    'scene-01',
  ])('%s demotes unmatched construction without changing its geometry or id', (sceneId) => {
    const fixture = fixtures.find((fixture) => fixture.sceneId === sceneId)!
    const after = migrate(fixture.nodes)
    let demoted = 0
    for (const source of Object.values(fixture.nodes)) {
      if (
        source.type !== 'slab' ||
        !source.autoFromWalls ||
        !after[source.id] ||
        (after[source.id] as SlabNode).plateRole
      )
        continue
      expectPreservedSlab(fixture.nodes, after, source, true)
      demoted++
    }
    expect(demoted).toBeGreaterThan(0)
  })

  test.each(
    fixtures.filter(({ sceneId }) => sceneId === 'scene-25'),
  )('$sceneId $levelId stored plates cover mitered faces outside existing cutouts', ({ nodes }) => {
    const before = rooms(nodes),
      after = migrate(nodes)
    const walls = Object.values(nodes).filter((node): node is WallNode => node.type === 'wall')
    const miters = calculateLevelMiters(walls),
      faces = extractRooms(walls)
    const stored = plates(after)
    if (!stored.length) {
      for (const source of Object.values(nodes).filter(
        (node) => node.type === 'slab' && node.autoFromWalls,
      ))
        expectPreservedSlab(nodes, after, source, true)
      expect(Math.abs(visible(after) - visible(nodes))).toBeLessThanOrEqual(
        Math.max(1e-6, visible(nodes) * 0.01),
      )
      return
    }
    const cutouts = Object.values(nodes)
      .filter((node): node is SlabNode => node.type === 'slab')
      .flatMap((slab) => (slab.holes ?? []).map((outer) => ({ outer, holes: [] })))
    let checked = 0
    for (const room of faces) {
      const plate = stored.find((plate) =>
        plate.zoneIds!.some(
          (id) =>
            footprintIoU(slabFootprint(before[id] as ZoneNode), {
              outer: room.referencePolygon,
              holes: room.holes,
            }) >= 0.9,
        ),
      )
      if (!plate) continue
      for (const span of room.spans) {
        const wall = walls.find((wall) => wall.id === span.boundaryId)!
        const endpoints = getWallMiterBoundaryPoints(wall, miters)!
        for (let i = 0; i <= 8; i++) {
          const t = span.t0 + ((span.t1 - span.t0) * i) / 8
          const start = span.face === 'a' ? endpoints.startLeft : endpoints.startRight
          const end = span.face === 'a' ? endpoints.endLeft : endpoints.endRight
          const frame = getWallCurveFrameAt(wall, t),
            offset = getWallFaceOffsets(wall)[span.face]
          const p: [number, number] = wall.curveOffset
            ? [frame.point.x + frame.normal.x * offset, frame.point.y + frame.normal.y * offset]
            : [start.x + (end.x - start.x) * t, start.y + (end.y - start.y) * t]
          if (containsPoint(cutouts, p)) continue
          const geometry = stored.map(slabFootprint)
          expect(
            containsPoint(geometry, p) || distanceToBoundary(geometry, p) <= 0.005,
            `${wall.id} ${span.face} ${t}`,
          ).toBe(true)
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(0)
  })
})
