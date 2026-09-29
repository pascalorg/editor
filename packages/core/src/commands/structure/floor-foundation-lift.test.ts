import { afterEach, expect, test } from 'bun:test'
import { GROUND_SUPPORT_ID } from '../../hooks/spatial-grid/support-host-id'
import { floorConstructionLift, liftedManualSlab } from '../../lib/floor-construction-lift'
import { automaticFloorHeight } from '../../lib/floor-foundation-datum'
import { expandFloorIntentChanges, floorIntentConflicts } from '../../lib/floor-intent-changes'
import { wallSupportForNodes } from '../../lib/opening-floor-datum'
import {
  type AnyNode,
  BuildingNode,
  CeilingNode,
  ColumnNode,
  FenceNode,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  SlabNode,
  WallNode,
  ZoneNode,
} from '../../schema'
import { resolveCeilingHeight } from '../../services/level-height'
import { getLevelElevations, getWallPlaneTop } from '../../services/storey'
import useScene from '../../store/use-scene'
import { resolveRoofElevation } from '../../systems/roof/roof-elevation'
import { reconcileStructureOnLoad } from '../../utils/reconcile-structure-on-load'
import { createZone, outdoorRoomConflicts } from './create-zone'
import { setFloorFoundation } from './set-floor-foundation'
import { type StructurePlan, structureChangeBatch } from './shared'

const rect = (x: number, width = 4): [number, number][] => [
  [x, 0],
  [x + width, 0],
  [x + width, 4],
  [x, 4],
]

function scene(shared = false) {
  const building = BuildingNode.parse({ id: 'building_lift' })
  const levels = [0, 1, 2].map((level) =>
    LevelNode.parse({ id: `level_lift${level}`, parentId: building.id, level, height: 3 }),
  )
  building.children = levels.map((level) => level.id)
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [building, ...levels].map((node) => [node.id, node]),
  )
  for (const [i, x] of [0, 10].entries()) {
    const polygon = rect(x)
    const zone = ZoneNode.parse({
      id: `zone_lift${i}`,
      parentId: levels[0]!.id,
      name: i ? 'Shed floor' : 'Shared floor',
      spaceRole: 'room',
      polygon,
    })
    nodes[zone.id] = zone
    polygon.forEach((start, at) => {
      const wall = WallNode.parse({
        id: `wall_lift${i}_${at}`,
        parentId: levels[0]!.id,
        start,
        end: polygon[(at + 1) % 4],
      })
      nodes[wall.id] = wall
    })
    const ceiling = CeilingNode.parse({
      id: `ceiling_lift${i}`,
      parentId: levels[0]!.id,
      polygon,
      boundary: 'auto',
      autoFromWalls: true,
      zoneId: zone.id,
    })
    nodes[ceiling.id] = ceiling
  }
  for (const level of levels.slice(1)) {
    const slab = SlabNode.parse({
      id: `slab_${level.level}`,
      parentId: level.id,
      polygon: rect(0, shared ? 14 : 4),
    })
    nodes[slab.id] = slab
  }
  const roof = RoofNode.parse({
    id: 'roof_lift',
    parentId: levels[0]!.id,
    support: { kind: 'walls' },
    position: [2, 0, 2],
    children: ['rseg_lift'],
  })
  const segment = RoofSegmentNode.parse({ id: 'rseg_lift', parentId: roof.id, width: 4, depth: 4 })
  nodes[roof.id] = roof
  nodes[segment.id] = segment
  nodes.roof_custom = RoofNode.parse({
    id: 'roof_custom',
    parentId: levels[0]!.id,
    position: [2, 3, 2],
  })
  for (const level of levels)
    level.children = Object.values(nodes)
      .filter((node) => node.parentId === level.id)
      .map((node) => node.id) as LevelNode['children']
  return reconcileStructureOnLoad(nodes).nodes
}

function base(nodes: Record<string, AnyNode>, zone = 'zone_lift0') {
  return Object.values(nodes).find(
    (node): node is SlabNode =>
      node.type === 'slab' && node.plateRole === 'base' && !!node.zoneIds?.includes(zone),
  )!
}
function apply(nodes: Record<string, AnyNode>, plan: StructurePlan) {
  expect(plan.conflicts).toEqual([])
  const next = { ...nodes }
  for (const change of plan.changes)
    if (change.op === 'update') next[change.id] = { ...next[change.id], ...change.data } as AnyNode
  return reconcileStructureOnLoad(next).nodes
}

afterEach(() => {
  useScene.getState().unloadScene()
  useScene.temporal.getState().clear()
})

test('footprint lift follows the storey, ceilings and roofs; upper levels move once; shed stays put; reset reverses', () => {
  const before = scene()
  const plate = base(before)
  const wall = before.wall_lift0_0 as WallNode
  const raised = apply(
    before,
    setFloorFoundation(before, { slabId: plate.id, patch: { floorHeight: 0.55 } }),
  )
  expect(raised[wall.id]).not.toHaveProperty('height')
  expect(getWallPlaneTop(wall, wall.parentId!, raised)).toBeCloseTo(3.5)
  expect(wallSupportForNodes(wall, raised).elevation).toBeCloseTo(0.55)
  expect(resolveCeilingHeight(raised.ceiling_lift0 as CeilingNode, raised)).toBeCloseTo(3.49)
  expect(resolveRoofElevation(raised.roof_lift as RoofNode, raised)).toBeCloseTo(3.5)
  expect((raised.roof_custom as RoofNode).position[1]).toBe(3.5)
  expect(getWallPlaneTop(before.wall_lift1_0 as WallNode, wall.parentId!, raised)).toBe(3)
  expect(resolveCeilingHeight(raised.ceiling_lift1 as CeilingNode, raised)).toBeCloseTo(2.99)
  expect(base(raised, 'zone_lift1')).toEqual(base(before, 'zone_lift1'))
  expect(getLevelElevations(raised).get('level_lift1')!.baseY).toBe(3.5)
  expect(getLevelElevations(raised).get('level_lift2')!.baseY).toBe(6.5)
  const taller = { ...raised, level_lift0: { ...raised.level_lift0, height: 4 } as AnyNode }
  expect(getWallPlaneTop(wall, wall.parentId!, taller)).toBeCloseTo(4.5)
  const reset = apply(
    raised,
    setFloorFoundation(raised, { slabId: plate.id, patch: { floorHeight: null } }),
  )
  expect(reset[wall.id]).not.toHaveProperty('height')
  expect(getWallPlaneTop(wall, wall.parentId!, reset)).toBe(3)
  expect(getLevelElevations(reset)).toEqual(getLevelElevations(before))
  expect(reset.roof_custom).toEqual(before.roof_custom)
  expect(reconcileStructureOnLoad(raised).nodes).toEqual(raised)
})

test('an upper floor spanning house and shed refuses one lift, accepts a matching batch', () => {
  const nodes = scene(true)
  const house = base(nodes),
    shed = base(nodes, 'zone_lift1')
  const plan = setFloorFoundation(nodes, { slabId: house.id, patch: { floorHeight: 0.55 } })
  expect(plan.changes).toEqual([])
  expect(plan.conflicts?.[0]).toMatchObject({
    code: 'floor-foundation-shared-storey',
    message: 'The upper floor also sits over Shed floor; raise both or neither.',
  })
  const updates = expandFloorIntentChanges(
    nodes,
    [house, shed].map((plate) => ({ id: plate.id, data: { floorHeight: 0.55 } })),
  )
  expect(floorIntentConflicts(nodes, updates)).toEqual([])
  expect(updates.filter((update) => update.id === 'level_lift1')).toEqual([])
  const batch = setFloorFoundation(nodes, {
    slabIds: [house.id, shed.id],
    patch: { floorHeight: 0.55 },
  })
  const raised = apply(nodes, batch)
  expect(getLevelElevations(raised).get('level_lift1')!.baseY).toBe(3.5)
})

test('the whole lift is one undo step', () => {
  const nodes = scene()
  useScene.setState({ nodes, rootNodeIds: ['building_lift'], readOnly: false })
  useScene.temporal.getState().clear()
  const plan = setFloorFoundation(nodes, { slabId: base(nodes).id, patch: { floorHeight: 0.55 } })
  useScene.getState().applyNodeChanges(structureChangeBatch(plan.changes))
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  expect(getLevelElevations(useScene.getState().nodes).get('level_lift2')!.baseY).toBe(6.5)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes).toEqual(nodes)
})

test('migration removes only explicit wall heights equal to footprint following', () => {
  const nodes = scene()
  const plate = base(nodes)
  const old = {
    ...nodes,
    [plate.id]: { ...plate, floorHeight: 0.55 },
    wall_lift0_0: { ...nodes.wall_lift0_0, height: 2.95 },
    wall_lift0_1: { ...nodes.wall_lift0_1, height: 1.7 },
  } as Record<string, AnyNode>
  const first = reconcileStructureOnLoad(old).nodes
  expect(first.wall_lift0_0).not.toHaveProperty('height')
  expect(first.wall_lift0_1).toHaveProperty('height', 1.7)
  expect(reconcileStructureOnLoad(first).nodes).toEqual(first)
})

test('a rotated custom roof follows its segment footprint even when its origin is outside the house', () => {
  const nodes = scene()
  const roof = RoofNode.parse({
    id: 'roof_offset',
    parentId: 'level_lift0',
    position: [20, 3, 2],
    rotation: Math.PI / 2,
    children: ['rseg_offset'],
  })
  const segment = RoofSegmentNode.parse({
    id: 'rseg_offset',
    parentId: roof.id,
    width: 4,
    depth: 4,
    position: [0, 0, -18],
  })
  const source = { ...nodes, [roof.id]: roof, [segment.id]: segment }
  const plan = setFloorFoundation(source, { slabId: base(source).id, patch: { floorHeight: 0.55 } })
  expect(plan.conflicts).toEqual([])
  expect(
    plan.changes.find((change) => change.op === 'update' && change.id === roof.id),
  ).toMatchObject({ data: { position: [20, 3.5, 2] } })
})

test('existing upper-level offsets are preserved when lifting and resetting a footprint', () => {
  const initial = scene()
  const nodes: Record<string, AnyNode> = {
    ...initial,
    level_lift1: { ...initial.level_lift1, baseElevation: 0.7 } as AnyNode,
  }
  const wall = nodes.wall_lift0_0 as WallNode
  const before = getWallPlaneTop(wall, wall.parentId!, nodes)
  const raised = apply(
    nodes,
    setFloorFoundation(nodes, { slabId: base(nodes).id, patch: { floorHeight: 0.55 } }),
  )
  expect(getWallPlaneTop(wall, wall.parentId!, raised) - before).toBeCloseTo(0.5)
  expect(getLevelElevations(raised).get('level_lift2')!.baseY).toBeCloseTo(7.2)
  const reset = apply(
    raised,
    setFloorFoundation(raised, { slabId: base(raised).id, patch: { floorHeight: null } }),
  )
  expect(getLevelElevations(reset)).toEqual(getLevelElevations(nodes))
})

test('automatic footprint datum refreshes after support changes in a reconciliation graph', () => {
  const nodes = scene()
  const plate = base(nodes)
  expect(automaticFloorHeight(nodes, plate)).toBeCloseTo(0.05)
  const wall = nodes.wall_lift0_0 as WallNode
  nodes[wall.id] = { ...wall, supportSlabId: GROUND_SUPPORT_ID, supportOffset: 0.2 }
  expect(automaticFloorHeight(nodes, plate)).toBeCloseTo(0.25)
  expect(automaticFloorHeight({ ...nodes }, plate)).toBeCloseTo(0.25)
  nodes[wall.id] = wall
  expect(automaticFloorHeight(nodes, plate)).toBeCloseTo(0.05)
})

test('upper construction can appear or disappear while raised without wall drift or reset residue', () => {
  const initial = scene()
  for (const empty of [false, true]) {
    const before = { ...initial }
    if (empty) {
      delete before.slab_1
      delete before.slab_2
    }
    const raised = apply(
      before,
      setFloorFoundation(before, { slabId: base(before).id, patch: { floorHeight: 0.55 } }),
    )
    const changed = { ...raised }
    if (empty) {
      changed.slab_1 = initial.slab_1!
      changed.slab_2 = initial.slab_2!
    } else {
      delete changed.slab_1
      delete changed.slab_2
    }
    expect(getWallPlaneTop(changed.wall_lift0_0 as WallNode, 'level_lift0', changed)).toBeCloseTo(
      3.5,
    )
    expect(getWallPlaneTop(changed.wall_lift1_0 as WallNode, 'level_lift0', changed)).toBe(3)
    expect(getLevelElevations(changed).get('level_lift1')!.baseY).toBe(empty ? 3.5 : 3)
    const reset = apply(
      changed,
      setFloorFoundation(changed, { slabId: base(changed).id, patch: { floorHeight: null } }),
    )
    expect(getLevelElevations(reset).get('level_lift1')!.baseY).toBe(3)
    expect(reset.level_lift1).toHaveProperty('baseElevation', 0)
  }
})

test('automatic ground datum changes leave no stack residue on reset', () => {
  const before = scene()
  const raised = apply(
    before,
    setFloorFoundation(before, { slabId: base(before).id, patch: { floorHeight: 0.55 } }),
  )
  const changed = {
    ...raised,
    wall_lift0_0: { ...raised.wall_lift0_0, supportSlabId: 'ground', supportOffset: 0.3 },
  } as Record<string, AnyNode>
  expect(getLevelElevations(changed).get('level_lift1')!.baseY).toBeCloseTo(3.2)
  const reset = apply(
    changed,
    setFloorFoundation(changed, { slabId: base(changed).id, patch: { floorHeight: null } }),
  )
  expect(getLevelElevations(reset).get('level_lift1')!.baseY).toBe(3)
  expect(getLevelElevations(reset).get('level_lift2')!.baseY).toBe(6)
})

test('shared roof and custom ceiling require both footprints, and translate only once', () => {
  for (const type of ['roof', 'ceiling']) {
    const before = scene()
    const shared =
      type === 'roof'
        ? RoofNode.parse({
            id: 'roof_shared',
            parentId: 'level_lift0',
            position: [7, 3, 2],
            children: ['rseg_shared'],
          })
        : CeilingNode.parse({
            id: 'ceiling_shared',
            parentId: 'level_lift0',
            polygon: rect(0, 14),
            height: 2.5,
          })
    const nodes = {
      ...before,
      [shared.id]: shared,
      rseg_shared: RoofSegmentNode.parse({
        id: 'rseg_shared',
        parentId: 'roof_shared',
        width: 14,
        depth: 4,
      }),
    }
    const ids = [base(nodes).id, base(nodes, 'zone_lift1').id]
    expect(
      setFloorFoundation(nodes, { slabId: ids[0], patch: { floorHeight: 0.55 } }).conflicts?.[0]
        ?.code,
    ).toBe('floor-foundation-shared-storey')
    const plan = setFloorFoundation(nodes, { slabIds: ids, patch: { floorHeight: 0.55 } })
    expect(plan.conflicts).toEqual([])
    expect(
      plan.changes.filter((change) => change.op === 'update' && change.id === shared.id),
    ).toEqual([
      {
        op: 'update',
        id: shared.id,
        data: type === 'roof' ? { position: [7, 3.5, 2] } : { height: 3 },
      },
    ])
  }
})

test('roomless and tiny footprint remnants do not block the upper storey and follow its lift', () => {
  const nodes = scene()
  const sliver = SlabNode.parse({
    id: 'slab_sliver',
    parentId: 'level_lift0',
    plateRole: 'base',
    boundary: 'auto',
    polygon: [
      [3.8, 0],
      [4, 0],
      [4, 4],
      [3.8, 4],
    ],
    zoneIds: [],
  })
  nodes[sliver.id] = sliver
  const plan = setFloorFoundation(nodes, { slabId: base(nodes).id, patch: { floorHeight: 0.55 } })
  expect(plan.conflicts).toEqual([])
  expect(
    plan.changes.find((change) => change.op === 'update' && change.id === sliver.id),
  ).toMatchObject({ data: { floorHeight: 0.55 } })
})

test('roof overhang on an upper storey does not make the shed its support', () => {
  const nodes = scene()
  nodes.roof_overhang = RoofNode.parse({
    id: 'roof_overhang',
    parentId: 'level_lift1',
    position: [12, 0, 2],
  })
  expect(
    setFloorFoundation(nodes, { slabId: base(nodes).id, patch: { floorHeight: 0.55 } }).conflicts,
  ).toEqual([])
})

test('manual decks and ground-hosted construction keep ground-relative heights inside the lifted footprint', () => {
  const before = scene()
  const deck = SlabNode.parse({
    id: 'slab_deck',
    parentId: 'level_lift0',
    polygon: [
      [1, 1],
      [3, 1],
      [3, 3],
      [1, 3],
    ],
    elevation: 0.3,
  })
  const fence = FenceNode.parse({
    id: 'fence_ground',
    parentId: deck.parentId,
    start: [1, 1],
    end: [3, 1],
    supportSlabId: 'ground',
  })
  const column = ColumnNode.parse({
    id: 'column_ground',
    parentId: deck.parentId,
    position: [2, 0.2, 2],
    supportSlabId: 'ground',
  })
  const wall = WallNode.parse({
    id: 'wall_ground',
    parentId: deck.parentId,
    start: [1, 0.5],
    end: [3, 0.5],
    supportSlabId: 'ground',
    supportOffset: 0.2,
  })
  const nodes = {
    ...before,
    [deck.id]: deck,
    [fence.id]: fence,
    [column.id]: column,
    [wall.id]: wall,
  }
  const plan = setFloorFoundation(nodes, { slabId: base(nodes).id, patch: { floorHeight: 0.55 } })
  expect(plan.conflicts).toEqual([])
  const raised = { ...nodes }
  for (const change of plan.changes)
    if (change.op === 'update')
      raised[change.id] = { ...raised[change.id], ...change.data } as AnyNode
  expect(liftedManualSlab(raised, deck).elevation).toBeCloseTo(0.8)
  expect(floorConstructionLift(raised, fence)).toBeCloseTo(0.5)
  expect(floorConstructionLift(raised, column)).toBeCloseTo(0.5)
  expect(wallSupportForNodes(wall, raised).elevation).toBeCloseTo(0.7)
  expect(liftedManualSlab(raised, { ...deck, polygon: rect(10, 2) }).elevation).toBe(0.3)
  expect(raised[deck.id]).toEqual(deck)
  const reset = { ...raised, [base(nodes).id]: { ...base(nodes), floorHeight: undefined } }
  expect(liftedManualSlab(reset, deck)).toBe(deck)
  expect(wallSupportForNodes(wall, reset).elevation).toBeCloseTo(0.2)
})

test('core outdoor overlap is refused before creating separators; adjoining terraces are allowed', () => {
  const nodes = scene()
  const polygon = rect(1)
  expect(outdoorRoomConflicts(nodes, 'level_lift0', polygon)).toHaveLength(1)
  const mintId = () => {
    throw new Error('must not mint on refusal')
  }
  expect(
    createZone(nodes, { levelId: 'level_lift0', polygon, enclose: false, mintId }).conflicts?.[0]
      ?.code,
  ).toBe('outdoor-room-overlap')
  expect(outdoorRoomConflicts(nodes, 'level_lift0', rect(4))).toEqual([])
})

test('an upper wall retains its storey height when the next upper storey is empty', () => {
  const nodes = scene()
  delete nodes.slab_2
  const wall = WallNode.parse({
    id: 'wall_upper',
    parentId: 'level_lift1',
    start: [0, 0],
    end: [4, 0],
  })
  nodes[wall.id] = wall
  const raised = apply(
    nodes,
    setFloorFoundation(nodes, { slabId: base(nodes).id, patch: { floorHeight: 0.55 } }),
  )
  expect(getLevelElevations(raised).get('level_lift1')!.baseY).toBe(3.5)
  expect(getWallPlaneTop(wall, wall.parentId!, raised)).toBe(3)
  expect(raised[wall.id]).not.toHaveProperty('height')
})

test('a tiny room carried under the upper storey retains its own floor step', () => {
  const nodes = scene()
  const polygon: [number, number][] = [
    [3.8, 0],
    [4, 0],
    [4, 4],
    [3.8, 4],
  ]
  const zone = ZoneNode.parse({
    id: 'zone_tiny',
    name: 'Tiny room',
    parentId: 'level_lift0',
    polygon,
    spaceRole: 'room',
    floor: { elevation: 0.25 },
  })
  const sliver = SlabNode.parse({
    id: 'slab_tiny',
    parentId: zone.parentId,
    plateRole: 'base',
    boundary: 'auto',
    polygon,
    zoneIds: [zone.id],
  })
  const graph = { ...nodes, [zone.id]: zone, [sliver.id]: sliver }
  const plan = setFloorFoundation(graph, { slabId: base(graph).id, patch: { floorHeight: 0.55 } })
  expect(plan.conflicts).toEqual([])
  expect(
    plan.changes.find((change) => change.op === 'update' && change.id === zone.id),
  ).toMatchObject({ data: { floor: { elevation: 0.75 } } })
})
