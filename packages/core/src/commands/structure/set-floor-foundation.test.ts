import { expect, test } from 'bun:test'
import { getOpeningFloorDatum, wallSupportForNodes } from '../../lib/opening-floor-datum'
import { type AnyNode, BuildingNode, LevelNode, type SlabNode, type ZoneNode } from '../../schema'
import { filterDerivedNodeWrites } from '../../store/derived-node-guard'
import { floorStepFixture } from '../../systems/slab/__fixtures__/floor-step'
import { migrateFloorPlates } from '../../utils/floor-plate-migration'
import { reconcileStructureOnLoad } from '../../utils/reconcile-structure-on-load'
import { FloorFoundationPatch, setFloorFoundation } from './set-floor-foundation'

function scene() {
  const f = floorStepFixture()
  const nodes = Object.fromEntries(
    Object.entries(f.nodes).filter(([, node]) => node.type !== 'slab'),
  )
  for (const node of Object.values({ ...nodes })) {
    if (node.type === 'level') continue
    const copy = { ...node, id: `${node.id}_shed` }
    if (copy.type === 'wall')
      Object.assign(copy, {
        start: [copy.start[0] + 20, copy.start[1]],
        end: [copy.end[0] + 20, copy.end[1]],
      })
    if (copy.type === 'zone')
      Object.assign(copy, { polygon: copy.polygon.map(([x, z]) => [x + 20, z]) })
    nodes[copy.id] = copy as AnyNode
  }
  nodes[f.door.id] = f.door
  nodes[f.divider.id] = { ...f.divider, children: [f.door.id] }
  nodes[f.level.id] = {
    ...f.level,
    children: Object.values(nodes)
      .filter((n) => n.parentId === f.level.id)
      .map((n) => n.id) as LevelNode['children'],
  }
  return { ...f, nodes: reconcileStructureOnLoad(nodes).nodes }
}
const bases = (nodes: Record<string, AnyNode>) =>
  Object.values(nodes).filter((n): n is SlabNode => n.type === 'slab' && n.plateRole === 'base')

test('one footprint command moves its walls, opening and explicit room steps; shed stays unchanged', () => {
  const s = scene()
  const base = bases(s.nodes).find((p) => p.zoneIds?.includes(s.zones[0]!.id))!
  const shed = bases(s.nodes).find((p) => p.id !== base.id)!
  const plan = setFloorFoundation(s.nodes, {
    slabId: base.id,
    patch: {
      floorHeight: 0.55,
      thickness: 0.2,
      foundation: { type: 'solid', material: 'library:concrete-raw' },
    },
  })
  expect(plan.conflicts).toEqual([])
  expect(plan.changes.length).toBeGreaterThanOrEqual(3)
  const updates = plan.changes.flatMap((c) => (c.op === 'update' ? [c] : []))
  const filtered = filterDerivedNodeWrites(s.nodes, { update: updates })
  expect(filtered.update.map(({ id, data }) => ({ id, data }))).toEqual(
    updates.map(({ id, data }) => ({ id, data })),
  )
  let nodes = { ...s.nodes }
  for (const { id, data } of filtered.update) nodes[id] = { ...nodes[id], ...data } as AnyNode
  nodes = reconcileStructureOnLoad(nodes).nodes
  expect(nodes[base.id]).toMatchObject({
    elevation: 0.55,
    floorHeight: 0.55,
    thickness: 0.2,
    foundation: { type: 'solid' },
  })
  expect(nodes[shed.id]).toEqual(shed)
  expect((nodes[s.zones[1]!.id] as ZoneNode).floor!.elevation).toBeCloseTo(0.1)
  expect(wallSupportForNodes(s.divider, nodes).elevation).toBe(0.55)
  expect(getOpeningFloorDatum(s.divider, s.door, nodes)).toBe(0.55)
  expect(reconcileStructureOnLoad(nodes).nodes).toEqual(nodes)
  const reset = setFloorFoundation(nodes, { slabId: base.id, patch: { floorHeight: null } })
  expect(reset.conflicts).toEqual([])
  expect(reset.changes.find((c) => c.op === 'update' && c.id === s.zones[1]!.id)).toMatchObject({
    // Back on the ground the 0.2 slab sits on grade: its top drops 0.35, not to the default 0.05.
    data: { floor: { elevation: expect.closeTo(-0.25) } },
  })
})

test.each([
  true,
  false,
])('migration replaces level intent and fillToTerrain=%s once, manual slabs unchanged', (fillToTerrain) => {
  const s = scene()
  const plates = bases(s.nodes)
  const input = {
    ...s.nodes,
    [s.level.id]: { ...s.nodes[s.level.id], floorElevation: 0.35 },
  } as Record<string, AnyNode>
  for (const plate of plates)
    input[plate.id] = {
      ...plate,
      foundation: undefined,
      fillToTerrain,
      slots: { edge: 'library:stone' },
    }
  const manual = {
    ...plates[0]!,
    id: 'slab_manual' as SlabNode['id'],
    boundary: undefined,
    autoFromWalls: false,
    plateRole: undefined,
    fillToTerrain,
  }
  input[manual.id] = manual
  const first = migrateFloorPlates(input).nodes as Record<string, AnyNode>
  expect(first[s.level.id]).not.toHaveProperty('floorElevation')
  for (const plate of plates) {
    expect(first[plate.id]).toMatchObject({
      floorHeight: 0.35,
      foundation: { type: fillToTerrain ? 'solid' : 'none' },
    })
    expect(first[plate.id]).not.toHaveProperty('fillToTerrain')
    if (fillToTerrain)
      expect((first[plate.id] as SlabNode).foundation!.material).toBe('library:stone')
  }
  expect(first[manual.id]).toEqual(manual)
  expect(migrateFloorPlates(first).nodes).toEqual(first)
})

test('a newly drawn shed gets thin construction without copying the house settings', () => {
  const s = scene()
  const [house, shed] = bases(s.nodes)
  const nodes = {
    ...s.nodes,
    [house!.id]: {
      ...house!,
      thickness: 0.3,
      floorHeight: 0.4,
      foundation: { type: 'solid' as const },
      slots: { edge: 'library:stone' },
    },
  }
  delete nodes[shed!.id]
  const next = reconcileStructureOnLoad(nodes).nodes
  const fresh = bases(next).find((p) => p.id !== house!.id)!
  expect(fresh.thickness).toBe(0.05)
  expect(fresh.floorHeight).toBeUndefined()
  expect(fresh.foundation).toEqual({ type: 'none' })
  expect(fresh.slots?.edge).toBeUndefined()
})

test('a plate with actual support accepts height and refuses a solid foundation', () => {
  const s = scene()
  const base = bases(s.nodes)[0]!
  const ground = LevelNode.parse({ id: 'level_ground', level: 0 })
  const building = BuildingNode.parse({ children: [ground.id, s.level.id] })
  const nodes = {
    ...s.nodes,
    [building.id]: building,
    [ground.id]: { ...ground, parentId: building.id },
    [s.level.id]: { ...s.level, level: 1, parentId: building.id },
    zone_ground_room: { ...s.zones[0]!, id: 'zone_ground_room', parentId: ground.id },
    slab_ground_plate: {
      ...base,
      id: 'slab_ground_plate',
      parentId: ground.id,
      zoneIds: ['zone_ground_room'],
    },
  }
  const height = setFloorFoundation(nodes, { slabId: base.id, patch: { floorHeight: 1 } })
  expect(height.conflicts).toEqual([])
  expect(
    height.changes.find((change) => change.op === 'update' && change.id === base.id),
  ).toMatchObject({
    data: { elevation: 1, thickness: 1, floorHeight: undefined },
  })
  const plan = setFloorFoundation(nodes, {
    slabId: base.id,
    patch: { floorHeight: 1, foundation: { type: 'solid' } },
  })
  expect(plan.changes).toEqual([])
  expect(plan.conflicts?.[0]?.code).toBe('floor-foundation-level')
  const loaded = reconcileStructureOnLoad({
    ...nodes,
    [base.id]: { ...base, floorHeight: 1, foundation: { type: 'solid' } },
  }).nodes
  expect(loaded[base.id]).toMatchObject({
    elevation: 1,
    thickness: 1,
    foundation: { type: 'none' },
  })
  expect((loaded[base.id] as SlabNode).floorHeight).toBeUndefined()
})

test('foundation patch only accepts construction side slots', () => {
  expect(
    FloorFoundationPatch.safeParse({
      slots: { edge: 'library:stone', riser: 'library:stone', underside: 'library:stone' },
    }).success,
  ).toBe(true)
  for (const key of ['surface', 'foundation', 'anything'])
    expect(FloorFoundationPatch.safeParse({ slots: { [key]: 'library:stone' } }).success).toBe(
      false,
    )
})
