import { expect, test } from 'bun:test'
import { rebaseFloorReference } from '../commands/structure/rebase-floor-reference'
import { setZoneIntent } from '../commands/structure/set-zone-intent'
import {
  type AnyNode,
  BuildingNode,
  DoorNode,
  LevelNode,
  SiteNode,
  SlabNode,
  type WallNode,
  type ZoneNode,
} from '../schema'
import {
  assertDerivedNodeWrites,
  derivedFieldViolations,
  filterDerivedNodeWrites,
} from '../store/derived-node-guard'
import { floorStepFixture } from '../systems/slab/__fixtures__/floor-step'
import { resolveWallTop } from '../systems/wall/wall-top'
import { migrateFloorPlates } from '../utils/floor-plate-migration'
import { reconcileStructureOnLoad } from '../utils/reconcile-structure-on-load'
import { migrateRoomZones } from '../utils/room-zone-migration'
import { reconcileStructureWithStableIds } from '../utils/structure-id'
import { expandFloorIntentChanges } from './floor-intent-changes'
import { getOpeningFloorDatum, getOpeningWallCut, wallSupportForNodes } from './opening-floor-datum'
import { computePlateSurfacePartition, plateLevelContext } from './plate-surface'
import { area, containsPoint, intersection } from './polygon-boolean'
import { roomFloorElevation } from './room-floor-elevation'
import {
  checkRoomFloor,
  clampRoomFloorHandle,
  getRoomBaseElevation,
  getRoomRelativeFloorElevation,
  roomFloorElevationFromRelative,
} from './room-floor-feasibility'
import { encodeTerrainField } from './terrain-codec'
import { createTerrainField } from './terrain-field'

function scene(high = 0.55, low = 0.05, door = true) {
  const fixture = floorStepFixture()
  const nodes = Object.fromEntries(
    Object.entries(fixture.nodes).filter(([, n]) => n.type !== 'slab'),
  )
  nodes[fixture.level.id] = {
    ...fixture.level,
    height: 3,
    children: fixture.level.children.filter((id) => nodes[id]),
  }
  for (const [i, zone] of fixture.zones.entries())
    nodes[zone.id] = {
      ...zone,
      floor: { elevation: i ? low : high, finish: `library:finish-${i}` },
    }
  if (door) {
    nodes[fixture.door.id] = fixture.door
    nodes[fixture.divider.id] = { ...fixture.divider, children: [fixture.door.id] }
  }
  return { ...fixture, nodes: { ...reconcileStructureWithStableIds({ nodes }).nodes } }
}
const plates = (nodes: Record<string, AnyNode>) =>
  Object.values(nodes).filter((n): n is SlabNode => n.type === 'slab')

function onRaisedGround(nodes: Record<string, AnyNode>, lift: number) {
  const field = createTerrainField({ cols: 33, rows: 33, spacing: 1, origin: [-16, -16] })
  const site = SiteNode.parse({
    id: 'site_floor_datum',
    terrain: encodeTerrainField({
      ...field,
      heights: new Int16Array(field.heights.length).fill(Math.round(lift * 100)),
    }),
  })
  return { ...nodes, [site.id]: site }
}

test('D1/D2/D3/D5: raising floors retains the base, complete wall bodies and fixed tops', () => {
  const s = scene()
  const base = plates(s.nodes).find((p) => p.plateRole === 'base')!
  const platform = plates(s.nodes).find((p) => p.plateRole === 'platform')!
  expect(base.elevation).toBe(0.05)
  expect(platform.thickness).toBeCloseTo(0.5)
  expect(containsPoint([{ outer: base.polygon, holes: base.holes }], [2, 2])).toBe(true)
  const wall = s.nodes[s.divider.id] as WallNode
  const support = wallSupportForNodes(wall, s.nodes)
  expect(support.elevation).toBe(0.05)
  expect(support.faceDatum.a[0]!.elevation).toBe(0.55)
  expect(support.faceBottom.a[0]!.elevation).toBe(0.05)
  expect(resolveWallTop({ ...wall, height: 2.5 }, 3, support.elevation)).toBe(2.55)
  const part = computePlateSurfacePartition(
    base,
    plateLevelContext(s.nodes[s.level.id]!, (id) => s.nodes[id]),
  )!
  expect(area(part.masked)).toBeGreaterThan(0)
})

test.each([
  [0.55, 0.05],
  [0.05, -0.4],
  [0.55, -0.4],
  [0.55, 0.3],
  [0.55, 0.55],
])('D6 door %s/%s stands on one full aperture at the higher floor', (high, low) => {
  const s = scene(high, low)
  const wall = s.nodes[s.divider.id] as WallNode
  const cut = getOpeningWallCut(wall, s.door, s.nodes)
  expect(getOpeningFloorDatum(wall, s.door, s.nodes)).toBe(high)
  expect(cut.covered).toBe(true)
  const carriers = plates(s.nodes).filter(
    (p) =>
      Math.abs(p.elevation - high) < 0.001 &&
      area(intersection(cut.aperture, { outer: p.polygon, holes: p.holes })) > 0.001,
  )
  expect(carriers).toHaveLength(1)
  expect(
    area(intersection(cut.aperture, { outer: carriers[0]!.polygon, holes: carriers[0]!.holes })),
  ).toBeCloseTo(area(cut.aperture), 5)
})

test('D6 exterior raised door retains an upstand; wall windows keep their datum', () => {
  const s = scene()
  const wall = s.walls[0]!
  const door = DoorNode.parse({ ...s.door, id: 'door_outside', parentId: wall.id, wallId: wall.id })
  const nodes = reconcileStructureOnLoad({
    ...s.nodes,
    [door.id]: door,
    [wall.id]: { ...wall, children: [door.id] },
  }).nodes
  const cut = getOpeningWallCut(nodes[wall.id] as WallNode, door, nodes)
  expect(cut.datum).toBe(0.55)
  expect(cut.covered).toBe(false)
  expect(cut.bottom).toBe(0.55)
  expect(getOpeningFloorDatum(wall, { ...door, position: [2, 1.5, 0], height: 1 }, nodes)).toBe(
    0.05,
  )
})

test('D9 room plate ID survives edits and raised/sunken flips; base ID survives retirement', () => {
  const s = scene()
  const base = plates(s.nodes).find((p) => p.plateRole === 'base')!
  const own = plates(s.nodes).find((p) => p.plateRole === 'platform')!
  let nodes = s.nodes
  for (const elevation of [0.3, 0.8, -0.3, -0.7, 0.55]) {
    const zone = nodes[s.zones[0]!.id] as ZoneNode
    nodes = reconcileStructureOnLoad({
      ...nodes,
      [zone.id]: { ...zone, floor: { ...zone.floor, elevation } },
    }).nodes
    expect(nodes[base.id]?.type).toBe('slab')
    expect(nodes[own.id]).toMatchObject({ elevation })
  }
  const zone = nodes[s.zones[0]!.id] as ZoneNode
  nodes = reconcileStructureOnLoad({
    ...nodes,
    [zone.id]: { ...zone, floor: { elevation: 0.05 } },
  }).nodes
  expect(nodes[own.id]).toBeUndefined()
  expect(nodes[base.id]).toBeDefined()
})

test('D10 plate writes allow base construction and refuse derived elevation and room slots', () => {
  const s = scene()
  const base = plates(s.nodes).find((p) => p.plateRole === 'base')!
  const own = plates(s.nodes).find((p) => p.plateRole === 'platform')!
  expect(derivedFieldViolations(base, { elevation: 1 })).toContain('elevation')
  expect(
    derivedFieldViolations(base, {
      thickness: 0.2,
      foundation: { type: 'solid' },
      slots: { edge: 'library:stone' },
    }),
  ).toEqual([])
  expect(derivedFieldViolations(base, { slots: { surface: 'library:stone' } })).toContain('slots')
  expect(
    derivedFieldViolations(own, { slots: { riser: 'library:stone' }, thickness: 0.3 }),
  ).toEqual(expect.arrayContaining(['slots', 'thickness']))
})

test('D11 commands refuse worse conflicts while raw store writes never throw', () => {
  const s = scene(0.55)
  const wall = { ...(s.nodes[s.divider.id] as WallNode), height: 2.5 }
  const door = { ...s.door, height: 2.1, position: [2, 1.05, 0] as [number, number, number] }
  const nodes = { ...s.nodes, [wall.id]: wall, [door.id]: door }
  const checked = checkRoomFloor(nodes, s.zones[0]!.id, 0.8)
  expect(checked.maxElevation).toBeCloseTo(0.45)
  expect(checked.elevation).toBeCloseTo(0.45)
  expect(checked.conflicts[0]!.code).toBe('floor-opening-fit')
  expect(
    setZoneIntent(nodes, { zoneId: s.zones[0]!.id, patch: { floor: { elevation: 0.8 } } }).changes,
  ).toEqual([])
  expect(() =>
    filterDerivedNodeWrites(nodes, {
      update: [{ id: s.zones[0]!.id, data: { floor: { elevation: 0.8 } } }],
    }),
  ).not.toThrow()
  expect(reconcileStructureOnLoad(nodes).nodes[s.zones[0]!.id]).toMatchObject({
    floor: { elevation: 0.55 },
  })
})

test('D12 valid upper depression keeps the soffit and deeper authoring is refused', () => {
  const s = scene(0.03, 0.05, false)
  const ground = LevelNode.parse({ id: 'level_ground', level: 0 })
  const building = BuildingNode.parse({ children: [ground.id, s.level.id] })
  const level = { ...(s.nodes[s.level.id] as LevelNode), parentId: building.id, level: 1 }
  const lowerWalls = Object.values(s.nodes)
    .filter((node): node is WallNode => node.type === 'wall' && node.parentId === level.id)
    .map((wall) => ({ ...wall, id: `${wall.id}_lower` as WallNode['id'], parentId: ground.id }))
  const input = {
    ...s.nodes,
    ...Object.fromEntries(lowerWalls.map((wall) => [wall.id, wall])),
    [ground.id]: { ...ground, parentId: building.id, children: lowerWalls.map((wall) => wall.id) },
    [building.id]: building,
    [level.id]: level,
  }
  const nodes = reconcileStructureOnLoad(
    migrateFloorPlates(migrateRoomZones(input).nodes).nodes,
  ).nodes
  const sunken = plates(nodes).find((p) => p.plateRole === 'sunken')!
  expect(sunken.thickness).toBeCloseTo(0.03)
  expect(sunken.elevation - sunken.thickness).toBeCloseTo(0)
  expect(checkRoomFloor(nodes, s.zones[0]!.id, -0.1).minElevation).toBeCloseTo(0.02)
})

test('D13 numeric millimetre steps remain authored without handle snapping', () => {
  const s = scene(0.052, 0.05, false)
  expect(plates(s.nodes).find((p) => p.plateRole === 'platform')?.thickness).toBeCloseTo(0.002)
})

test('§14 footprint floor intent translates explicit room floors in one batch and clearing resumes derivation', () => {
  const s = scene()
  const updates = expandFloorIntentChanges(s.nodes, [
    { id: plates(s.nodes).find((p) => p.plateRole === 'base')!.id, data: { floorHeight: 0.25 } },
  ])
  expect(updates.length).toBeGreaterThanOrEqual(3)
  const nodes = { ...s.nodes }
  for (const { id, data } of updates) nodes[id] = { ...nodes[id], ...data } as AnyNode
  expect((nodes[s.zones[0]!.id] as ZoneNode).floor?.elevation).toBeCloseTo(0.75)
  expect(getRoomBaseElevation(nodes, s.zones[0]!.id)).toBe(0.25)
  const reset = expandFloorIntentChanges(nodes, [
    {
      id: plates(s.nodes).find((p) => p.plateRole === 'base')!.id,
      data: { floorHeight: undefined },
    },
  ])
  expect(
    (reset.find((u) => u.id === s.zones[0]!.id)!.data as Partial<ZoneNode>).floor?.elevation,
  ).toBeCloseTo(0.55)
})

test('D2/D7 courtyard wall bands persist without adding an interior floor', () => {
  const s = scene()
  const zone = s.nodes[s.zones[1]!.id] as ZoneNode
  const nodes = reconcileStructureOnLoad({
    ...s.nodes,
    [zone.id]: { ...zone, hasFloor: false },
  }).nodes
  const base = plates(nodes).find((p) => p.plateRole === 'base')!
  const shape = [{ outer: base.polygon, holes: base.holes }]
  expect(containsPoint(shape, [6, 2])).toBe(false)
  expect(containsPoint(shape, [6, 0])).toBe(false)
  const support = wallSupportForNodes(nodes[s.divider.id] as WallNode, nodes)
  expect(support.faceDatum.b[0]!.elevation).toBe(0.05)
})

test('D8 a sunken doorway step belongs to the base-height room and uses its step role', () => {
  const s = scene(0.05, -0.4)
  const base = plates(s.nodes).find((p) => p.plateRole === 'base')!
  const part = computePlateSurfacePartition(
    base,
    plateLevelContext(s.nodes[s.level.id]!, (id) => s.nodes[id]),
  )!
  expect(
    part.sides.some(
      (side) => side.role === 'riser' && side.zoneId === s.zones[0]!.id && side.dropTo === -0.4,
    ),
  ).toBe(true)
  expect(part.sides.filter((side) => side.role === 'edge').every((side) => !side.zoneId)).toBe(true)
})

test('D14 raising every room keeps wall support at the level floor', () => {
  const s = scene(0.6, 0.6)
  expect(plates(s.nodes).filter((p) => p.plateRole === 'platform')).toHaveLength(2)
  expect(getRoomBaseElevation(s.nodes, s.zones[0]!.id)).toBe(0.05)
  expect(wallSupportForNodes(s.nodes[s.divider.id] as WallNode, s.nodes).elevation).toBe(0.05)
})

test('support offsets move W while plate-carried face datums stay on their own floor', () => {
  const s = scene(0.55, 0.05, false)
  const wall = { ...(s.nodes[s.divider.id] as WallNode), supportOffset: 0.2 }
  const support = wallSupportForNodes(wall, { ...s.nodes, [wall.id]: wall })
  expect(support.elevation).toBeCloseTo(0.25)
  expect(support.faceDatum.a[0]!.elevation).toBe(0.55)
  expect(support.faceDatum.b[0]!.elevation).toBe(0.05)
  expect(support.faceBottom.a[0]!.elevation).toBeCloseTo(0.25)
  expect(support.faceBottom.b[0]!.elevation).toBe(0.05)
})

test.each([0.049, 0.051])(
  'D13 exact millimetre floor %s has its own nonempty plate',
  (elevation) => {
    const s = scene(elevation, 0.05, false)
    const own = plates(s.nodes).find((plate) => plate.plateRole !== 'base')!
    expect(own).toBeDefined()
    expect(area([{ outer: own.polygon, holes: own.holes }])).toBeGreaterThan(1)
  },
)

test('D11 door resizing and wall lowering use the same floor feasibility check', () => {
  const s = scene(0.3)
  expect(() =>
    assertDerivedNodeWrites(s.nodes, {
      update: [{ id: s.door.id, data: { height: 3, position: [2, 1.5, 0] } }],
    }),
  ).toThrow('fit')
  expect(() =>
    assertDerivedNodeWrites(s.nodes, { update: [{ id: s.divider.id, data: { height: 2 } }] }),
  ).toThrow('fit')
})

test('D14 moving the structural floor also moves the explicit wall top in the feasibility draft', () => {
  const s = scene(0.3)
  const nodes = {
    ...s.nodes,
    [s.divider.id]: { ...(s.nodes[s.divider.id] as WallNode), height: 2.5 },
  }
  expect(() =>
    filterDerivedNodeWrites(nodes, {
      update: [
        {
          id: plates(s.nodes).find((p) => p.plateRole === 'base')!.id,
          data: { floorHeight: 0.25 },
        },
      ],
    }),
  ).not.toThrow()
})

test('D1 authoring hints stay advisory and do not change a feasible floor', () => {
  const s = scene(0.3)
  const nodes = { ...s.nodes, [s.door.id]: { ...s.door, swingDirection: 'outward' as const } }
  const check = checkRoomFloor(nodes, s.zones[0]!.id, 0.3)
  expect(check.conflicts.filter((c) => c.severity === 'error')).toEqual([])
  expect(check.conflicts.map((c) => c.code)).toEqual(
    expect.arrayContaining(['floor-door-step', 'floor-door-swing']),
  )
  expect(check.elevation).toBe(0.3)
  const noDoor = scene(0.6, 0.05, false)
  noDoor.nodes[noDoor.level.id] = { ...noDoor.level, height: 2.5 }
  expect(checkRoomFloor(noDoor.nodes, noDoor.zones[0]!.id, 0.6).conflicts).toContainEqual(
    expect.objectContaining({ code: 'floor-low-headroom', severity: 'warning' }),
  )
})

test('D8/D10 mezzanine underside remains plate construction while fascia belongs to the zone', () => {
  const s = scene()
  const plate = {
    ...plates(s.nodes)[0]!,
    support: 'open' as const,
    plateRole: undefined,
    slots: { underside: 'library:old' },
  }
  expect(derivedFieldViolations(plate, { slots: { underside: 'library:new' } })).toEqual([])
  expect(
    derivedFieldViolations(plate, { slots: { underside: 'library:old', edge: 'library:new' } }),
  ).toContain('slots')
})

test('D13 a one-millimetre raised exterior threshold still retains its upstand', () => {
  const s = scene(0.051, 0.05)
  const wall = s.walls[0]!
  const door = { ...s.door, parentId: wall.id, wallId: wall.id }
  const nodes = reconcileStructureOnLoad({
    ...s.nodes,
    [wall.id]: { ...wall, children: [door.id] },
    [door.id]: door,
  }).nodes
  const cut = getOpeningWallCut(wall, door, nodes)
  expect(cut.covered).toBe(false)
  expect(cut.bottom).toBeCloseTo(0.051)
})

test('H2 every command edit may retain or improve an existing opening overload', () => {
  const s = scene(0.55)
  const wall = { ...(s.nodes[s.divider.id] as WallNode), height: 2.5 }
  const nodes = { ...s.nodes, [wall.id]: wall }
  for (const data of [{ position: [2.1, 1.05, 0] }, { height: 2, position: [2, 1, 0] }])
    expect(() =>
      assertDerivedNodeWrites(nodes, {
        update: [{ id: s.door.id, data: data as Partial<AnyNode> }],
      }),
    ).not.toThrow()
  expect(
    setZoneIntent(nodes, { zoneId: s.zones[0]!.id, patch: { floor: { elevation: 0.5 } } })
      .conflicts ?? [],
  ).toEqual([])
  expect(() =>
    assertDerivedNodeWrites(nodes, { update: [{ id: wall.id, data: { height: 2.6 } }] }),
  ).not.toThrow()
  expect(() =>
    assertDerivedNodeWrites(nodes, { update: [{ id: wall.id, data: { height: 2.4 } }] }),
  ).toThrow()
})

test('H2 newly created doors must fit, including a wall with no room', () => {
  const s = scene(0.3)
  const door = DoorNode.parse({
    ...s.door,
    id: 'door_review_new',
    height: 3,
    position: [2, 1.5, 0],
  })
  expect(() => assertDerivedNodeWrites(s.nodes, { create: [{ node: door }] })).toThrow()
  const wallsOnly = Object.fromEntries(Object.entries(s.nodes).filter(([, n]) => n.type !== 'zone'))
  expect(() => assertDerivedNodeWrites(wallsOnly, { create: [{ node: door }] })).toThrow()
  expect(() => filterDerivedNodeWrites(s.nodes, { create: [{ node: door }] })).not.toThrow()
})

test('room-relative heights round to micrometres and handle clamps stay on the 5 cm grid', () => {
  const s = scene(0.3)
  const wall = { ...s.nodes[s.divider.id], height: 2.479 } as WallNode
  const nodes = { ...s.nodes, [wall.id]: wall }
  expect(getRoomRelativeFloorElevation(nodes, s.zones[0]!.id)).toBe(0.25)
  expect(roomFloorElevationFromRelative(nodes, s.zones[0]!.id, 0.35)).toBe(0.4)
  expect(checkRoomFloor(nodes, s.zones[0]!.id, 0.8).maxElevation).toBeCloseTo(0.529)
  expect(clampRoomFloorHandle(nodes, s.zones[0]!.id, 0.8)).toBe(0.5)
})

test.each([-0.4, 0, 0.4, 1.6])(
  'stored room steps follow an automatic ground datum lifted by %s metres',
  (lift) => {
    const s = scene(0.2, 0.05, false)
    const before = onRaisedGround(s.nodes, lift)
    expect(roomFloorElevation(before, s.zones[0]!.id)).toBeCloseTo(0.2)
    const nodes = reconcileStructureWithStableIds({
      nodes: before,
    }).nodes
    const high = s.zones[0]!.id
    const low = s.zones[1]!.id
    expect((nodes[high] as ZoneNode).floor?.elevation).toBe(0.2)
    expect((nodes[low] as ZoneNode).floor?.elevation).toBe(0.05)
    expect(roomFloorElevation(nodes, high)).toBeCloseTo(lift + 0.2)
    expect(roomFloorElevation(nodes, low)).toBeCloseTo(lift + 0.05)
    expect(getRoomRelativeFloorElevation(nodes, high)).toBe(0.15)
    expect(roomFloorElevationFromRelative(nodes, high, 0.3)).toBeCloseTo(lift + 0.35)
    const platform = plates(nodes).find((plate) => plate.plateRole === 'platform')!
    expect(platform.elevation).toBeCloseTo(lift + 0.2)
    expect(platform.thickness).toBeCloseTo(0.15)
    expect(reconcileStructureWithStableIds({ nodes }).nodes).toEqual(nodes)
  },
)

test('authoring a foundation on lifted ground preserves room steps and clearing restores them', () => {
  const s = scene(0.2, 0.05, false)
  let nodes = { ...reconcileStructureWithStableIds({ nodes: onRaisedGround(s.nodes, 0.4) }).nodes }
  const base = plates(nodes).find((plate) => plate.plateRole === 'base')!
  const roomId = s.zones[0]!.id
  for (const [floorHeight, expectedTop, expectedStored] of [
    [0.65, 0.8, 0.8],
    [undefined, 0.6, 0.2],
  ] as const) {
    const updates = expandFloorIntentChanges(nodes, [{ id: base.id, data: { floorHeight } }])
    for (const { id, data } of updates) nodes[id] = { ...nodes[id], ...data } as AnyNode
    nodes = { ...reconcileStructureWithStableIds({ nodes }).nodes }
    expect((nodes[roomId] as ZoneNode).floor?.elevation).toBeCloseTo(expectedStored)
    expect(roomFloorElevation(nodes, roomId)).toBeCloseTo(expectedTop)
    expect(getRoomRelativeFloorElevation(nodes, roomId)).toBeCloseTo(0.15)
  }
})

test('a numeric room edit on lifted ground is checked at its resolved walking surface', () => {
  const s = scene(0.2, 0.05, false)
  const nodes = reconcileStructureWithStableIds({ nodes: onRaisedGround(s.nodes, 0.4) }).nodes
  const roomId = s.zones[0]!.id
  const plan = setZoneIntent(nodes, { zoneId: roomId, patch: { floor: { elevation: 0.35 } } })
  expect(plan.conflicts ?? []).toEqual([])
  const draft = { ...nodes }
  for (const change of plan.changes)
    if (change.op === 'update')
      draft[change.id] = { ...draft[change.id], ...change.data } as AnyNode
  const after = reconcileStructureWithStableIds({ nodes: draft }).nodes
  expect(roomFloorElevation(after, roomId)).toBeCloseTo(0.75)
  expect(getRoomRelativeFloorElevation(after, roomId)).toBeCloseTo(0.3)
  expect(checkRoomFloor(after, roomId, 2.7).conflicts).toContainEqual(
    expect.objectContaining({ code: 'floor-headroom' }),
  )
})

test('an implicit outdoor drop follows the lifted base without becoming a stored absolute top', () => {
  const s = scene(0.2, 0.05, false)
  const zone = s.zones[0]!
  const draft = onRaisedGround(s.nodes, 0.4)
  draft[zone.id] = { ...zone, floor: { drop: 0.1 } }
  const nodes = reconcileStructureWithStableIds({ nodes: draft }).nodes
  expect((nodes[zone.id] as ZoneNode).floor?.elevation).toBeUndefined()
  expect(roomFloorElevation(nodes, zone.id)).toBeCloseTo(0.35)
  expect(getRoomRelativeFloorElevation(nodes, zone.id)).toBeCloseTo(-0.1)
})

test.each([false, true])(
  'a zero-displacement reference rebase preserves lifted room steps (store guard %s)',
  (guarded) => {
    const s = scene(0.2, 0.05, false)
    const nodes = reconcileStructureWithStableIds({ nodes: onRaisedGround(s.nodes, 0.4) }).nodes
    const base = plates(nodes).find((plate) => plate.plateRole === 'base')!
    const plan = rebaseFloorReference(nodes, {
      slabId: base.id,
      referenceFloorElevation: 0.05,
    })
    expect(plan.conflicts ?? []).toEqual([])
    const updates = plan.changes.flatMap((change) =>
      change.op === 'update' ? [{ id: change.id, data: change.data }] : [],
    )
    const expanded = guarded
      ? filterDerivedNodeWrites(nodes, { update: updates }).update
      : expandFloorIntentChanges(nodes, updates)
    const draft = { ...nodes }
    for (const { id, data } of expanded) draft[id] = { ...draft[id], ...data } as AnyNode
    const after = reconcileStructureWithStableIds({ nodes: draft }).nodes
    expect(roomFloorElevation(after, s.zones[0]!.id)).toBeCloseTo(0.6)
    expect(roomFloorElevation(after, s.zones[1]!.id)).toBeCloseTo(0.45)
    expect(plates(after).find((plate) => plate.plateRole === 'base')!.elevation).toBeCloseTo(0.45)
  },
)

test.each([false, true])(
  'rejoining a larger own floor preserves the shared automatic datum and both rooms (store guard %s)',
  (guarded) => {
    const fixture = floorStepFixture(true)
    const initial = Object.fromEntries(
      Object.entries(fixture.nodes).filter(([, node]) => node.type !== 'slab'),
    )
    initial[fixture.boundary.id] = {
      ...fixture.boundary,
      start: [2, 0],
      end: [2, 4],
    }
    for (const zone of fixture.zones)
      initial[zone.id] = {
        ...zone,
        polygon: zone.polygon.map(([x, z]) => [x === 4 ? 2 : x, z]),
        floor: { elevation: 0.05 },
      }
    initial[fixture.level.id] = {
      ...fixture.level,
      children: fixture.level.children.filter((id) => initial[id]),
    }
    let nodes = reconcileStructureWithStableIds({ nodes: onRaisedGround(initial, 0.1) }).nodes
    for (const footprint of ['new', null] as const) {
      const plan = setZoneIntent(nodes, {
        zoneId: fixture.zones[1]!.id,
        patch: { floor: { footprint } },
      })
      expect(plan.conflicts ?? []).toEqual([])
      const updates = plan.changes.flatMap((change) =>
        change.op === 'update' ? [{ id: change.id, data: change.data }] : [],
      )
      const applied = guarded ? filterDerivedNodeWrites(nodes, { update: updates }).update : updates
      const draft = { ...nodes }
      for (const { id, data } of applied) draft[id] = { ...draft[id], ...data } as AnyNode
      nodes = reconcileStructureWithStableIds({ nodes: draft }).nodes
      for (const zone of fixture.zones) expect(roomFloorElevation(nodes, zone.id)).toBeCloseTo(0.15)
    }
    expect(plates(nodes).filter((plate) => plate.plateRole === 'base')).toHaveLength(1)
    expect(plates(nodes).find((plate) => plate.plateRole === 'base')!.floorHeight).toBeUndefined()
    for (const zone of fixture.zones)
      expect((nodes[zone.id] as ZoneNode).floor?.elevation).toBeCloseTo(0.05)
  },
)

test('a retained manual source moved away no longer suppresses the regenerated room datum', () => {
  const s = scene(0.2, 0.05, false)
  const zone = s.nodes[s.zones[0]!.id] as ZoneNode
  const source = SlabNode.parse({
    id: 'slab_moved_room_source',
    parentId: zone.parentId,
    polygon: zone.polygon,
    elevation: 0.2,
    thickness: 0.05,
  })
  const initial = onRaisedGround(s.nodes, 0.4)
  initial[source.id] = source
  initial[zone.id] = { ...zone, floor: { ...zone.floor, sourceSlabId: source.id } }
  const before = reconcileStructureWithStableIds({ nodes: initial }).nodes
  const after = reconcileStructureWithStableIds({
    nodes: {
      ...before,
      [source.id]: {
        ...source,
        polygon: source.polygon.map(([x, z]) => [x + 20, z]),
      },
    },
  }).nodes
  expect((after[zone.id] as ZoneNode).floor?.sourceSlabId).toBe(source.id)
  expect((after[zone.id] as ZoneNode).floor?.elevation).toBe(0.2)
  expect(roomFloorElevation(after, zone.id)).toBeCloseTo(0.6)
  const platform = plates(after).find(
    (plate) => plate.plateRole === 'platform' && plate.zoneIds?.includes(zone.id),
  )!
  expect(platform.elevation).toBeCloseTo(0.6)
})
