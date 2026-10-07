import { afterEach, expect, test } from 'bun:test'
import { setRoomFloorConstruction } from '../commands/structure/set-room-floor-construction'
import { setZoneIntent } from '../commands/structure/set-zone-intent'
import { applyToScratch, structureChangeBatch } from '../commands/structure/shared'
import {
  type AnyNode,
  CeilingNode,
  DoorNode,
  SeparatorNode,
  type SlabNode,
  WindowNode,
  type ZoneNode,
} from '../schema'
import { assertDerivedNodeWrites, filterDerivedNodeWrites } from '../store/derived-node-guard'
import useScene, { clearSceneHistory } from '../store/use-scene'
import { floorStepFixture } from '../systems/slab/__fixtures__/floor-step'
import { reconcileStructureWithStableIds } from '../utils/structure-id'
import { floorFootprintName } from './floor-footprint-name'
import {
  floorFootprintSupportClass,
  footprintSupportsNode,
  groundFloorConstruction,
} from './floor-foundation-datum'
import { keyedFloorPlateId } from './floor-plate-id'
import { resolveFloorStepFinish } from './floor-step-finish'
import { getOpeningFloorDatum, getOpeningWallCut, wallSupportForNodes } from './opening-floor-datum'
import { computePlateSurfacePartition, plateLevelContext } from './plate-surface'
import { area, containsPoint, intersection } from './polygon-boolean'
import { getRoomBaseElevation } from './room-floor-feasibility'
import { initSpaceDetectionSync } from './space-detection'

const reconcile = (nodes: Record<string, AnyNode>) => ({
  ...reconcileStructureWithStableIds({ nodes }).nodes,
})
const bases = (nodes: Record<string, AnyNode>) =>
  Object.values(nodes).filter((n): n is SlabNode => n.type === 'slab' && n.plateRole === 'base')
const shape = (plate: SlabNode) => ({ outer: plate.polygon, holes: plate.holes })
const zone = (nodes: Record<string, AnyNode>, id: string) => nodes[id] as ZoneNode
function scene(separator = false, low = -0.4) {
  const f = floorStepFixture(separator)
  const nodes = Object.fromEntries(Object.entries(f.nodes).filter(([, n]) => n.type !== 'slab'))
  nodes[f.level.id] = {
    ...f.level,
    height: 3,
    children: f.level.children.filter((id) => nodes[id]),
  }
  nodes[f.zones[1]!.id] = { ...f.zones[1]!, name: 'Lanai', floor: { elevation: low } }
  if (!separator) {
    nodes[f.door.id] = f.door
    nodes[f.divider.id] = { ...f.divider, children: [f.door.id] }
  }
  return { ...f, nodes: reconcile(nodes) }
}
function toggle(nodes: Record<string, AnyNode>, id: string, own: boolean) {
  const plan = setZoneIntent(nodes, {
    zoneId: id,
    patch: { floor: { footprint: own ? 'new' : null } },
  })
  expect(plan.conflicts ?? []).toEqual([])
  return reconcile(applyToScratch(nodes, structureChangeBatch(plan.changes)))
}

test('partition: shared rooms and own singletons have stable IDs and independent construction', () => {
  const s = scene()
  const id = s.zones[1]!.id
  const nodes = toggle(s.nodes, id, true)
  expect(bases(nodes)).toHaveLength(2)
  const own = bases(nodes).find((p) => p.zoneIds?.includes(id))!
  expect(own.id).toBe(keyedFloorPlateId(s.level.id, zone(nodes, id).floor!.footprint!, 0))
  expect(own.elevation).toBe(-0.4)
  expect(zone(nodes, id).floor?.elevation).toBeUndefined()
  expect(floorFootprintName(nodes, own)).toBe('Lanai floor')
  expect(area([shape(bases(nodes).find((p) => p.id !== own.id)!)])).toBeLessThan(
    area([shape(bases(s.nodes)[0]!)]),
  )
  expect(bases(reconcile(nodes))).toEqual(bases(nodes))
  const plan = setRoomFloorConstruction(nodes, {
    zoneId: id,
    patch: { foundationHeight: 0.15, thickness: 0.1, slots: { edge: 'library:red' } },
  })
  expect(plan.conflicts ?? []).toEqual([])
  const edited = reconcile(applyToScratch(nodes, structureChangeBatch(plan.changes)))
  const { grade } = groundFloorConstruction(nodes, own)
  expect((edited[own.id] as SlabNode).elevation).toBeCloseTo(grade + 0.25)
  expect(edited[own.id]).toMatchObject({
    thickness: 0.1,
    slots: { edge: 'library:red' },
  })
})

test.each([
  [0.05, 0.05, 0],
  [0.05, 0.3, 1],
])('own neighbours elect higher floor then lowest zone id (%s/%s)', (a, b, owner) => {
  const s = scene(false, b)
  for (const [i, elevation] of [a, b].entries()) {
    const z = zone(s.nodes, s.zones[i]!.id)
    s.nodes[z.id] = { ...z, floor: { footprint: `floor_${i}`, elevation } }
  }
  const nodes = reconcile(s.nodes)
  const plates = bases(nodes)
  expect(plates).toHaveLength(2)
  const winner = plates.find((p) => p.zoneIds?.includes(s.zones[owner]!.id))!
  expect(containsPoint([shape(winner)], [4, 1])).toBe(true)
  expect(area(intersection(shape(plates[0]!), shape(plates[1]!)))).toBeCloseTo(0, 6)
})

test('a shared room owns the whole wall even where another span borders an own room', () => {
  const s = scene(false, 0.05)
  const nodes = toggle(s.nodes, s.zones[1]!.id, true)
  const shared = bases(nodes).find((p) => p.zoneIds?.includes(s.zones[0]!.id))!
  const own = bases(nodes).find((p) => p.id !== shared.id)!
  expect(containsPoint([shape(shared)], [4, 1])).toBe(true)
  expect(containsPoint([shape(own)], [4, 1])).toBe(false)
  expect(containsPoint([shape(own)], [6, 0])).toBe(false)
  expect(containsPoint([shape(shared)], [6, 0])).toBe(true)
})

test.each([
  false,
  true,
])('equal-height own/shared and own/own have no side seam (both=%s)', (both) => {
  const s = scene(true, 0.05)
  let nodes = toggle(s.nodes, s.zones[1]!.id, true)
  if (both) nodes = toggle(nodes, s.zones[0]!.id, true)
  const context = plateLevelContext(nodes[s.level.id]!, (id) => nodes[id])
  for (const plate of bases(nodes)) {
    const sides = computePlateSurfacePartition(plate, context)!.sides
    const seam = sides.filter(
      (side) =>
        Math.abs(side.start[0] - 4) < 1e-6 &&
        Math.abs(side.end[0] - 4) < 1e-6 &&
        (side.start[1] + side.end[1]) / 2 > 0.1 &&
        (side.start[1] + side.end[1]) / 2 < 3.9,
    )
    expect(seam.length).toBeGreaterThan(0)
    expect(seam.every((side) => side.role === 'hidden')).toBe(true)
  }
})

test('shared/own doorway keeps the higher landing, lower-face step, and doorway paint', () => {
  const s = scene()
  const nodes = toggle(s.nodes, s.zones[1]!.id, true)
  const high = s.zones[0]!.id
  nodes[high] = {
    ...zone(nodes, high),
    floorStepOverrides: [{ key: s.door.id, finish: 'library:red' }],
  }
  const wall = nodes[s.divider.id] as typeof s.divider
  expect(getOpeningFloorDatum(wall, s.door, nodes)).toBeCloseTo(0.05)
  expect(wallSupportForNodes(wall, nodes).faceDatum.b[0]!.elevation).toBeCloseTo(-0.4)
  const cut = getOpeningWallCut(wall, s.door, nodes)
  const shared = bases(nodes).find((p) => p.zoneIds?.includes(high))!
  expect(area(intersection(cut.aperture, shape(shared)))).toBeCloseTo(area(cut.aperture), 5)
  const context = plateLevelContext(nodes[s.level.id]!, (id) => nodes[id])
  const sides = computePlateSurfacePartition(shared, context)!.sides.filter(
    (side) => side.stepKey === s.door.id && side.role === 'riser',
  )
  expect(sides.length).toBeGreaterThan(0)
  expect(sides.some((side) => Math.abs(side.top! - side.bottom! - 0.45) < 1e-6)).toBe(true)
  expect(resolveFloorStepFinish(zone(nodes, high), s.door.id, null, [zone(nodes, high)])).toBe(
    'library:red',
  )
})

let stop = () => {}
afterEach(() => {
  stop()
  useScene.temporal.getState().resume()
})
globalThis.requestAnimationFrame ??= (cb) => {
  cb(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}
test('detach and reattach preserve walking heights and doorway geometry in one undo each', () => {
  const s = scene()
  useScene.setState({
    nodes: s.nodes,
    rootNodeIds: [s.level.id],
    dirtyNodes: new Set(),
    collections: {},
    materials: {},
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  stop = initSpaceDetectionSync(useScene, { getState: () => ({ spaces: {}, setSpaces: () => {} }) })
  for (const own of [true, false]) {
    clearSceneHistory()
    const before = useScene.getState().nodes
    const plan = setZoneIntent(before, {
      zoneId: s.zones[1]!.id,
      patch: { floor: { footprint: own ? 'new' : null } },
    })
    expect(plan.conflicts ?? []).toEqual([])
    useScene.getState().applyNodeChanges(structureChangeBatch(plan.changes))
    const after = useScene.getState().nodes
    const room = zone(after, s.zones[1]!.id)
    expect(room.floor?.elevation ?? getRoomBaseElevation(after, room.id)).toBeCloseTo(-0.4)
    expect(bases(after)).toHaveLength(own ? 2 : 1)
    expect(getOpeningWallCut(after[s.divider.id] as typeof s.divider, s.door, after)).toEqual(
      getOpeningWallCut(before[s.divider.id] as typeof s.divider, s.door, before),
    )
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(before)
    useScene.temporal.getState().redo()
    expect(useScene.getState().nodes).toEqual(after)
  }
})

test('an isolated room retains its floor key', () => {
  const s = scene(true, 0.05)
  delete s.nodes[s.boundary.id]
  const nodes = reconcile(s.nodes)
  const room = Object.values(nodes).find((n): n is ZoneNode => n.type === 'zone')!
  const after = toggle(nodes, room.id, true)
  expect(zone(after, room.id).floor?.footprint).toStartWith('floor_')
  expect(bases(after)).toHaveLength(1)
})

test('split and merge carry the own flag and height; duplicated room carries its intent', async () => {
  const { duplicateZone } = await import('../commands/structure/duplicate-zone')
  const s = scene(true)
  const id = s.zones[1]!.id
  const nodes = toggle(s.nodes, id, true)
  const divider = SeparatorNode.parse({
    id: 'separator_own_split',
    parentId: s.level.id,
    start: [6, 0],
    end: [6, 4],
  })
  const split = reconcile({ ...nodes, [divider.id]: divider })
  const children = Object.values(split).filter(
    (n): n is ZoneNode => n.type === 'zone' && !!n.floor?.footprint,
  )
  expect(children).toHaveLength(2)
  expect(children.some((room) => room.id === id)).toBe(true)
  for (const room of children) expect(room.floor?.footprint).toBe(zone(nodes, id).floor?.footprint)
  expect(
    floorFootprintName(split, bases(split).find((plate) => plate.zoneIds?.includes(id))!),
  ).toBe('Lanai floor')
  for (const room of children) expect(getRoomBaseElevation(split, room.id)).toBeCloseTo(-0.4)
  delete split[divider.id]
  const merged = reconcile(split)
  expect(
    Object.values(merged).filter((n) => n.type === 'zone' && !!n.floor?.footprint),
  ).toHaveLength(1)
  const survivor = Object.values(merged).find(
    (node): node is ZoneNode => node.type === 'zone' && !!node.floor?.footprint,
  )!
  expect(survivor.floor?.footprint).toBe(zone(nodes, id).floor?.footprint)
  expect(merged[id]).toBeUndefined()
  merged[survivor.id] = { ...survivor, name: 'Merged room' }
  expect(
    floorFootprintName(
      merged,
      bases(merged).find((plate) => plate.zoneIds?.includes(survivor.id))!,
    ),
  ).toBe('Merged room floor')
  let counter = 0
  const plan = duplicateZone(nodes, {
    zoneId: id,
    translate: [10, 0],
    mintId: (kind) => `${kind}_own_copy_${counter++}`,
  })
  expect(plan.conflicts ?? []).toEqual([])
  const copied = reconcile(applyToScratch(nodes, structureChangeBatch(plan.changes)))
  expect(zone(copied, plan.zoneId).floor?.footprint).toBe(zone(nodes, id).floor?.footprint)
  expect(getRoomBaseElevation(copied, plan.zoneId)).toBeCloseTo(-0.4)
})

test('infeasible relative height on an own floor refuses clearly; in-app writes are filtered', () => {
  const s = scene()
  const id = s.zones[1]!.id
  const nodes = toggle(s.nodes, id, true)
  const patch = { floor: { ...zone(nodes, id).floor, elevation: 4 } }
  expect(setZoneIntent(nodes, { zoneId: id, patch }).changes).toEqual([])
  expect(() => assertDerivedNodeWrites(nodes, { update: [{ id, data: patch }] })).toThrow(
    'does not fit',
  )
  expect(filterDerivedNodeWrites(nodes, { update: [{ id, data: patch }] }).update).toEqual([])
})

test('upper own plates classify support independently, preserve the soffit and have no foundation', async () => {
  const { BuildingNode, LevelNode, SlabNode, ZoneNode } = await import('../schema')
  const { floorFootprintSupportClass } = await import('./floor-foundation-datum')
  const { reconcileStructureOnLoad } = await import('../utils/reconcile-structure-on-load')
  const s = scene(true, 0.03)
  const lower = LevelNode.parse({ id: 'level_own_ground', parentId: 'building_own', level: 0 })
  const upper = { ...s.nodes[s.level.id], parentId: 'building_own', level: 1 } as typeof lower
  const building = BuildingNode.parse({ id: 'building_own', children: [lower.id, upper.id] })
  const lowerRoom = ZoneNode.parse({
    id: 'zone_own_ground',
    name: 'Ground room',
    parentId: lower.id,
    spaceRole: 'room',
    polygon: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
  })
  const lowerPlate = SlabNode.parse({
    id: 'slab_own_ground',
    parentId: lower.id,
    plateRole: 'base',
    zoneIds: [lowerRoom.id],
    polygon: lowerRoom.polygon,
  })
  const input = {
    ...s.nodes,
    [lower.id]: lower,
    [upper.id]: upper,
    [building.id]: building,
    [lowerRoom.id]: lowerRoom,
    [lowerPlate.id]: lowerPlate,
  }
  const nodes = toggle(input, s.zones[1]!.id, true)
  const own = bases(nodes).find((p) => p.zoneIds?.includes(s.zones[1]!.id))!
  const shared = bases(nodes).find((p) => p.zoneIds?.includes(s.zones[0]!.id))!
  expect(floorFootprintSupportClass(nodes, own)).toBe('ground-bearing')
  expect(floorFootprintSupportClass(nodes, shared)).toBe('supported')
  expect(own.foundation?.type).toBe('none')
  expect(own.thickness).toBeCloseTo(0.03)
  expect(own.elevation - own.thickness).toBeCloseTo(0)
  const loaded = reconcileStructureOnLoad(nodes).nodes
  expect(loaded[own.id]).toMatchObject({ elevation: 0.03, thickness: 0.03 })
  let edited = nodes
  for (const floorHeight of [0.05, 0.03]) {
    const plan = setRoomFloorConstruction(edited, {
      zoneId: s.zones[1]!.id,
      patch: { floorHeight },
    })
    expect(plan.conflicts ?? []).toEqual([])
    edited = reconcile(applyToScratch(edited, structureChangeBatch(plan.changes)))
    expect(edited[own.id]).toMatchObject({
      elevation: floorHeight,
      thickness: floorHeight,
      foundation: { type: 'none' },
    })
  }
  expect(edited).toEqual(nodes)
  const bad = {
    ...input,
    [s.zones[1]!.id]: { ...zone(input, s.zones[1]!.id), floor: { elevation: -0.2 } },
  }
  const plan = setZoneIntent(bad, {
    zoneId: s.zones[1]!.id,
    patch: { floor: { footprint: 'new' } },
  })
  expect(plan.changes).toEqual([])
  expect(plan.conflicts?.[0]?.message).toContain('Level the floors first')
  expect(
    filterDerivedNodeWrites(bad, {
      update: [{ id: s.zones[1]!.id, data: { floor: { elevation: -0.2, footprint: 'new' } } }],
    }).update,
  ).toEqual([])
})

test('a floor opening intersects and cuts both own and shared plates', async () => {
  const { FloorOpeningNode } = await import('../schema')
  const s = scene(true, 0.05)
  const nodes = toggle(s.nodes, s.zones[1]!.id, true)
  const opening = FloorOpeningNode.parse({
    id: 'floor-opening_own',
    parentId: s.level.id,
    polygon: [
      [3, 1],
      [5, 1],
      [5, 3],
      [3, 3],
    ],
    cutsAdjacent: false,
  })
  const cut = reconcile({ ...nodes, [opening.id]: opening })
  for (const plate of bases(cut))
    expect(area(intersection(shape(plate), opening.polygon))).toBeCloseTo(0, 5)
  expect(bases(cut).reduce((sum, p) => sum + area([shape(p)]), 0)).toBeCloseTo(
    bases(nodes).reduce((sum, p) => sum + area([shape(p)]), 0) - 4,
    5,
  )
})

test('reattaching after a height edit preserves implicit wall tops with explicit heights', async () => {
  const { getWallPlaneTop } = await import('../services/storey')
  const { resolveCeilingHeight } = await import('../services/level-height')
  const { resolveWallTop } = await import('../systems/wall/wall-top')
  const s = scene(true, 0.05)
  const id = s.zones[1]!.id
  const detached = toggle(s.nodes, id, true)
  const plan = setRoomFloorConstruction(detached, { zoneId: id, patch: { floorHeight: 0.3 } })
  expect(plan.conflicts ?? []).toEqual([])
  const raised = reconcile(applyToScratch(detached, structureChangeBatch(plan.changes)))
  const joined = toggle(raised, id, false)
  for (const old of Object.values(raised)) {
    if (old.type !== 'wall') continue
    const next = joined[old.id] as typeof old
    const top = (wall: typeof old, nodes: Record<string, AnyNode>) =>
      resolveWallTop(
        wall,
        getWallPlaneTop(wall, wall.parentId!, nodes),
        wallSupportForNodes(wall, nodes).elevation,
      )
    expect(top(next, joined)).toBeCloseTo(top(old, raised))
  }
  for (const old of Object.values(raised)) {
    if (old.type !== 'ceiling') continue
    expect(resolveCeilingHeight(joined[old.id] as typeof old, joined)).toBeCloseTo(
      resolveCeilingHeight(old, raised),
    )
  }
  const again = reconcile(joined)
  for (const ceiling of Object.values(joined)) {
    if (ceiling.type === 'ceiling')
      expect(resolveCeilingHeight(again[ceiling.id] as typeof ceiling, again)).toBeCloseTo(
        resolveCeilingHeight(ceiling, joined),
      )
  }
  expect(zone(joined, id).floor?.elevation).toBeCloseTo(0.3)
})

test('an upper storey spanning shared and own footprints still requires raising both or neither', async () => {
  const { BuildingNode, LevelNode, SlabNode } = await import('../schema')
  const s = scene(true, 0.05)
  let nodes = toggle(s.nodes, s.zones[1]!.id, true)
  const upper = LevelNode.parse({ id: 'level_own_above', parentId: 'building_own_above', level: 1 })
  const building = BuildingNode.parse({
    id: 'building_own_above',
    children: [s.level.id, upper.id],
  })
  const plate = SlabNode.parse({
    id: 'slab_own_above',
    parentId: upper.id,
    polygon: [
      [0, 0],
      [8, 0],
      [8, 4],
      [0, 4],
    ],
  })
  nodes = {
    ...nodes,
    [s.level.id]: { ...nodes[s.level.id], parentId: building.id } as AnyNode,
    [building.id]: building,
    [upper.id]: { ...upper, children: [plate.id] },
    [plate.id]: plate,
  }
  const plan = setRoomFloorConstruction(nodes, {
    zoneId: s.zones[1]!.id,
    patch: { floorHeight: 0.3 },
  })
  expect(plan.changes).toEqual([])
  expect(plan.conflicts?.[0]?.message).toContain('raise both or neither')
})

test('partition retains a multi-room shared set alongside an own singleton and existing platforms', async () => {
  const { doorwayStepsFixture } = await import('../systems/slab/__fixtures__/doorway-steps')
  const before = doorwayStepsFixture([0.05, 0.3, 0.05])
  const nodes = toggle(before, 'zone_c', true)
  expect(
    bases(nodes)
      .map((plate) => plate.zoneIds!.slice().sort())
      .sort(),
  ).toEqual([['zone_a', 'zone_b'], ['zone_c']])
  const platform = Object.values(nodes).find(
    (n): n is SlabNode => n.type === 'slab' && n.plateRole === 'platform',
  )!
  expect(platform.zoneIds).toEqual(['zone_b'])
  expect(platform.elevation).toBe(0.3)
  expect(
    floorFootprintName(nodes, bases(nodes).find((plate) => plate.zoneIds!.length === 2)!),
  ).toBe('Shared floor')
})

test('conversion preserves explicit wall tops as their plate support changes', async () => {
  const { resolveWallTop } = await import('../systems/wall/wall-top')
  const s = scene()
  const id = s.zones[1]!.id
  const wall = { ...s.walls[1]!, height: 2.6 }
  const before = { ...s.nodes, [wall.id]: wall }
  const top = (nodes: Record<string, AnyNode>) =>
    resolveWallTop(
      nodes[wall.id] as typeof wall,
      3,
      wallSupportForNodes(nodes[wall.id] as typeof wall, nodes).elevation,
    )
  const detached = toggle(before, id, true)
  expect(top(detached)).toBeCloseTo(top(before))
  const attached = toggle(detached, id, false)
  expect(top(attached)).toBeCloseTo(top(before))
  expect((attached[wall.id] as typeof wall).height).toBeCloseTo(wall.height)
})

test('touching rooms join a key into one named plate and retain raised and sunken room tops', () => {
  const s = scene(true, -0.2)
  const id = s.zones[1]!.id
  const keyed = toggle(s.nodes, id, true)
  const key = zone(keyed, id).floor!.footprint!
  const ownId = bases(keyed).find((plate) => plate.zoneIds?.includes(id))!.id
  const plan = setZoneIntent(keyed, {
    zoneId: s.zones[0]!.id,
    patch: { floor: { footprint: key } },
  })
  expect(plan.conflicts ?? []).toEqual([])
  const joined = reconcile(applyToScratch(keyed, structureChangeBatch(plan.changes)))
  expect(bases(joined)).toHaveLength(1)
  expect(bases(joined)[0]!.id).toBe(ownId)
  expect(bases(joined)[0]!.zoneIds?.slice().sort()).toEqual(s.zones.map((room) => room.id).sort())
  expect(bases(joined)[0]!.elevation).toBeCloseTo(-0.2)
  expect(zone(joined, s.zones[0]!.id).floor?.elevation).toBeCloseTo(0.05)
  expect(floorFootprintName(joined, bases(joined)[0]!)).not.toBe('Shared floor')
  for (const elevation of [0.3, -0.3]) {
    const raised = setZoneIntent(joined, { zoneId: id, patch: { floor: { elevation } } })
    expect(raised.conflicts ?? []).toEqual([])
    const next = reconcile(applyToScratch(joined, structureChangeBatch(raised.changes)))
    expect(zone(next, id).floor?.elevation).toBe(elevation)
    expect(bases(next)[0]!.elevation).toBeCloseTo(-0.2)
    expect(bases(reconcile(next))).toEqual(bases(next))
  }
})

test('disconnected pieces of a key have stable component IDs and synchronized construction', async () => {
  const { duplicateZone } = await import('../commands/structure/duplicate-zone')
  const s = scene(true, 0.05)
  const id = s.zones[1]!.id
  let nodes = toggle(s.nodes, id, true)
  let count = 0
  const copy = duplicateZone(nodes, {
    zoneId: id,
    translate: [10, 0],
    mintId: (kind) => `${kind}_key_copy_${count++}`,
  })
  nodes = reconcile(applyToScratch(nodes, structureChangeBatch(copy.changes)))
  const key = zone(nodes, id).floor!.footprint!
  const pieces = bases(nodes).filter((p) =>
    p.zoneIds?.some((id) => zone(nodes, id).floor?.footprint === key),
  )
  expect(pieces).toHaveLength(2)
  expect(pieces.map((p) => p.id).sort()).toEqual(
    [0, 1].map((i) => keyedFloorPlateId(s.level.id, key, i)).sort(),
  )
  const edit = setRoomFloorConstruction(nodes, {
    zoneId: id,
    patch: {
      floorHeight: 0.2,
      thickness: 0.12,
      foundation: { type: 'solid', material: 'library:red' },
      slots: { edge: 'library:blue' },
    },
  })
  expect(edit.conflicts ?? []).toEqual([])
  const next = reconcile(applyToScratch(nodes, structureChangeBatch(edit.changes)))
  for (const piece of pieces)
    expect(next[piece.id]).toMatchObject({
      elevation: 0.2,
      thickness: 0.12,
      foundation: { type: 'solid', material: 'library:red' },
      slots: { edge: 'library:blue' },
    })
})

test('floor choices expose current and touching keys, exclude distant floors, and flag drawn and mezzanine supports', async () => {
  const { roomFloorChoices } = await import('./room-floor-choices')
  const { SlabNode } = await import('../schema')
  const s = scene(true, 0.05)
  const id = s.zones[1]!.id
  const nodes = toggle(s.nodes, id, true)
  const choices = roomFloorChoices(nodes, id)
  expect(choices).toHaveLength(2)
  expect(choices[0]).toMatchObject({
    key: zone(nodes, id).floor!.footprint,
    current: true,
    name: 'Lanai floor',
  })
  expect(choices[1]).toMatchObject({ key: null, current: false })
  const slab = SlabNode.parse({ parentId: s.level.id, polygon: zone(nodes, id).polygon })
  const drawn = {
    ...nodes,
    [slab.id]: slab,
    [id]: { ...zone(nodes, id), floor: { sourceSlabId: slab.id } },
  }
  expect(roomFloorChoices(drawn, id).find((choice) => choice.current)).toMatchObject({
    plateId: slab.id,
    drawn: true,
  })
  const mezz = { ...zone(nodes, id), floor: { support: 'open' as const, elevation: 1.5 } }
  const deck = { ...slab, support: 'open' as const, zoneIds: [id] }
  expect(roomFloorChoices({ [id]: mezz, [deck.id]: deck }, id)[0]).toMatchObject({
    current: true,
    mezzanine: true,
  })
})

test('joining an existing floor preserves world tops and is one undo step', () => {
  const s = scene(true, -0.2)
  const id = s.zones[1]!.id
  const nodes = toggle(s.nodes, id, true)
  useScene.setState({
    nodes,
    rootNodeIds: [s.level.id],
    dirtyNodes: new Set(),
    collections: {},
    materials: {},
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  stop = initSpaceDetectionSync(useScene, { getState: () => ({ spaces: {}, setSpaces: () => {} }) })
  clearSceneHistory()
  const before = useScene.getState().nodes
  const plan = setZoneIntent(before, {
    zoneId: s.zones[0]!.id,
    patch: { floor: { footprint: zone(nodes, id).floor!.footprint! } },
  })
  expect(plan.conflicts ?? []).toEqual([])
  useScene.getState().applyNodeChanges(structureChangeBatch(plan.changes))
  const after = useScene.getState().nodes
  expect(bases(after)).toHaveLength(1)
  expect(zone(after, s.zones[0]!.id).floor?.elevation).toBeCloseTo(0.05)
  expect(getRoomBaseElevation(after, id)).toBeCloseTo(-0.2)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes).toEqual(before)
  useScene.temporal.getState().redo()
  expect(useScene.getState().nodes).toEqual(after)
})

test('wall ownership ties use the lowest key, independently of room IDs', () => {
  const s = scene(false, 0.05)
  const keys = ['floor_z', 'floor_a']
  for (const [i, room] of s.zones.entries())
    s.nodes[room.id] = { ...zone(s.nodes, room.id), floor: { footprint: keys[i], elevation: 0.05 } }
  const nodes = reconcile(s.nodes)
  expect(bases(nodes)).toHaveLength(2)
  const winner = bases(nodes).find((plate) => plate.zoneIds?.includes(s.zones[1]!.id))!
  expect(containsPoint([shape(winner)], [4, 1])).toBe(true)
})

test('level duplication mints a fresh key, keeps its groups and preserves keyed construction', async () => {
  const { cloneLevelSubtree } = await import('../utils/clone-scene-graph')
  const s = scene(true, -0.2)
  const id = s.zones[1]!.id
  const nodes = toggle(s.nodes, id, true)
  const copy = cloneLevelSubtree(nodes, s.level.id)
  const copiedRoom = copy.clonedNodes.find((node) => node.id === copy.idMap.get(id)) as ZoneNode
  expect(copiedRoom.floor?.footprint).toStartWith('floor_')
  expect(copiedRoom.floor?.footprint).not.toBe(zone(nodes, id).floor?.footprint)
  const copied = reconcile({
    ...nodes,
    ...Object.fromEntries(copy.clonedNodes.map((node) => [node.id, node])),
  })
  expect(getRoomBaseElevation(copied, copiedRoom.id)).toBeCloseTo(-0.2)
  expect(bases(copied).find((plate) => plate.zoneIds?.includes(copiedRoom.id))!.id).toBe(
    keyedFloorPlateId(copy.newLevelId, copiedRoom.floor!.footprint!),
  )
})

test('clearing a keyed construction height restores its resting floor top', () => {
  const s = scene(true, 0.05)
  const id = s.zones[1]!.id
  let nodes = toggle(s.nodes, id, true)
  for (const floorHeight of [0.3, null]) {
    const plan = setRoomFloorConstruction(nodes, { zoneId: id, patch: { floorHeight } })
    expect(plan.conflicts ?? []).toEqual([])
    nodes = reconcile(applyToScratch(nodes, structureChangeBatch(plan.changes)))
    expect(getRoomBaseElevation(nodes, id)).toBeCloseTo(floorHeight ?? 0.05)
  }
})

test('leaving a multi-room key preserves the remaining rooms and construction', () => {
  const s = scene(true, -0.2)
  const id = s.zones[1]!.id
  let nodes = toggle(s.nodes, id, true)
  const key = zone(nodes, id).floor!.footprint!
  const join = setZoneIntent(nodes, {
    zoneId: s.zones[0]!.id,
    patch: { floor: { footprint: key } },
  })
  nodes = reconcile(applyToScratch(nodes, structureChangeBatch(join.changes)))
  const before = getRoomBaseElevation(nodes, id)
  const left = toggle(nodes, s.zones[0]!.id, false)
  expect(getRoomBaseElevation(left, id)).toBeCloseTo(before)
  expect(zone(left, id).floor?.footprint).toBe(key)
  expect(
    zone(left, s.zones[0]!.id).floor?.elevation ?? getRoomBaseElevation(left, s.zones[0]!.id),
  ).toBeCloseTo(0.05)
  expect(bases(left)).toHaveLength(2)
})

test('Wawa-shaped sunken Lanai round-trips exterior doors and windows through an ordinary own key', () => {
  const s = scene(false, -0.1)
  const exterior = s.walls[1]!
  const door = DoorNode.parse({
    parentId: exterior.id,
    wallId: exterior.id,
    position: [1, 1.2, 0],
    height: 2.4,
  })
  const window = WindowNode.parse({
    parentId: exterior.id,
    wallId: exterior.id,
    position: [3, 1.6, 0],
    height: 0.6,
  })
  const before = reconcile({
    ...s.nodes,
    [exterior.id]: { ...exterior, children: [door.id, window.id] },
    [door.id]: door,
    [window.id]: window,
  })
  const world = (nodes: Record<string, AnyNode>) =>
    [door, window].map((opening) => {
      const current = nodes[opening.id] as typeof opening
      const wall = nodes[exterior.id] as typeof exterior
      return { ...getOpeningWallCut(wall, current, nodes), datum: undefined }
    })
  let detached = toggle(before, s.zones[1]!.id, true)
  expect(world(detached)).toEqual(world(before))
  // Load the literal persisted key through the same derivation as any other string.
  const id = s.zones[1]!.id
  detached = reconcile({
    ...detached,
    [id]: { ...zone(detached, id), floor: { footprint: 'own', elevation: -0.1 } },
  })
  expect(zone(detached, id).floor?.footprint).toBe('own')
  const attached = toggle(detached, id, false)
  expect(world(attached)).toEqual(world(before))
  expect(zone(attached, id).floor?.elevation).toBeCloseTo(-0.1)
})

test.each([
  undefined,
  2.5,
])('ceiling edge slivers do not carry the adjacent floor (height=%s)', (height) => {
  const s = scene(false, -0.1)
  const id = s.zones[1]!.id
  const detached = toggle(s.nodes, id, true)
  const ceiling = CeilingNode.parse({
    parentId: s.level.id,
    height,
    polygon: [
      [0, 0],
      [4.12, 0],
      [4.12, 4],
      [0, 4],
    ],
  })
  const nodes = { ...detached, [ceiling.id]: ceiling }
  const own = bases(nodes).find((p) => p.zoneIds?.includes(id))!
  const shared = bases(nodes).find((p) => !p.zoneIds?.includes(id))!
  expect(footprintSupportsNode(own, ceiling, nodes)).toBe(false)
  expect(footprintSupportsNode(shared, ceiling, nodes)).toBe(true)
  const plan = setRoomFloorConstruction(nodes, { zoneId: id, patch: { floorHeight: -0.05 } })
  expect(plan.conflicts ?? []).toEqual([])
  expect(plan.changes.some((p) => p.op === 'update' && p.id === ceiling.id)).toBe(false)
  const spanning = {
    ...ceiling,
    polygon: [
      [0, 0],
      [8, 0],
      [8, 4],
      [0, 4],
    ] as [number, number][],
  }
  const refused = setRoomFloorConstruction(
    { ...nodes, [ceiling.id]: spanning },
    { zoneId: id, patch: { floorHeight: -0.05 } },
  )
  expect(refused.conflicts?.[0]?.message).toContain('raise both or neither')
})

test('keyed plates stay ground-bearing on their foundation; solid only while raised', () => {
  const s = scene(true, -0.1)
  const id = s.zones[1]!.id
  let nodes = toggle(s.nodes, id, true)
  for (const foundationHeight of [0.2, 0, 0.05, 0]) {
    const plan = setRoomFloorConstruction(nodes, { zoneId: id, patch: { foundationHeight } })
    expect(plan.conflicts ?? []).toEqual([])
    nodes = reconcile(applyToScratch(nodes, structureChangeBatch(plan.changes)))
    const plate = bases(nodes).find((p) => p.zoneIds?.includes(id))!
    const { grade } = groundFloorConstruction(nodes, plate)
    expect(plate.elevation).toBeCloseTo(grade + foundationHeight + plate.thickness)
    expect(floorFootprintSupportClass(nodes, plate)).toBe('ground-bearing')
    expect(plate.foundation?.type).toBe(foundationHeight > 0 ? 'solid' : 'none')
  }
})
