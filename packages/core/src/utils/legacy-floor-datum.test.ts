import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { setRoomFloorConstruction } from '../commands/structure/set-room-floor-construction'
import { automaticFloorHeight, footprintLift } from '../lib/floor-foundation-datum'
import { area, intersection } from '../lib/polygon-boolean'
import { levelBaseElevationAt } from '../lib/terrain-support-query'
import { type AnyNode, LevelNode, SlabNode, WallNode } from '../schema'
import { computeWallSlabSupport } from '../systems/slab/slab-support'
import { legacyWallElevations } from './legacy-wall-datums'
import * as migrations from './scene-migrations'
import { reconcileStructureWithStableIds } from './structure-id'

function load(source: Record<string, unknown>) {
  const vertical = migrations.migrateVerticalSceneNodes(
    migrations.healSceneNodes(migrations.normalizeLegacyStructure(source)).nodes,
  ).nodes
  const rooms = migrations.migrateRoomZones(vertical).nodes
  const plates = migrations.migrateFloorPlates(
    migrations.migrateCeilingRoomLinks(rooms).nodes,
  ).nodes
  const openings = migrations.ensureSceneOpenings(migrations.migrateSlabSlots(plates).nodes).nodes
  const walls = migrations.migrateWallFaceBands(
    migrations.migrateWallFaceKeys(openings).nodes,
  ).nodes
  return {
    legacy: vertical as Record<string, AnyNode>,
    nodes: migrations.reconcileStructureOnLoad(walls, vertical).nodes as Record<string, AnyNode>,
  }
}

const slabsOn = (nodes: Record<string, AnyNode>, levelId: string) =>
  Object.values(nodes).filter(
    (node): node is SlabNode => node.type === 'slab' && node.parentId === levelId,
  )
const wallsOn = (nodes: Record<string, AnyNode>, levelId: string) =>
  Object.values(nodes).filter(
    (node): node is WallNode => node.type === 'wall' && node.parentId === levelId,
  )
const support = (nodes: Record<string, AnyNode>, wall: WallNode) =>
  computeWallSlabSupport(
    wall,
    slabsOn(nodes, wall.parentId!),
    wallsOn(nodes, wall.parentId!),
    wall.supportSlabId,
    undefined,
    levelBaseElevationAt(nodes, wall.parentId!, ...wall.start),
    nodes,
  )

test('a terrace pad under a few walls keeps the house floor at its rooms, with walls where they stood', () => {
  // Trimmed production house: every room floor at 0.05, a 0.15 manual terrace
  // pad outside the ground floor and a 0.15 manual landing upstairs, each under
  // a few boundary walls. They used to lift the whole footprint to 0.20 and
  // turn every room into a sunken one.
  const fixture = JSON.parse(
    readFileSync(
      new URL('../lib/__fixtures__/plate-corpus/review/legacy-terrace-pad.json', import.meta.url),
      'utf8',
    ),
  )
  const { legacy, nodes } = load(fixture.nodes)
  const levels = Object.values(nodes).filter((node) => node.type === 'level')
  expect(levels).toHaveLength(2)
  for (const level of levels) {
    const slabs = slabsOn(nodes, level.id)
    const bases = slabs.filter((slab) => slab.plateRole === 'base')
    expect(slabs.some((slab) => slab.plateRole === 'base' || slab.associatedZoneIds?.length)).toBe(
      true,
    )
    for (const base of bases) {
      expect(base.elevation).toBeCloseTo(0.05, 6)
      expect(base.referenceFloorElevation).toBeUndefined()
    }
    expect(slabs.filter((slab) => slab.plateRole && slab.plateRole !== 'base')).toEqual([])
    const manual = slabs.filter((slab) => !slab.plateRole)
    for (const source of slabsOn(legacy, level.id).filter((slab) => !slab.autoFromWalls))
      expect(manual.find((slab) => slab.id === source.id)).toMatchObject({
        elevation: source.elevation,
        polygon: source.polygon,
      })
    for (const pad of manual.filter(
      (slab) => !slabsOn(legacy, level.id).find((s) => s.id === slab.id)?.autoFromWalls,
    ))
      for (const base of bases)
        expect(
          area(
            intersection(
              { outer: base.polygon, holes: base.holes },
              { outer: pad.polygon, holes: pad.holes },
            ),
          ) > 0.05 && base.elevation - base.thickness >= pad.elevation - 1e-6,
        ).toBe(false)
    const old = legacyWallElevations(
      wallsOn(legacy, level.id),
      slabsOn(legacy, level.id),
      legacy,
      level.id,
    )
    for (const wall of wallsOn(nodes, level.id)) {
      const before = old.get(wall.id)!.elevation
      const after = support(nodes, wall).elevation
      // Walls that stood on the ground now stand on the floor band above it.
      if (Math.abs(after - before) > 1e-6)
        expect([before, after]).toEqual([
          levelBaseElevationAt(nodes, level.id, ...wall.start),
          0.05,
        ])
    }
  }
  expect(load(nodes).nodes).toEqual(nodes)
  expect(reconcileStructureWithStableIds({ nodes }).patches).toEqual([])
})

function legacyRoom(floor: number, inset = 0) {
  const level = LevelNode.parse({ id: 'level_legacy', height: 2.7 })
  const ring: [number, number][] = [
    [0, 0],
    [6, 0],
    [6, 6],
    [0, 6],
  ]
  const walls = ring.map((start, i) =>
    WallNode.parse({
      id: `wall_legacy_${i}`,
      parentId: level.id,
      start,
      end: ring[(i + 1) % 4],
      thickness: 0.2,
    }),
  )
  const slab = SlabNode.parse({
    id: 'slab_legacy_room',
    parentId: level.id,
    autoFromWalls: true,
    elevation: floor,
    polygon: [
      [inset, inset],
      [6 - inset, inset],
      [6 - inset, 6 - inset],
      [inset, 6 - inset],
    ],
  })
  level.children = [...walls.map((wall) => wall.id), slab.id]
  return Object.fromEntries([level, ...walls, slab].map((node) => [node.id, node])) as Record<
    string,
    AnyNode
  >
}

test('a raised legacy floor keeps its top and authored depth without invented ground fill', () => {
  const { legacy, nodes } = load(legacyRoom(0.2))
  const [base, ...others] = slabsOn(nodes, 'level_legacy')
  expect(others).toEqual([])
  expect(base).toMatchObject({
    plateRole: 'base',
    elevation: 0.2,
    referenceFloorElevation: 0.2,
    foundation: { type: 'none' },
  })
  expect(base!.thickness).toBeCloseTo(0.05, 6)
  expect(automaticFloorHeight(nodes, base!)).toBeCloseTo(0.2, 6)
  expect(footprintLift(nodes, base!)).toBe(0)
  const old = legacyWallElevations(
    wallsOn(legacy, 'level_legacy'),
    slabsOn(legacy, 'level_legacy'),
    legacy,
    'level_legacy',
  )
  for (const wall of wallsOn(nodes, 'level_legacy'))
    expect(support(nodes, wall).elevation).toBeCloseTo(old.get(wall.id)!.elevation, 6)
  expect(load(nodes).nodes).toEqual(nodes)
  expect(reconcileStructureWithStableIds({ nodes }).patches).toEqual([])
})

test('walls that stood on the ground under a storey-high legacy floor keep standing there', () => {
  // The legacy floor stops at the walls' inner faces, so the walls stood on the ground.
  const { nodes } = load(legacyRoom(2.55, 0.101))
  const floor = slabsOn(nodes, 'level_legacy')[0]!
  expect(floor).toMatchObject({
    elevation: 2.55,
    thickness: 0.05,
  })
  expect(floor.plateRole === 'base' || floor.associatedZoneIds?.length).toBeTruthy()
  for (const wall of wallsOn(nodes, 'level_legacy')) {
    expect(wall.supportSlabId).toBeUndefined()
    expect(support(nodes, wall).elevation).toBeCloseTo(0, 6)
  }
  expect(load(nodes).nodes).toEqual(nodes)
  expect(reconcileStructureWithStableIds({ nodes }).patches).toEqual([])
})

test('a manual terrace under one wall does not lift the automatic floor of a new room', () => {
  const nodes = legacyRoom(0.05)
  delete nodes.slab_legacy_room
  const level = nodes.level_legacy as LevelNode
  const terrace = SlabNode.parse({
    id: 'slab_terrace',
    parentId: level.id,
    elevation: 0.3,
    thickness: 0.3,
    polygon: [
      [-3, 1],
      [0.1, 1],
      [0.1, 5],
      [-3, 5],
    ],
  })
  nodes[terrace.id] = terrace
  nodes[level.id] = { ...level, children: [...level.children.slice(0, 4), terrace.id] }
  const loaded = migrations.reconcileStructureOnLoad(nodes).nodes as Record<string, AnyNode>
  const base = slabsOn(loaded, level.id).find((slab) => slab.plateRole === 'base')!
  expect(base.elevation).toBeCloseTo(0.05, 6)
  expect(automaticFloorHeight(loaded, base)).toBeCloseTo(0.05, 6)
  expect(loaded[terrace.id]).toBe(terrace)
})

test('a complete manual room floor becomes one editable plate with its identity', () => {
  const source = legacyRoom(0.05)
  const slab = source.slab_legacy_room as SlabNode
  source[slab.id] = { ...slab, autoFromWalls: false, slots: { surface: 'library:oak' } }
  const { nodes } = load(source)
  const floor = nodes[slab.id] as SlabNode
  expect(floor).toMatchObject({
    plateRole: 'base',
    boundary: 'auto',
    thickness: 0.05,
    referenceFloorElevation: 0.05,
  })
  const room = Object.values(nodes).find((node) => node.type === 'zone')!
  if (room.type !== 'zone') throw new Error('room missing')
  expect(floor.zoneIds).toContain(room.id)
  expect(room.floor?.sourceSlabId).toBeUndefined()
  expect(room.floor?.finish).toBe('library:oak')
  expect(
    setRoomFloorConstruction(nodes, { zoneId: room.id, patch: { thickness: 0.12 } }).changes,
  ).toContainEqual({
    op: 'update',
    id: floor.id,
    data: expect.objectContaining({ thickness: 0.12 }),
  })
  expect(load(nodes).nodes).toEqual(nodes)
  expect(reconcileStructureWithStableIds({ nodes }).patches).toEqual([])
})

test('an absorbed manual floor carries its cutout into a floor-opening node', () => {
  const source = legacyRoom(0.05)
  const slab = source.slab_legacy_room as SlabNode
  const hole: [number, number][] = [
    [2, 2],
    [3, 2],
    [3, 3],
    [2, 3],
  ]
  source[slab.id] = {
    ...slab,
    autoFromWalls: false,
    holes: [hole],
    holeMetadata: [{ source: 'manual' }],
  }
  const { nodes } = load(source)
  const floor = nodes[slab.id] as SlabNode
  const opening = Object.values(nodes).find((node) => node.type === 'floor-opening')
  expect(floor.plateRole).toBe('base')
  expect(opening).toMatchObject({ source: 'manual', polygon: hole })
  expect(floor.holes).toEqual([hole])
  expect(floor.holeMetadata).toEqual([{ source: 'floor-opening', openingId: opening!.id }])
  expect(load(nodes).nodes).toEqual(nodes)
  expect(reconcileStructureWithStableIds({ nodes }).patches).toEqual([])
})
