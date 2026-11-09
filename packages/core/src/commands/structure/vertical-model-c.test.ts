import { expect, test } from 'bun:test'
import {
  floorFootprintSupportClass,
  floorPlateAtGroundContact,
  floorPlateGestureMinimum,
  floorPlateHoldsUnderside,
  upperFloorHeightControl,
} from '../../lib/floor-foundation-datum'
import { changedLevelConstructionDisplacements } from '../../lib/floor-foundation-stack'
import { wallSupportForNodes } from '../../lib/opening-floor-datum'
import {
  type AnyNode,
  BuildingNode,
  DoorNode,
  LevelNode,
  type SlabNode,
  StairNode,
  WallNode,
  ZoneNode,
} from '../../schema'
import { getCeilingClampBound, getLevelElevations, getWallPlaneTop } from '../../services/storey'
import { resolveStairTotalRise } from '../../systems/stair/stair-rise-query'
import { resolveWallTop } from '../../systems/wall/wall-top'
import { reconcileStructureOnLoad } from '../../utils/reconcile-structure-on-load'
import { setFloorFoundation } from './set-floor-foundation'

const polygon = (x: number, width = 4): [number, number][] => [
  [x, 0],
  [x + width, 0],
  [x + width, 4],
  [x, 4],
]

function house(withWing = false) {
  const building = BuildingNode.parse({ id: 'building_model_c' })
  const levels = [0, 1, 2].map((ordinal) =>
    LevelNode.parse({
      id: `level_model_c_${ordinal}`,
      parentId: building.id,
      level: ordinal,
      height: 3,
    }),
  )
  building.children = levels.map((level) => level.id)
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [building, ...levels].map((node) => [node.id, node]),
  )
  for (const [ordinal, level] of levels.entries()) {
    for (const x of withWing && ordinal < 2 ? [0, 10] : [0]) {
      const outline = polygon(x, withWing && ordinal === 2 ? 14 : 4)
      const name = x ? 'Garage floor' : 'Shared floor'
      const zone = ZoneNode.parse({
        id: `zone_model_c_${ordinal}_${x}`,
        parentId: level.id,
        polygon: outline,
        name,
        spaceRole: 'room',
      })
      nodes[zone.id] = zone
      for (const [index, start] of outline.entries()) {
        const wall = WallNode.parse({
          id: `wall_model_c_${ordinal}_${x}_${index}`,
          parentId: level.id,
          start,
          end: outline[(index + 1) % outline.length],
          ...(ordinal === 1 && index === 0 ? { height: 2.4 } : {}),
        })
        nodes[wall.id] = wall
      }
    }
  }
  if (withWing) {
    const level = levels[2]!
    const zone = nodes.zone_model_c_2_0 as ZoneNode
    nodes[zone.id] = { ...zone, polygon: polygon(0, 14) }
  }
  for (const level of levels)
    level.children = Object.values(nodes)
      .filter((node) => node.parentId === level.id)
      .map((node) => node.id) as LevelNode['children']
  return reconcileStructureOnLoad(nodes).nodes
}

function base(nodes: Record<string, AnyNode>, ordinal: number, x = 0) {
  const zoneId = `zone_model_c_${ordinal}_${x}`
  return Object.values(nodes).find(
    (node): node is SlabNode =>
      node.type === 'slab' && node.plateRole === 'base' && !!node.zoneIds?.includes(zoneId),
  )!
}

function apply(nodes: Record<string, AnyNode>, plate: SlabNode, thickness: number) {
  const plan = setFloorFoundation(nodes, { slabId: plate.id, patch: { thickness } })
  expect(plan.conflicts).toEqual([])
  const changed = { ...nodes }
  for (const change of plan.changes) {
    if (change.op === 'update')
      changed[change.id] = { ...changed[change.id], ...change.data } as AnyNode
  }
  return reconcileStructureOnLoad(changed).nodes
}

test('supported thickness holds the underside, lifts its storey and descendants, and preserves explicit wall height', () => {
  const before = house()
  const upper = base(before, 1)
  expect(floorFootprintSupportClass(before, upper)).toBe('supported')
  expect(floorPlateGestureMinimum(before, upper)).toBeCloseTo(0.02)
  expect(upperFloorHeightControl(before, upper, 0.35)).toEqual({
    currentTop: 0.05,
    minimumTop: 0.02,
    write: { thickness: 0.35 },
  })
  expect(upperFloorHeightControl(before, upper, 0.5)?.advice).toBe('thick-floor')
  const groundWall = before.wall_model_c_0_0_0 as WallNode
  const upperWall = before.wall_model_c_1_0_0 as WallNode
  const authored = { ...before, [upperWall.id]: { ...upperWall, height: 2.4 } }
  const authoredWall = authored[upperWall.id] as WallNode
  const groundTop = getWallPlaneTop(groundWall, groundWall.parentId!, before)
  const groundCeiling = getCeilingClampBound(groundWall.parentId!, before, polygon(0))
  const oldUnderside = upper.elevation - upper.thickness
  const after = apply(authored, upper, 0.3)
  const next = after[upper.id] as SlabNode
  expect(next.thickness).toBeCloseTo(0.3)
  expect(next.floorHeight).toBeUndefined()
  expect(next.elevation - next.thickness).toBeCloseTo(oldUnderside)
  expect(getWallPlaneTop(groundWall, groundWall.parentId!, after)).toBeCloseTo(groundTop)
  expect(getCeilingClampBound(groundWall.parentId!, after, polygon(0))).toBeCloseTo(groundCeiling)
  expect((after[upperWall.id] as WallNode).height).toBeCloseTo(2.4)
  const oldSupport = wallSupportForNodes(authoredWall, authored).elevation
  const newSupport = wallSupportForNodes(after[upperWall.id] as WallNode, after).elevation
  expect(newSupport - oldSupport).toBeCloseTo(0.25)
  expect(
    resolveWallTop(after[upperWall.id] as WallNode, 3, newSupport) -
      resolveWallTop(authoredWall, 3, oldSupport),
  ).toBeCloseTo(0.25)
  expect(getLevelElevations(after).get('level_model_c_2')!.baseY).toBeCloseTo(
    getLevelElevations(before).get('level_model_c_2')!.baseY + 0.25,
  )
  for (const ordinal of [0, 1, 2])
    expect(after[`level_model_c_${ordinal}`]).toEqual(before[`level_model_c_${ordinal}`])
  expect(reconcileStructureOnLoad(after).nodes).toEqual(after)
})

test('a house and garage wing require the grouped choice before moving their shared upper storey', () => {
  const nodes = house(true)
  const housePlate = base(nodes, 1)
  const garagePlate = base(nodes, 1, 10)
  const single = setFloorFoundation(nodes, { slabId: housePlate.id, patch: { thickness: 0.3 } })
  expect(single.changes).toEqual([])
  expect(single.conflicts?.[0]).toMatchObject({
    code: 'floor-foundation-shared-storey',
    message: expect.stringContaining('Garage floor'),
  })
  const grouped = setFloorFoundation(nodes, {
    slabIds: [housePlate.id, garagePlate.id],
    patch: { floorHeight: 0.3, thickness: 0.3 },
  })
  expect(grouped.conflicts).toEqual([])
  expect(
    grouped.changes.find((change) => change.op === 'update' && change.id === garagePlate.id),
  ).toMatchObject({ data: { elevation: 0.3, thickness: 0.3 } })
  const after = { ...nodes }
  for (const change of grouped.changes)
    if (change.op === 'update')
      after[change.id] = { ...after[change.id], ...change.data } as AnyNode
  expect((after[garagePlate.id] as SlabNode).thickness).toBeCloseTo(0.3)
  expect((after[garagePlate.id] as SlabNode).floorHeight).toBeUndefined()
})

test('grouped upper floors refuse when a sibling cannot keep minimum thickness', () => {
  const initial = house(true)
  const housePlate = base(initial, 1)
  const garagePlate = base(initial, 1, 10)
  const nodes = {
    ...initial,
    [housePlate.id]: { ...housePlate, thickness: 0.35, elevation: 0.35 },
  }
  const plan = setFloorFoundation(nodes, {
    slabIds: [housePlate.id, garagePlate.id],
    patch: { floorHeight: 0.05 },
  })
  expect(plan.changes).toEqual([])
  expect(plan.conflicts?.[0]).toMatchObject({
    code: 'floor-plate-thickness',
    nodeIds: [garagePlate.id],
    message: expect.stringContaining(garagePlate.id),
  })
})

test('upper height request thickens the plate without moving its underside or the storey below', () => {
  const before = house()
  const upper = base(before, 1)
  const groundWall = before.wall_model_c_0_0_0 as WallNode
  const oldUnderside = upper.elevation - upper.thickness
  const oldBelowTop = getWallPlaneTop(groundWall, groundWall.parentId!, before)
  const oldAbove = getLevelElevations(before).get('level_model_c_2')!.baseY
  const plan = setFloorFoundation(before, {
    slabId: upper.id,
    patch: { floorHeight: upper.elevation + 0.3 },
  })
  expect(plan.conflicts).toEqual([])
  const draft = { ...before }
  for (const change of plan.changes)
    if (change.op === 'update')
      draft[change.id] = { ...draft[change.id], ...change.data } as AnyNode
  const after = reconcileStructureOnLoad(draft).nodes
  const plate = after[upper.id] as SlabNode
  expect(plate.floorHeight).toBeUndefined()
  expect(plate.thickness).toBeCloseTo(upper.thickness + 0.3)
  expect(plate.elevation - plate.thickness).toBeCloseTo(oldUnderside)
  expect(getWallPlaneTop(groundWall, groundWall.parentId!, after)).toBeCloseTo(oldBelowTop)
  expect(getLevelElevations(after).get('level_model_c_2')!.baseY).toBeCloseTo(oldAbove + 0.3)
  expect(reconcileStructureOnLoad(after).nodes).toEqual(after)
})

test('legacy upper floorHeight becomes thickness on the first load', () => {
  const initial = house()
  const upper = base(initial, 1)
  const legacy = {
    ...initial,
    [upper.id]: { ...upper, elevation: 0.35, floorHeight: 0.35 },
  }
  const first = reconcileStructureOnLoad(legacy).nodes
  const migrated = first[upper.id] as SlabNode
  expect(migrated.floorHeight).toBeUndefined()
  expect(migrated.elevation).toBeCloseTo(0.35)
  expect(migrated.thickness).toBeCloseTo(0.35)
  expect(migrated.elevation - migrated.thickness).toBeCloseTo(0)
  expect(reconcileStructureOnLoad(first).nodes).toEqual(first)
})

test('a grouped choice may equalise previously unequal support lifts', () => {
  const initial = house(true)
  const housePlate = base(initial, 0)
  const garagePlate = base(initial, 0, 10)
  const nodes = {
    ...initial,
    [housePlate.id]: { ...housePlate, floorHeight: housePlate.elevation + 0.4 },
  }
  const equalise = setFloorFoundation(nodes, {
    slabId: garagePlate.id,
    patch: { floorHeight: garagePlate.elevation + 0.4 },
  })
  expect(equalise.conflicts).toEqual([])
})

test('a small overlap does not turn an upper plate into a ground foundation', () => {
  const initial = house()
  const upper = base(initial, 1)
  const plate = {
    ...upper,
    polygon: [
      [3.2, 3.2],
      [5.2, 3.2],
      [5.2, 5.2],
      [3.2, 5.2],
    ] as [number, number][],
  }
  const nodes = Object.fromEntries(
    Object.entries({ ...initial, [plate.id]: plate }).filter(
      ([id, node]) => id !== 'level_model_c_2' && node.parentId !== 'level_model_c_2',
    ),
  ) as Record<string, AnyNode>
  expect(floorFootprintSupportClass(nodes, plate)).toBe('ground-bearing')
  expect(floorPlateAtGroundContact(nodes, plate)).toBe(false)
  expect(floorPlateHoldsUnderside(nodes, plate)).toBe(true)
  expect(floorPlateGestureMinimum(nodes, plate)).toBeCloseTo(0.02)
  const plan = setFloorFoundation(nodes, { slabId: plate.id, patch: { thickness: 0.3 } })
  expect(plan.conflicts).toEqual([])
  expect(
    plan.changes.find((change) => change.op === 'update' && change.id === plate.id),
  ).toMatchObject({ data: { elevation: 0.3, thickness: 0.3 } })
  const draft = { ...nodes }
  for (const change of plan.changes)
    if (change.op === 'update')
      draft[change.id] = { ...draft[change.id], ...change.data } as AnyNode
  const lower = initial.wall_model_c_0_0_0 as WallNode
  expect(getWallPlaneTop(lower, lower.parentId!, draft)).toBeCloseTo(
    getWallPlaneTop(lower, lower.parentId!, nodes),
  )
  const height = setFloorFoundation(nodes, {
    slabId: plate.id,
    patch: { floorHeight: 0.35 },
  })
  expect(height.conflicts).toEqual([])
  expect(
    height.changes.find((change) => change.op === 'update' && change.id === plate.id),
  ).toMatchObject({
    data: { elevation: 0.35, thickness: 0.35, floorHeight: undefined },
  })
})

test('plate paint does not change any storey displacement', () => {
  const nodes = house()
  const plate = base(nodes, 0)
  const painted = {
    ...nodes,
    [plate.id]: { ...plate, slots: { ...plate.slots, surface: 'library:preset-oak' } },
  }
  expect(changedLevelConstructionDisplacements(nodes, painted).size).toBe(0)
})

test('a level stair arrives at the upstairs walking surface after its plate lifts', () => {
  const nodes = house()
  const stair = StairNode.parse({
    id: 'stair_model_c',
    parentId: 'level_model_c_0',
    position: [2, 0, 2],
  })
  nodes[stair.id] = stair
  const level = nodes.level_model_c_0 as LevelNode
  nodes[level.id] = { ...level, children: [...level.children, stair.id] }
  const beforeRise = resolveStairTotalRise(stair, nodes, () => 0.05)
  expect(beforeRise).toBeCloseTo(3)
  const raised = apply(nodes, base(nodes, 1), 0.3)
  const rise = resolveStairTotalRise(stair, raised, () => 0.05)
  expect(rise).toBeCloseTo(3.25)
  expect(rise + 0.05).toBeCloseTo(
    getLevelElevations(raised).get('level_model_c_1')!.baseY -
      getLevelElevations(raised).get('level_model_c_0')!.baseY +
      (base(raised, 1).elevation ?? 0),
  )
  const room = raised.zone_model_c_1_0 as ZoneNode
  const withRoomStep = {
    ...raised,
    [room.id]: { ...room, floor: { ...room.floor, elevation: 0.65 } },
  }
  expect(resolveStairTotalRise(stair, withRoomStep, () => 0.05)).toBeCloseTo(3.6)
})

test('a mezzanine ceiling keeps its identity when its supported floor lifts', () => {
  const initial = house()
  const mezzanine = ZoneNode.parse({
    id: 'zone_model_c_mezzanine',
    parentId: 'level_model_c_1',
    name: 'Mezzanine',
    spaceRole: 'room',
    hostZoneId: 'zone_model_c_1_0',
    polygon: polygon(0.5, 2),
    floor: { support: 'open', elevation: 0.7, thickness: 0.2 },
  })
  const level = initial.level_model_c_1 as LevelNode
  const before = reconcileStructureOnLoad({
    ...initial,
    [mezzanine.id]: mezzanine,
    [level.id]: { ...level, children: [...level.children, mezzanine.id] },
  }).nodes
  const ceiling = Object.values(before).find(
    (node) => node.type === 'ceiling' && node.zoneId === mezzanine.id,
  )
  expect(ceiling).toBeDefined()
  const after = apply(before, base(before, 1), 0.3)
  expect(after[ceiling!.id]).toMatchObject({ type: 'ceiling', zoneId: mezzanine.id })
  expect((after[mezzanine.id] as ZoneNode).floor?.elevation).toBeCloseTo(0.95)
})

test('upper height cannot reduce its plate below the minimum thickness', () => {
  const nodes = house()
  const wall = nodes.wall_model_c_0_0_0 as WallNode
  const door = DoorNode.parse({
    id: 'door_model_c_lower',
    parentId: wall.id,
    wallId: wall.id,
    verticalAnchor: 'floor',
    position: [2, 1.4, 0],
    height: 2.8,
  })
  nodes[door.id] = door
  nodes[wall.id] = { ...wall, children: [...wall.children, door.id] }
  const plate = base(nodes, 1)
  const plan = setFloorFoundation(nodes, { slabId: plate.id, patch: { floorHeight: -0.2 } })
  expect(plan.changes).toEqual([])
  expect(plan.conflicts?.some((conflict) => conflict.code === 'floor-plate-thickness')).toBe(true)
})

test('lowering an upper plate keeps the explicit wall below unchanged', () => {
  const initial = house()
  const upper = base(initial, 1)
  const raised = apply(initial, upper, 0.3)
  const lowerWall = raised.wall_model_c_0_0_0 as WallNode
  const nodes = { ...raised, [lowerWall.id]: { ...lowerWall, height: 2.95 } }
  const plan = setFloorFoundation(nodes, {
    slabId: upper.id,
    patch: { floorHeight: 0.05 },
  })
  expect(plan.conflicts).toEqual([])
  const draft = { ...nodes }
  for (const change of plan.changes)
    if (change.op === 'update')
      draft[change.id] = { ...draft[change.id], ...change.data } as AnyNode
  expect(getWallPlaneTop(lowerWall, lowerWall.parentId!, draft)).toBeCloseTo(
    getWallPlaneTop(lowerWall, lowerWall.parentId!, nodes),
  )
})

test('support follows actual lower plate coverage, including grade over a basement', () => {
  const nodes = house(true)
  const basement = LevelNode.parse({
    id: 'level_model_c_basement',
    parentId: 'building_model_c',
    level: -1,
    height: 3,
  })
  const room = {
    ...(nodes.zone_model_c_0_0 as ZoneNode),
    id: 'zone_model_c_basement',
    parentId: basement.id,
  }
  const plate = {
    ...base(nodes, 0),
    id: 'slab_model_c_basement',
    parentId: basement.id,
    zoneIds: [room.id],
  } as SlabNode
  const graph = { ...nodes, [basement.id]: basement, [room.id]: room, [plate.id]: plate }
  expect(floorFootprintSupportClass(graph, plate)).toBe('ground-bearing')
  expect(floorFootprintSupportClass(graph, base(graph, 0))).toBe('supported')
  expect(floorFootprintSupportClass(graph, base(graph, 0, 10))).toBe('ground-bearing')
})

test('ground and supported lifts add along a three-storey support path', () => {
  const initial = house()
  const ground = setFloorFoundation(initial, {
    slabId: base(initial, 0).id,
    patch: { floorHeight: 0.45 },
  })
  expect(ground.conflicts).toEqual([])
  const draft = { ...initial }
  for (const change of ground.changes)
    if (change.op === 'update')
      draft[change.id] = { ...draft[change.id], ...change.data } as AnyNode
  const raised = reconcileStructureOnLoad(draft).nodes
  const both = apply(raised, base(raised, 1), 0.3)
  expect(getLevelElevations(both).get('level_model_c_1')!.baseY).toBeCloseTo(
    getLevelElevations(initial).get('level_model_c_1')!.baseY + 0.4,
  )
  expect(getLevelElevations(both).get('level_model_c_2')!.baseY).toBeCloseTo(
    getLevelElevations(initial).get('level_model_c_2')!.baseY + 0.65,
  )
})
