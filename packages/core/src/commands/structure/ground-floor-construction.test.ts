import { expect, test } from 'bun:test'
import { groundFloorConstruction } from '../../lib/floor-foundation-datum'
import { wallSupportForNodes } from '../../lib/opening-floor-datum'
import {
  type AnyNode,
  BuildingNode,
  LevelNode,
  type SlabNode,
  type WallNode,
  type ZoneNode,
} from '../../schema'
import { filterDerivedNodeWrites } from '../../store/derived-node-guard'
import { floorStepFixture } from '../../systems/slab/__fixtures__/floor-step'
import { reconcileStructureOnLoad } from '../../utils/reconcile-structure-on-load'
import { type FloorFoundationPatch, setFloorFoundation } from './set-floor-foundation'

// Ground floors: slab thickness + foundation height are the two inputs; the top
// is grade + foundation + thickness, the slab grows upward and carries everything.

function scene() {
  const f = floorStepFixture()
  const nodes = Object.fromEntries(
    Object.entries(f.nodes).filter(([, node]) => node.type !== 'slab'),
  ) as Record<string, AnyNode>
  const loaded = reconcileStructureOnLoad(nodes).nodes as Record<string, AnyNode>
  const plate = Object.values(loaded).find(
    (n): n is SlabNode => n.type === 'slab' && n.plateRole === 'base',
  )!
  return { nodes: loaded, plate, wall: loaded.wall_step_0 as WallNode, step: f.zones[1]!.id }
}

function apply(nodes: Record<string, AnyNode>, slabId: string, patch: FloorFoundationPatch) {
  const plan = setFloorFoundation(nodes, { slabId, patch })
  expect(plan.conflicts ?? []).toEqual([])
  const updates = plan.changes.flatMap((c) => (c.op === 'update' ? [c] : []))
  const next = { ...nodes }
  for (const { id, data } of filterDerivedNodeWrites(nodes, { update: updates }).update)
    next[id] = { ...next[id], ...data } as AnyNode
  return reconcileStructureOnLoad(next).nodes as Record<string, AnyNode>
}

const plateOf = (nodes: Record<string, AnyNode>, id: string) => nodes[id] as SlabNode
const top = (plate: SlabNode) => plate.floorHeight ?? plate.elevation

test('a legacy default plate loads unchanged and reads on the ground, slab 0.05, top 0.05', () => {
  const { nodes, plate } = scene()
  expect(plate.floorHeight).toBeUndefined()
  expect(plate.elevation).toBeCloseTo(0.05)
  expect(plate.thickness).toBeCloseTo(0.05)
  expect(groundFloorConstruction(nodes, plate)).toMatchObject({
    grade: expect.closeTo(0),
    top: expect.closeTo(0.05),
    foundationHeight: 0,
  })
  expect(reconcileStructureOnLoad(nodes).nodes).toEqual(nodes)
})

test('thicker slab 0.05 → 0.10 raises the top by 0.05 and the walls and room steps with it', () => {
  const { nodes, plate, wall, step } = scene()
  const wallBefore = wallSupportForNodes(wall, nodes).elevation
  const stepBefore = (nodes[step] as ZoneNode).floor!.elevation!
  const next = apply(nodes, plate.id, { thickness: 0.1 })
  const after = plateOf(next, plate.id)
  expect(top(after)).toBeCloseTo(0.1)
  expect(after.thickness).toBeCloseTo(0.1)
  expect(top(after) - after.thickness).toBeCloseTo(0)
  expect(after.foundation?.type ?? 'none').toBe('none')
  expect(wallSupportForNodes(wall, next).elevation).toBeCloseTo(wallBefore + 0.05)
  expect((next[step] as ZoneNode).floor!.elevation).toBeCloseTo(stepBefore + 0.05)
})

test('foundation 0 → 0.3 raises everything by 0.3 with a solid foundation; back to the ground', () => {
  const { nodes, plate, wall, step } = scene()
  const wallBefore = wallSupportForNodes(wall, nodes).elevation
  const stepBefore = (nodes[step] as ZoneNode).floor!.elevation!
  const raised = apply(nodes, plate.id, { foundationHeight: 0.3 })
  const up = plateOf(raised, plate.id)
  expect(top(up)).toBeCloseTo(0.35)
  expect(top(up) - up.thickness).toBeCloseTo(0.3)
  expect(up.foundation?.type).toBe('solid')
  expect(groundFloorConstruction(raised, up).foundationHeight).toBeCloseTo(0.3)
  expect(wallSupportForNodes(wall, raised).elevation).toBeCloseTo(wallBefore + 0.3)
  expect((raised[step] as ZoneNode).floor!.elevation).toBeCloseTo(stepBefore + 0.3)
  const lowered = apply(raised, plate.id, { foundationHeight: 0 })
  const down = plateOf(lowered, plate.id)
  expect(top(down)).toBeCloseTo(0.05)
  expect(down.foundation?.type).toBe('none')
  expect(wallSupportForNodes(wall, lowered).elevation).toBeCloseTo(wallBefore)
})

test('thicker slab on a foundation keeps the underside on the foundation', () => {
  const { nodes, plate } = scene()
  const raised = apply(nodes, plate.id, { foundationHeight: 0.3 })
  const thick = plateOf(apply(raised, plate.id, { thickness: 0.2 }), plate.id)
  expect(top(thick)).toBeCloseTo(0.5)
  expect(top(thick) - thick.thickness).toBeCloseTo(0.3)
  expect(thick.foundation?.type).toBe('solid')
})

test('slab 0.01 on the ground sits on grade: no gap under it', () => {
  const { nodes, plate, wall } = scene()
  const next = apply(nodes, plate.id, { thickness: 0.01 })
  const thin = plateOf(next, plate.id)
  expect(thin.thickness).toBeCloseTo(0.01)
  expect(top(thin)).toBeCloseTo(0.01)
  expect(top(thin) - thin.thickness).toBeCloseTo(0)
  expect(thin.elevation).toBeCloseTo(0.01)
  expect(wallSupportForNodes(wall, next).elevation).toBeCloseTo(0.01)
})

test('slab thickness 0 is clamped to 0.01', () => {
  const { nodes, plate } = scene()
  const thin = plateOf(apply(nodes, plate.id, { thickness: 0 }), plate.id)
  expect(thin.thickness).toBeCloseTo(0.01)
  expect(top(thin) - thin.thickness).toBeCloseTo(0)
})

test('a legacy thick slab under a lower top reads on the ground and lands on grade on its next edit', () => {
  const { nodes, plate } = scene()
  const legacy = { ...nodes, [plate.id]: { ...plate, thickness: 0.2 } as SlabNode }
  expect(groundFloorConstruction(legacy, legacy[plate.id] as SlabNode).foundationHeight).toBe(0)
  const edited = plateOf(apply(legacy, plate.id, { foundationHeight: 0 }), plate.id)
  expect(top(edited)).toBeCloseTo(0.2)
  expect(top(edited) - edited.thickness).toBeCloseTo(0)
})

test('upper storeys keep their model: thickness grows up from the walls below, no foundation', () => {
  const { nodes: ground, plate } = scene()
  const f = floorStepFixture()
  const lower = LevelNode.parse({ id: 'level_ground', level: 0 })
  const building = BuildingNode.parse({ children: [lower.id, f.level.id] })
  const nodes = {
    ...ground,
    [building.id]: building,
    [lower.id]: { ...lower, parentId: building.id },
    [f.level.id]: { ...ground[f.level.id], level: 1, parentId: building.id },
    zone_ground_room: { ...f.zones[0]!, id: 'zone_ground_room', parentId: lower.id },
    slab_ground_plate: {
      ...plate,
      id: 'slab_ground_plate',
      parentId: lower.id,
      zoneIds: ['zone_ground_room'],
    },
  } as Record<string, AnyNode>
  const upper = plateOf(nodes, plate.id)
  const underside = top(upper) - upper.thickness
  const plan = setFloorFoundation(nodes, { slabId: upper.id, patch: { thickness: 0.2 } })
  expect(plan.conflicts ?? []).toEqual([])
  const write = plan.changes.find((c) => c.op === 'update' && c.id === upper.id)
  expect(write).toMatchObject({
    data: { thickness: expect.closeTo(0.2), elevation: expect.closeTo(underside + 0.2) },
  })
  expect(
    setFloorFoundation(nodes, { slabId: upper.id, patch: { foundationHeight: 0.3 } }).conflicts?.[0]
      ?.code,
  ).toBe('floor-foundation-level')
})
