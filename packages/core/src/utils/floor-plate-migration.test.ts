import { expect, spyOn, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { slabFootprint } from '../lib/floor-plates'
import * as footprints from '../lib/level-footprints'
import { plateFootprint } from '../lib/level-footprints'
import { getOpeningFloorDatum } from '../lib/opening-floor-datum'
import * as polygons from '../lib/polygon-boolean'
import { area, difference, union } from '../lib/polygon-boolean'
import { getRenderableSlabPolygon } from '../lib/slab-polygon'
import { createRoomTopologyIndex } from '../lib/space-detection'
import type { AnyNode, ZoneNode } from '../schema'
import { DoorNode, LevelNode, SlabNode, WallNode } from '../schema'
import {
  migrateCeilingRoomLinks,
  migrateFloorPlates,
  migrateRoomZones,
  migrateSlabSlots,
  reconcileStructureOnLoad,
} from './scene-migrations'

function prepare(walls: WallNode[]) {
  const level = LevelNode.parse({ id: 'level_test', children: walls.map((wall) => wall.id) })
  const nodes = migrateCeilingRoomLinks(
    migrateRoomZones(Object.fromEntries([level, ...walls].map((node) => [node.id, node]))).nodes,
  ).nodes as Record<string, AnyNode>
  const zones = Object.values(nodes).filter((node): node is ZoneNode => node.type === 'zone')
  for (const [i, zone] of zones.entries()) {
    const slab = SlabNode.parse({
      id: `slab_source_${i}`,
      parentId: level.id,
      polygon: zone.polygon,
      holes: zone.holes,
      holeMetadata: zone.holes.map(() => ({ source: 'room' })),
      autoFromWalls: true,
      slots: { surface: `library:finish-${i}`, side: 'library:concrete' },
    })
    nodes[slab.id] = slab
    ;(nodes[level.id] as LevelNode).children.push(slab.id)
  }
  return { nodes, zones }
}
function twoRooms() {
  const ring: [number, number][] = [
    [0, 0],
    [8, 0],
    [8, 4],
    [0, 4],
  ]
  return prepare([
    ...ring.map((start, i) =>
      WallNode.parse({
        id: `wall_${i}`,
        parentId: 'level_test',
        start,
        end: ring[(i + 1) % 4],
        thickness: 0.2,
      }),
    ),
    WallNode.parse({
      id: 'wall_divider',
      parentId: 'level_test',
      start: [2, 0],
      end: [2, 4],
      thickness: 0.2,
    }),
  ])
}
function slabs(nodes: Record<string, unknown>) {
  return Object.values(nodes).filter((node): node is SlabNode => (node as AnyNode).type === 'slab')
}

test('one complete manual slab spanning rooms becomes one owned floor volume', () => {
  const { nodes, zones } = twoRooms()
  for (const slab of slabs(nodes)) {
    delete nodes[slab.id]
    ;(nodes.level_test as LevelNode).children = (nodes.level_test as LevelNode).children.filter(
      (id) => id !== slab.id,
    )
  }
  const shared = SlabNode.parse({
    id: 'slab_shared_manual',
    parentId: 'level_test',
    polygon: [
      [0, 0],
      [8, 0],
      [8, 4],
      [0, 4],
    ],
    slots: { surface: 'library:shared-floor' },
  })
  nodes[shared.id] = shared
  ;(nodes.level_test as LevelNode).children.push(shared.id)
  const first = reconcileStructureOnLoad(migrateFloorPlates(nodes).nodes, nodes).nodes
  expect(slabs(first)).toHaveLength(1)
  expect(first[shared.id]).toMatchObject({
    plateRole: 'base',
    zoneIds: zones.map((zone) => zone.id).sort(),
  })
  for (const zone of zones) {
    const room = first[zone.id] as ZoneNode
    expect(room.floor?.sourceSlabId).toBeUndefined()
    expect(room.floor?.finish).toBe('library:shared-floor')
  }
  expect(reconcileStructureOnLoad(first).nodes).toEqual(first)
})

test('load clears a missing floor supplier so the room can regain its floor', () => {
  const { nodes, zones } = twoRooms()
  const room = zones[0]!
  nodes[room.id] = {
    ...room,
    floor: { ...room.floor, sourceSlabId: 'slab_missing_supplier' },
  }
  const migrated = migrateFloorPlates(nodes).nodes
  expect((migrated[room.id] as ZoneNode).floor?.sourceSlabId).toBeUndefined()
  const loaded = reconcileStructureOnLoad(migrated).nodes
  expect(
    slabs(loaded).some((slab) => slab.plateRole === 'base' && slab.zoneIds?.includes(room.id)),
  ).toBe(true)
  expect(migrateFloorPlates(migrated).nodes).toBe(migrated)
  expect(reconcileStructureOnLoad(loaded).nodes).toEqual(loaded)
})

test('a small legacy auto slab remains the room supplier without growing into a new floor', () => {
  const { nodes, zones } = twoRooms()
  const room = zones[0]!
  const source = slabs(nodes).find(
    (slab) => JSON.stringify(slab.polygon) === JSON.stringify(room.polygon),
  )!
  const cx = room.polygon.reduce((sum, [x]) => sum + x, 0) / room.polygon.length
  const cz = room.polygon.reduce((sum, [, z]) => sum + z, 0) / room.polygon.length
  nodes[source.id] = {
    ...source,
    polygon: [
      [cx - 0.5, cz - 0.5],
      [cx + 0.5, cz - 0.5],
      [cx + 0.5, cz + 0.5],
      [cx - 0.5, cz + 0.5],
    ],
  }
  const first = migrateFloorPlates(nodes).nodes
  expect((first[room.id] as ZoneNode).hasFloor).not.toBe(false)
  expect((first[room.id] as ZoneNode).floor?.sourceSlabId).toBe(source.id)
  expect(first[source.id]).toMatchObject({
    autoFromWalls: false,
    polygon: (nodes[source.id] as SlabNode).polygon,
  })
  expect(
    slabs(first).some((slab) => slab.plateRole === 'base' && slab.zoneIds?.includes(room.id)),
  ).toBe(false)
  expect(migrateFloorPlates(first).nodes).toBe(first)
})

test('an outside deck under one wall does not lift the migrated footprint above its rooms', () => {
  const { nodes, zones } = twoRooms()
  const deck = SlabNode.parse({
    id: 'slab_outside_deck',
    parentId: 'level_test',
    polygon: [
      [7.9, 0.5],
      [8.5, 0.5],
      [8.5, 3.5],
      [7.9, 3.5],
    ],
    elevation: 0.5,
  })
  const door = DoorNode.parse({
    id: 'door_equal_floors',
    parentId: 'wall_divider',
    position: [2, 1, 0],
    height: 2,
    width: 0.8,
  })
  nodes[deck.id] = deck
  nodes[door.id] = door
  nodes.wall_divider = { ...nodes.wall_divider, children: [door.id] } as WallNode
  ;(nodes.level_test as LevelNode).children.push(deck.id)
  const load = (source: Record<string, AnyNode>) =>
    reconcileStructureOnLoad(migrateFloorPlates(source).nodes, source).nodes
  const first = load(nodes)
  expect(slabs(first).find((slab) => slab.plateRole === 'base')?.elevation).toBeCloseTo(0.05)
  expect(slabs(first).filter((slab) => slab.plateRole && slab.plateRole !== 'base')).toEqual([])
  for (const zone of zones) expect((first[zone.id] as ZoneNode).floor?.elevation).toBeCloseTo(0.05)
  expect(getOpeningFloorDatum(first.wall_divider as WallNode, door, first)).toBeCloseTo(0.05)
  expect(slabs(first).every((slab) => slab.floorHeight === undefined)).toBe(true)
  expect(load(first)).toEqual(first)
})

test('reloading an unchanged room preserves fractional finish-region coordinates', () => {
  const { nodes, zones } = twoRooms()
  const first = reconcileStructureOnLoad(migrateFloorPlates(nodes).nodes, nodes).nodes
  const zone = first[zones[0]!.id] as ZoneNode
  const x = Math.min(...zone.polygon.map(([x]) => x)) + 1 / 3
  const regions = [
    {
      id: 'fractional-finish',
      polygon: [
        [x, 1],
        [x + 1 / 3, 1],
        [x + 1 / 3, 2],
        [x, 2],
      ] as [number, number][],
      finish: 'library:tile',
    },
  ]
  const painted = { ...first, [zone.id]: { ...zone, floor: { ...zone.floor, regions } } }
  const loaded = reconcileStructureOnLoad(painted).nodes
  expect((loaded[zone.id] as ZoneNode).floor?.regions).toEqual(regions)
  expect(reconcileStructureOnLoad(loaded).nodes).toEqual(loaded)
})

test('M4/M5 are pure, deterministic and idempotent; finishes, holes and hosts survive', () => {
  const { nodes, zones } = twoRooms()
  const sources = slabs(nodes)
  nodes.wall_0 = { ...nodes.wall_0, supportSlabId: sources[0]!.id } as AnyNode
  nodes.stair_ref = { id: 'stair_ref', type: 'stair', deckSlabId: sources[1]!.id } as AnyNode
  const minX = Math.min(...sources[0]!.polygon.map(([x]) => x))
  const hole: [number, number][] = [
    [minX + 0.5, 1],
    [minX + 1, 1],
    [minX + 1, 2],
    [minX + 0.5, 2],
  ]
  nodes[sources[0]!.id] = {
    ...sources[0]!,
    holes: [hole],
    holeMetadata: [{ source: 'stair', stairId: 'stair_ref' }],
  }
  const bytes = JSON.stringify(nodes)
  const first = migrateFloorPlates(nodes)
  expect(JSON.stringify(nodes)).toBe(bytes)
  expect(migrateFloorPlates(Object.fromEntries(Object.entries(nodes).reverse()))).toEqual(first)
  expect(migrateFloorPlates(first.nodes).nodes).toBe(first.nodes)
  const plate = slabs(first.nodes)[0]!
  expect(slabs(first.nodes)).toHaveLength(1)
  expect(plate.slots?.surface).toBe(
    sources.reduce((largest, source) =>
      area([slabFootprint(source)]) > area([slabFootprint(largest)]) ? source : largest,
    ).slots!.surface,
  )
  expect(plate.zoneIds).toEqual(zones.map((zone) => zone.id).sort())
  expect(plate.holeMetadata).toEqual([{ source: 'stair', stairId: 'stair_ref' }])
  expect(first.nodes.wall_0).toMatchObject({ supportSlabId: plate.id })
  expect((first.nodes.stair_ref as { deckSlabId?: string }).deckSlabId).toBeUndefined()
  sources.forEach((source, i) => {
    if (source.id !== plate.id) expect(first.nodes[source.id]).toBeUndefined()
    else expect(first.nodes[source.id]).toMatchObject({ plateRole: 'base' })
    expect(first.nodes[zones[i]!.id]).toMatchObject({ floor: { finish: source.slots!.surface } })
  })
  const slots = migrateSlabSlots(first.nodes)
  expect(slabs(slots.nodes)[0]!.slots).toMatchObject({
    edge: 'library:concrete',
    riser: 'library:concrete',
    underside: 'library:concrete',
  })
  expect(migrateSlabSlots(slots.nodes).nodes).toBe(slots.nodes)
})

test.each([
  'elevation',
  'thickness',
  'fillToTerrain',
] as const)('legacy %s keeps its wall support or derives one base', (field) => {
  const { nodes } = twoRooms()
  const source = slabs(nodes)[0]!
  nodes[source.id] = {
    ...source,
    [field]: field === 'elevation' || field === 'thickness' ? 0.4 : true,
  }
  const result = migrateFloorPlates(nodes)
  expect(slabs(result.nodes)).toHaveLength(field === 'elevation' ? 2 : 1)
  if (field === 'elevation') {
    expect(result.nodes[source.id]).toMatchObject({
      elevation: 0.4,
      autoFromWalls: false,
      polygon: source.polygon,
    })
    expect(slabs(result.nodes).some((slab) => slab.plateRole === 'base')).toBe(false)
  } else
    expect(slabs(result.nodes).find((slab) => slab.plateRole === 'base')?.zoneIds).toHaveLength(2)
  expect(migrateFloorPlates(result.nodes).nodes).toBe(result.nodes)
})

test('hand-split floor becomes a finish region; a raised platform stays manual', () => {
  const { nodes, zones } = twoRooms()
  const zone = zones[0]!
  const manual = SlabNode.parse({
    id: 'slab_manual',
    parentId: 'level_test',
    polygon: zone.polygon,
    elevation: 0.07,
    slots: { surface: 'library:tile' },
  })
  const raised = { ...manual, id: 'slab_raised' as const, elevation: 0.4 }
  nodes[manual.id] = manual
  nodes[raised.id] = raised
  ;(nodes.level_test as LevelNode).children.push(manual.id, raised.id)
  const result = migrateFloorPlates(nodes)
  expect(result.nodes[manual.id]).toBeUndefined()
  expect(result.nodes[raised.id]).toMatchObject(raised)
  expect((result.nodes[raised.id] as SlabNode).associatedZoneIds).toContain(zone.id)
  expect(result.nodes[zone.id]).toMatchObject({
    floor: { regions: [{ id: manual.id, polygon: manual.polygon, finish: 'library:tile' }] },
  })
  expect((result.nodes.level_test as LevelNode).children).not.toContain(manual.id)
})

test('M5 preserves explicit new slots', () => {
  const slab = SlabNode.parse({
    id: 'slab_slots',
    polygon: [],
    slots: { side: 'old', edge: 'new' },
  })
  expect((migrateSlabSlots({ [slab.id]: slab }).nodes[slab.id] as SlabNode).slots).toEqual({
    side: 'old',
    edge: 'new',
    riser: 'old',
    underside: 'old',
  })
})

const corpus = new URL('../lib/__fixtures__/plate-corpus/', import.meta.url)
for (const file of readdirSync(corpus).filter((name) => name.endsWith('.json'))) {
  test(`M4 corpus ${file}: level union area, deterministic ids and idempotence`, () => {
    const geometry = JSON.parse(readFileSync(new URL(file, corpus), 'utf8')) as Partial<WallNode>[]
    const walls = geometry.map((wall, i) =>
      WallNode.parse({ ...wall, id: `wall_${i}`, parentId: 'level_test' }),
    )
    const { nodes } = prepare(walls)
    const before = slabs(nodes)
    const legacy = union(
      before.map((slab) => ({
        outer: getRenderableSlabPolygon(slab, {
          walls,
          siblingSlabs: before.filter((other) => other.id !== slab.id),
        }),
        holes: slab.holes,
      })),
    )
    const topology = createRoomTopologyIndex()
    topology.rebuild(nodes)
    const rooms = topology.getLevelTopology('level_test')!.rooms
    const fullBefore = union(rooms.flatMap((room) => plateFootprint([room])))
    const wallFootprints = union([...rooms[0]!.context.wallFootprints.values()])
    const result = migrateFloorPlates(nodes)
    const migratedSlabs = slabs(result.nodes)
    const migrated = union(
      migratedSlabs.map((slab) => ({
        outer: getRenderableSlabPolygon(slab, {
          walls,
          siblingSlabs: migratedSlabs.filter((other) => other.id !== slab.id),
        }),
        holes: slab.holes,
      })),
    )
    // A retained authored floor keeps its original extent; derived footprints fill the wall bands.
    const expectedFootprint = slabs(result.nodes).some((slab) => slab.plateRole)
      ? fullBefore
      : legacy
    expect(
      Math.abs(area(migrated) - area(expectedFootprint)) / area(expectedFootprint),
    ).toBeLessThan(0.01)
    const visibleBefore = difference(legacy, wallFootprints)
    const visibleAfter = difference(migrated, wallFootprints)
    const visibleChange =
      area(difference(visibleAfter, visibleBefore)) + area(difference(visibleBefore, visibleAfter))
    expect(visibleChange / area(visibleBefore)).toBeLessThan(0.01)
    expect(migrateFloorPlates(result.nodes).nodes).toBe(result.nodes)
    expect(
      migrateFloorPlates(Object.fromEntries(Object.entries(nodes).reverse())).plateIds,
    ).toEqual(result.plateIds)
  })
}

test('manual finish regions preserve cutouts and inline material references', () => {
  const { nodes, zones } = twoRooms()
  const room = zones[0]!
  const minX = Math.min(...room.polygon.map(([x]) => x))
  const manual = SlabNode.parse({
    id: 'slab_cutout',
    parentId: 'level_test',
    polygon: room.polygon,
    holes: [
      [
        [minX + 0.5, 1],
        [minX + 1, 1],
        [minX + 1, 2],
        [minX + 0.5, 2],
      ],
    ],
    material: { properties: { color: '#123456' } },
  })
  nodes[manual.id] = manual
  const result = migrateFloorPlates(nodes)
  const regions = (result.nodes[room.id] as ZoneNode).floor!.regions!
  expect(area(union(regions.map((region) => region.polygon)))).toBeCloseTo(
    area([slabFootprint(manual)]),
  )
  expect(regions[0]!.finish).toEqual(manual.material)
  expect(result.nodes[manual.id]).toBeUndefined()
  const plate = slabs(result.nodes).find((slab) => slab.boundary === 'auto')!
  expect(plate.holes).toEqual([])
  expect(plate.holeMetadata).toEqual([])
  expect(slabs(result.nodes).some((slab) => slab.autoFromWalls === false)).toBe(false)
})

test('M4 retains suppressed legacy sources as manual construction when no plate replaces them', () => {
  const { nodes, zones } = twoRooms()
  const sources = slabs(nodes)
  const manual = SlabNode.parse({
    id: 'slab_cover',
    parentId: 'level_test',
    polygon: [
      [-1, -1],
      [9, -1],
      [9, 5],
      [-1, 5],
    ],
    elevation: 0.4,
  })
  nodes[manual.id] = manual
  nodes.wall_0 = { ...nodes.wall_0, supportSlabId: sources[0]!.id } as AnyNode
  const result = migrateFloorPlates(nodes)
  expect(slabs(result.nodes).filter((slab) => slab.plateRole !== 'base')).toHaveLength(
    sources.length + 1,
  )
  expect(result.nodes[manual.id]).toMatchObject(manual)
  expect((result.nodes[manual.id] as SlabNode).associatedZoneIds).toEqual(
    zones.map((zone) => zone.id).sort(),
  )
  for (const source of sources) {
    expect(result.nodes[source.id]).toMatchObject({
      autoFromWalls: false,
      polygon: source.polygon,
      metadata: { plateMigration: { demoted: 'manual-coverage' } },
    })
  }
  expect((result.nodes.wall_0 as WallNode).supportSlabId).toBe(sources[0]!.id)
  expect(migrateFloorPlates(result.nodes).nodes).toBe(result.nodes)
})

test('M4 rolls back a failing level, warns once, and leaves its legacy slabs and finishes intact', () => {
  const { nodes } = twoRooms()
  const failing = Object.fromEntries(
    Object.entries(nodes).map(([id, node]) => [
      id === 'level_test' ? 'level_failure_m4' : id,
      node.type === 'level'
        ? { ...node, id: 'level_failure_m4' }
        : { ...node, parentId: 'level_failure_m4' },
    ]),
  )
  const bytes = JSON.stringify(failing)
  const warning = spyOn(console, 'warn').mockImplementation(() => {})
  const clip = spyOn(footprints, 'plateFootprint').mockImplementation(() => {
    throw new Error('fixture union failure')
  })
  try {
    const first = migrateFloorPlates(failing).nodes
    expect(first).toMatchObject(migrateSlabSlots(failing).nodes)
    expect(migrateFloorPlates(first).nodes).toBe(first)
    expect(JSON.stringify(failing)).toBe(bytes)
    expect(
      warning.mock.calls.filter(
        ([message]) => message === '[floor plates] Keeping existing level construction',
      ),
    ).toHaveLength(1)
  } finally {
    clip.mockRestore()
    warning.mockRestore()
  }
})

test('a curved finish extending beyond the floor remains separate construction', () => {
  const polygon: [number, number][] = [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ]
  const { nodes, zones } = prepare(
    polygon.map((start, i) =>
      WallNode.parse({
        id: `wall_curved_${i}`,
        parentId: 'level_test',
        start,
        end: polygon[(i + 1) % 4],
        curveOffset: i === 0 ? 0.4 : 0,
      }),
    ),
  )
  const zone = zones[0]!
  const near = SlabNode.parse({
    id: 'slab_nearly_inside',
    parentId: 'level_test',
    polygon: zone.polygon.map(([x, z]) => [x, z + 0.0001]),
    slots: { surface: 'library:tile' },
  })
  const pool = SlabNode.parse({
    ...near,
    id: 'slab_pool',
    recessed: true,
    polygon: [
      [1, 1],
      [2, 1],
      [2, 2],
      [1, 2],
    ],
  })
  nodes[near.id] = near
  nodes[pool.id] = pool
  const result = migrateFloorPlates(nodes)
  expect(result.nodes[near.id]).toMatchObject({ autoFromWalls: false })
  expect(result.nodes[pool.id]).toBe(pool)
})

test('M5 preserves side repaint across reload without overwriting explicit classified slots', () => {
  const slab = SlabNode.parse({ id: 'slab_repaint', polygon: [], slots: { side: 'scene:old' } })
  const migrated = migrateSlabSlots({ [slab.id]: slab }).nodes[slab.id] as SlabNode
  const painted = { ...migrated, slots: { ...migrated.slots, side: 'scene:new' } }
  const nodes = { [slab.id]: painted }
  expect(migrateSlabSlots(nodes).nodes).toBe(nodes)
  expect(painted.slots).toMatchObject({
    side: 'scene:new',
    edge: 'scene:old',
    riser: 'scene:old',
    underside: 'scene:old',
  })
})

test('hasFloor false demotes its legacy floor without generating a plate for that room', () => {
  const { nodes, zones } = twoRooms()
  const zone = zones[0]!
  const source = slabs(nodes).find(
    (slab) => JSON.stringify(slab.polygon) === JSON.stringify(zone.polygon),
  )!
  nodes[zone.id] = { ...zone, hasFloor: false }
  const after = migrateFloorPlates(nodes).nodes
  expect(after[source.id]).toEqual({
    ...(migrateSlabSlots({ [source.id]: source }).nodes[source.id] as SlabNode),
    autoFromWalls: false,
    associatedZoneIds: [zone.id],
    metadata: { ...source.metadata, plateMigration: { demoted: 'has-floor-disabled' } },
  })
  expect(
    slabs(after)
      .filter((slab) => slab.boundary === 'auto')
      .flatMap((slab) => slab.zoneIds!),
  ).not.toContain(zone.id)
  expect(migrateFloorPlates(after).nodes).toBe(after)
})

test('M4 keeps an entire matched source when only an unrelated manual slab covers its residual', () => {
  const { nodes, zones } = twoRooms()
  const source = slabs(nodes).find((slab) => Math.min(...slab.polygon.map(([x]) => x)) === 0)!
  const extended = {
    ...source,
    metadata: { authored: true },
    polygon: source.polygon.map(([x, z]): [number, number] => [x === 0 ? -1 : x, z]),
  }
  nodes[source.id] = extended
  const manual = SlabNode.parse({
    id: 'slab_residual_cover',
    parentId: 'level_test',
    polygon: [
      [-1, 0],
      [0, 0],
      [0, 4],
      [-1, 4],
    ],
  })
  nodes[manual.id] = manual
  nodes.wall_0 = { ...nodes.wall_0, supportSlabId: source.id } as AnyNode
  const result = migrateFloorPlates(nodes)
  expect(result.plateIds).toEqual([])
  expect(result.nodes[source.id]).toMatchObject({
    autoFromWalls: false,
    associatedZoneIds: [zones.find((zone) => Math.min(...zone.polygon.map(([x]) => x)) === 0)!.id],
    metadata: { authored: true, plateMigration: { demoted: expect.any(String) } },
  })
  expect(result.nodes[manual.id]).toMatchObject(manual)
  expect((result.nodes[manual.id] as SlabNode).associatedZoneIds).toEqual([])
  expect((result.nodes.wall_0 as WallNode).supportSlabId).toBe(source.id)
  expect(migrateFloorPlates(result.nodes).nodes).toBe(result.nodes)
})

test('M4 preserves sources and records a reason when coverage normalization fails', () => {
  const { nodes } = twoRooms()
  const sources = slabs(nodes)
  const original = polygons.difference
  const clipping = spyOn(polygons, 'difference').mockImplementation((a, b, options) => {
    if (options?.throwOnError && Array.isArray(b) && b.length === 0)
      throw new Error('fixture coverage failure')
    return original(a, b, options)
  })
  try {
    const result = migrateFloorPlates(nodes)
    expect(result.plateIds.length).toBeGreaterThan(0)
    for (const source of sources)
      expect(result.nodes[source.id]).toEqual({
        ...(migrateSlabSlots({ [source.id]: source }).nodes[source.id] as SlabNode),
        autoFromWalls: false,
        associatedZoneIds: Object.values(result.nodes)
          .filter(
            (node): node is ZoneNode =>
              node.type === 'zone' &&
              area(polygons.intersection(slabFootprint(node), slabFootprint(source))) > 1e-4,
          )
          .map((zone) => zone.id)
          .sort(),
        metadata: { ...source.metadata, plateMigration: { demoted: 'coverage-error' } },
      })
    expect(migrateFloorPlates(result.nodes).nodes).toBe(result.nodes)
  } finally {
    clipping.mockRestore()
  }
})

test('legacy mezzanine fascia moves to its zone edge finish and the second load is identical', () => {
  const { nodes, zones } = twoRooms()
  const zone = zones[0]!
  const plate =
    Object.values(nodes).find(
      (node): node is SlabNode => node.type === 'slab' && node.polygon === zone.polygon,
    ) ?? Object.values(nodes).find((node): node is SlabNode => node.type === 'slab')!
  nodes[zone.id] = { ...zone, floor: { support: 'open', elevation: 1.5, thickness: 0.2 } }
  nodes[plate.id] = {
    ...plate,
    boundary: 'auto',
    support: 'open',
    zoneIds: [zone.id],
    elevation: 1.5,
    slots: { side: 'library:legacy-fascia', surface: 'library:legacy-deck' },
  }
  const result = migrateFloorPlates(nodes)
  expect(result.nodes[zone.id]).toMatchObject({
    floorEdgeFinish: 'library:legacy-fascia',
    floor: { finish: 'library:legacy-deck' },
  })
  expect(migrateFloorPlates(result.nodes).nodes).toEqual(result.nodes)
})
