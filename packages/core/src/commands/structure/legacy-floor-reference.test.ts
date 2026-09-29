import { afterEach, expect, test } from 'bun:test'
import { buildFloorPlates, type PlateRoom } from '../../lib/floor-plates'
import { type AnyNode, LevelNode, SlabNode, ZoneNode } from '../../schema'
import { getLevelElevations } from '../../services/storey'
import useScene from '../../store/use-scene'
import { migrateFloorPlates } from '../../utils/floor-plate-migration'
import { rebaseFloorReference } from './rebase-floor-reference'
import { setRoomFloorConstruction } from './set-room-floor-construction'
import { applyToScratch, structureChangeBatch } from './shared'

const polygon: [number, number][] = [
  [0, 0],
  [5, 0],
  [5, 5],
  [0, 5],
]

function scene() {
  const ground = LevelNode.parse({ id: 'level_ground', level: 0, height: 3 })
  const upper = LevelNode.parse({ id: 'level_upper', level: 1, height: 3 })
  const room = ZoneNode.parse({
    id: 'zone_ground',
    parentId: ground.id,
    name: 'Room',
    spaceRole: 'room',
    polygon,
  })
  const upstairs = ZoneNode.parse({
    id: 'zone_upper',
    parentId: upper.id,
    name: 'Upper room',
    spaceRole: 'room',
    polygon,
  })
  const base = SlabNode.parse({
    id: 'slab_ground',
    parentId: ground.id,
    polygon,
    elevation: 0.2,
    thickness: 0.05,
    referenceFloorElevation: 0.2,
    plateRole: 'base',
    boundary: 'auto',
    autoFromWalls: true,
    zoneIds: [room.id],
  })
  const upperPlate = SlabNode.parse({
    id: 'slab_upper',
    parentId: upper.id,
    polygon,
    elevation: 0.05,
    plateRole: 'base',
    boundary: 'auto',
    autoFromWalls: true,
    zoneIds: [upstairs.id],
  })
  ground.children = [room.id, base.id]
  upper.children = [upstairs.id, upperPlate.id]
  return Object.fromEntries(
    [ground, upper, room, upstairs, base, upperPlate].map((node) => [node.id, node]),
  ) as Record<string, AnyNode>
}

afterEach(() => {
  useScene.getState().unloadScene()
  useScene.temporal.getState().clear()
})

test('reference rebase is one atomic plan and keeps upper world placement', () => {
  const nodes = scene()
  const before = getLevelElevations(nodes).get('level_upper')!.baseY
  const plan = rebaseFloorReference(nodes, {
    slabId: 'slab_ground',
    referenceFloorElevation: 0.05,
  })
  expect(plan.conflicts).toBeUndefined()
  const next = applyToScratch(nodes, structureChangeBatch(plan.changes))
  expect((next.slab_ground as SlabNode).elevation).toBe(0.2)
  expect((next.slab_ground as SlabNode).referenceFloorElevation).toBe(0.05)
  expect(getLevelElevations(next).get('level_upper')!.baseY).toBeCloseTo(before)
  expect(plan.changes).toHaveLength(2)
})

test('shared upper storeys require a grouped reference rebase', () => {
  const nodes = scene()
  const garage = ZoneNode.parse({
    id: 'zone_garage',
    parentId: 'level_ground',
    name: 'Garage',
    spaceRole: 'room',
    polygon: [
      [5, 0],
      [10, 0],
      [10, 5],
      [5, 5],
    ],
  })
  nodes[garage.id] = garage
  const second = SlabNode.parse({
    ...(nodes.slab_ground as SlabNode),
    id: 'slab_garage',
    polygon: [
      [5, 0],
      [10, 0],
      [10, 5],
      [5, 5],
    ],
    zoneIds: [garage.id],
  })
  nodes[second.id] = second
  nodes.slab_upper = {
    ...(nodes.slab_upper as SlabNode),
    polygon: [
      [0, 0],
      [10, 0],
      [10, 5],
      [0, 5],
    ],
  }
  nodes.zone_upper = {
    ...(nodes.zone_upper as ZoneNode),
    polygon: (nodes.slab_upper as SlabNode).polygon,
  }
  const before = getLevelElevations(nodes).get('level_upper')!.baseY
  expect(
    rebaseFloorReference(nodes, {
      slabId: 'slab_ground',
      referenceFloorElevation: 0.05,
    }).conflicts?.[0]?.code,
  ).toBe('floor-reference-shared-storey')
  const grouped = rebaseFloorReference(nodes, {
    slabIds: ['slab_ground', second.id],
    referenceFloorElevation: 0.05,
  })
  expect(grouped.conflicts).toBeUndefined()
  const next = applyToScratch(nodes, structureChangeBatch(grouped.changes))
  expect(getLevelElevations(next).get('level_upper')!.baseY).toBeCloseTo(before)
  expect((next.slab_garage as SlabNode).referenceFloorElevation).toBe(0.05)
})

test('room floor construction and reference rebase each undo and redo atomically', () => {
  const nodes = scene()
  useScene.setState({ nodes, rootNodeIds: ['level_ground', 'level_upper'], readOnly: false })
  useScene.temporal.getState().clear()
  const edit = setRoomFloorConstruction(nodes, {
    zoneId: 'zone_ground',
    patch: { thickness: 0.1 },
  })
  useScene.getState().applyNodeChanges(structureChangeBatch(edit.changes))
  expect((useScene.getState().nodes.slab_ground as SlabNode).thickness).toBe(0.1)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes).toEqual(nodes)
  useScene.temporal.getState().redo()
  expect((useScene.getState().nodes.slab_ground as SlabNode).thickness).toBe(0.1)

  const beforeRebase = useScene.getState().nodes
  const rebase = rebaseFloorReference(beforeRebase, {
    slabId: 'slab_ground',
    referenceFloorElevation: 0.05,
  })
  useScene.getState().applyNodeChanges(structureChangeBatch(rebase.changes))
  expect((useScene.getState().nodes.slab_ground as SlabNode).referenceFloorElevation).toBe(0.05)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes).toEqual(beforeRebase)
  useScene.temporal.getState().redo()
  expect((useScene.getState().nodes.slab_ground as SlabNode).referenceFloorElevation).toBe(0.05)
})

test('room construction edits the associated footprint or authored slab in one plan', () => {
  const nodes = scene()
  const platePlan = setRoomFloorConstruction(nodes, {
    zoneId: 'zone_ground',
    patch: { thickness: 0.1 },
  })
  expect(platePlan.conflicts).toEqual([])
  expect(
    platePlan.changes.some((change) => change.op === 'update' && change.id === 'slab_ground'),
  ).toBe(true)
  const authored = SlabNode.parse({
    id: 'slab_authored',
    parentId: 'level_ground',
    polygon,
    thickness: 0.05,
  })
  const room = nodes.zone_ground as ZoneNode
  const manualNodes = {
    ...nodes,
    [authored.id]: authored,
    [room.id]: { ...room, floor: { ...room.floor, sourceSlabId: authored.id } },
  }
  const manualPlan = setRoomFloorConstruction(manualNodes, {
    zoneId: room.id,
    patch: { thickness: 0.12 },
  })
  expect(manualPlan.changes).toEqual([{ op: 'update', id: authored.id, data: { thickness: 0.12 } }])
  const chosen = setRoomFloorConstruction(manualNodes, {
    zoneId: room.id,
    slabId: authored.id,
    patch: { thickness: 0.12 },
  })
  expect(chosen.changes).toEqual([{ op: 'update', id: authored.id, data: { thickness: 0.12 } }])
  const raised = setRoomFloorConstruction(manualNodes, {
    zoneId: room.id,
    patch: { floorHeight: 0.35 },
  })
  const moved = applyToScratch(manualNodes, structureChangeBatch(raised.changes))
  expect((moved[authored.id] as SlabNode).elevation).toBe(0.35)
  expect((moved[room.id] as ZoneNode).floor?.sourceSlabId).toBe(authored.id)
})

test('old legacyFloor is migrated once into the normal reference datum', () => {
  const nodes = scene()
  const plate = nodes.slab_ground as SlabNode
  const { referenceFloorElevation: _reference, ...legacy } = plate
  const first = migrateFloorPlates({ ...nodes, [plate.id]: { ...legacy, legacyFloor: 0.2 } }).nodes
  expect(first[plate.id]).toMatchObject({ referenceFloorElevation: 0.2 })
  expect(first[plate.id]).not.toHaveProperty('legacyFloor')
  expect(migrateFloorPlates(first).nodes).toBe(first)
})

test('split footprints inherit their reference and unequal references remain separate on merge', () => {
  const context = { revision: 0, walls: new Map(), wallFootprints: new Map() }
  const room = (id: string, x0: number, x1: number): PlateRoom => {
    const polygon: [number, number][] = [
      [x0, 0],
      [x1, 0],
      [x1, 5],
      [x0, 5],
    ]
    const zone = ZoneNode.parse({
      id,
      name: id,
      parentId: 'level_ground',
      spaceRole: 'room',
      polygon,
    })
    return {
      id,
      zone,
      polygon,
      holes: [],
      spans: [],
      context,
    }
  }
  const source = SlabNode.parse({
    id: 'slab_source',
    parentId: 'level_ground',
    polygon: [
      [0, 0],
      [10, 0],
      [10, 5],
      [0, 5],
    ],
    boundary: 'auto',
    autoFromWalls: true,
    plateRole: 'base',
    referenceFloorElevation: 0.2,
  })
  const mintId = (ids: string[], component = 0) => `slab_${ids.join('_')}_${component}`
  const split = buildFloorPlates({
    levelId: 'level_ground',
    rooms: [room('zone_left', 0, 4), room('zone_right', 6, 10)],
    slabs: [source],
    mintId,
  })
  expect(split.plates).toHaveLength(2)
  expect(split.plates.map((plate) => plate.referenceFloorElevation)).toEqual([0.2, 0.2])

  const right = SlabNode.parse({
    ...source,
    id: 'slab_right',
    polygon: [
      [5, 0],
      [10, 0],
      [10, 5],
      [5, 5],
    ],
    referenceFloorElevation: 0.4,
  })
  const left = {
    ...source,
    polygon: [
      [0, 0],
      [5, 0],
      [5, 5],
      [0, 5],
    ] as [number, number][],
  }
  const merged = buildFloorPlates({
    levelId: 'level_ground',
    rooms: [room('zone_left', 0, 5), room('zone_right', 5, 10)],
    slabs: [left, right],
    mintId,
  })
  expect(merged.plates).toHaveLength(2)
  expect(merged.plates.map((plate) => plate.referenceFloorElevation).sort()).toEqual([0.2, 0.4])
})
