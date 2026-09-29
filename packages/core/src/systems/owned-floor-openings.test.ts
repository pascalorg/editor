import { expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  CeilingNode,
  ElevatorNode,
  FloorOpeningNode,
  LevelNode,
  SlabNode,
  StairNode,
} from '../schema'
import { migrateOwnedFloorOpenings } from '../utils/owned-floor-opening-migration'
import { reconcileStructureOnLoad } from '../utils/reconcile-structure-on-load'
import { reconcileStructureWithStableIds } from '../utils/structure-id'
import { planOwnedFloorOpenings } from './owned-floor-openings'

const square: [number, number][] = [
  [0, 0],
  [6, 0],
  [6, 6],
  [0, 6],
]

function fixture() {
  const building = BuildingNode.parse({ id: 'building_owned_test' })
  const ground = LevelNode.parse({
    id: 'level_owned_ground',
    parentId: building.id,
    level: 0,
    height: 4.5,
  })
  const upper = LevelNode.parse({ id: 'level_owned_upper', parentId: building.id, level: 1 })
  building.children = [ground.id, upper.id]
  const plate = SlabNode.parse({
    id: 'slab_owned_upper',
    parentId: upper.id,
    polygon: square,
    boundary: 'auto',
  })
  const ceiling = CeilingNode.parse({
    id: 'ceiling_owned_ground',
    parentId: ground.id,
    polygon: square,
    boundary: 'auto',
  })
  const stair = StairNode.parse({
    id: 'stair_owned_a',
    parentId: ground.id,
    position: [3, 0, 3],
    stairType: 'spiral',
    totalRise: 4.5,
    fromLevelId: ground.id,
    toLevelId: upper.id,
    slabOpeningMode: 'destination',
  })
  ground.children = [ceiling.id, stair.id]
  upper.children = [plate.id]
  const nodes = Object.fromEntries(
    [building, ground, upper, plate, ceiling, stair].map((node) => [node.id, node]),
  ) as Record<string, AnyNode>
  return { nodes, building, ground, upper, plate, ceiling, stair }
}

function apply(nodes: Record<string, AnyNode>, changes: ReturnType<typeof planOwnedFloorOpenings>) {
  const next = { ...nodes }
  for (const change of changes) {
    if (change.op === 'create') next[change.node.id] = change.node
    else if (change.op === 'delete') delete next[change.id]
    else next[change.id] = { ...next[change.id], ...change.data } as AnyNode
  }
  return next
}

test('a reaching spiral owns both cuts; move and delete update the same intent nodes', () => {
  const { nodes, plate, ceiling, stair } = fixture()
  const first = planOwnedFloorOpenings(nodes)
  expect(
    first.every(
      (change) => change.op !== 'update' || (change.id !== plate.id && change.id !== ceiling.id),
    ),
  ).toBe(true)
  const owned = first.filter(
    (change) => change.op === 'create' && change.node.type === 'floor-opening',
  )
  expect(owned).toHaveLength(2)
  expect(
    owned.map((entry) =>
      entry.op === 'create' && entry.node.type === 'floor-opening' ? entry.node.surfaceId : '',
    ),
  ).toEqual([plate.id, ceiling.id].sort().reverse())
  const withOpenings = apply(nodes, first)
  expect(planOwnedFloorOpenings(withOpenings)).toEqual([])
  const moved = { ...withOpenings, [stair.id]: { ...stair, position: [2, 0, 2] } as AnyNode }
  const changes = planOwnedFloorOpenings(moved)
  expect(
    changes.filter(
      (change) => change.op === 'update' && withOpenings[change.id]?.type === 'floor-opening',
    ),
  ).toHaveLength(2)
  expect(changes.some((change) => change.op === 'create' || change.op === 'delete')).toBe(false)
  const deleted = { ...apply(moved, changes) }
  delete deleted[stair.id]
  expect(planOwnedFloorOpenings(deleted).filter((change) => change.op === 'delete')).toHaveLength(2)
})

test('two stairs sharing a void keep independent owners, and a short spiral creates no cut', () => {
  const { nodes, stair, plate } = fixture()
  const second = StairNode.parse({ ...stair, id: 'stair_owned_b' })
  const both = { ...nodes, [second.id]: second }
  const changes = planOwnedFloorOpenings(both)
  const openings = changes.flatMap((change) =>
    change.op === 'create' && change.node.type === 'floor-opening' ? [change.node] : [],
  )
  expect(openings).toHaveLength(4)
  expect(new Set(openings.map((opening) => opening.ownerId))).toEqual(
    new Set([stair.id, second.id]),
  )
  const short = { ...nodes, [stair.id]: { ...stair, totalRise: 2 } as AnyNode }
  expect(planOwnedFloorOpenings(short).filter((change) => change.op === 'create')).toEqual([])
  const manualPlate = { ...plate, boundary: undefined }
  const authored = { ...both, [plate.id]: manualPlate }
  const opened = apply(authored, planOwnedFloorOpenings(authored))
  const first = reconcileStructureWithStableIds({ nodes: opened }).nodes
  expect((first[plate.id] as SlabNode).holes).toHaveLength(1)
  const oneOwner = { ...first }
  delete oneOwner[second.id]
  const reduced = apply(oneOwner, planOwnedFloorOpenings(oneOwner))
  const secondPass = reconcileStructureWithStableIds({ nodes: reduced }).nodes
  expect((secondPass[plate.id] as SlabNode).holes).toHaveLength(1)
})

test('migration adopts exact legacy stair/elevator holes, preserves orphans, and is idempotent', () => {
  const { nodes, plate, ceiling, stair, ground } = fixture()
  const elevator = ElevatorNode.parse({
    id: 'elevator_owned',
    parentId: ground.id,
    fromLevelId: ground.id,
    toLevelId: plate.parentId,
  })
  const stairHole: [number, number][] = [
    [1.123456789, 1],
    [2, 1],
    [2, 2],
    [1.123456789, 2],
  ]
  const liftHole: [number, number][] = [
    [3, 3],
    [4, 3],
    [4, 4],
    [3, 4],
  ]
  const orphan: [number, number][] = [
    [4.5, 4.5],
    [5, 4.5],
    [5, 5],
    [4.5, 5],
  ]
  const legacy = {
    ...nodes,
    [elevator.id]: elevator,
    [plate.id]: {
      ...plate,
      holes: [stairHole, [...stairHole.slice(1), stairHole[0]!], liftHole, orphan],
      holeMetadata: [
        { source: 'stair', stairId: stair.id },
        { source: 'stair', stairId: stair.id },
        { source: 'elevator', elevatorId: elevator.id },
        { source: 'stair', stairId: 'stair_deleted' },
      ],
    } as AnyNode,
    [ceiling.id]: {
      ...ceiling,
      holes: [stairHole],
      holeMetadata: [{ source: 'stair', stairId: stair.id }],
    } as AnyNode,
  }
  const first = migrateOwnedFloorOpenings(legacy)
  const openings = Object.values(first.nodes).filter(
    (node): node is Extract<AnyNode, { type: 'floor-opening' }> =>
      (node as AnyNode).type === 'floor-opening',
  )
  expect(openings).toHaveLength(4)
  expect(openings.find((opening) => opening.source === 'manual')?.polygon).toEqual(orphan)
  expect(openings.find((opening) => opening.source === 'elevator')?.ownerId).toBe(elevator.id)
  expect(openings.filter((opening) => opening.ownerId === stair.id)).toHaveLength(2)
  expect(migrateOwnedFloorOpenings(first.nodes).nodes).toBe(first.nodes)
})

test('an authored stair opening follows its owner pose and level, then retires with it', () => {
  const { nodes, stair, ground, upper } = fixture()
  const authoredStair = { ...stair, slabOpeningMode: 'none' as const }
  const polygon: [number, number][] = [
    [2, 2],
    [3, 2],
    [3, 3],
    [2, 3],
  ]
  const opening = FloorOpeningNode.parse({
    id: 'floor-opening_authored_stair',
    parentId: upper.id,
    polygon,
    source: 'stair',
    ownerId: stair.id,
    metadata: {
      ownerPose: { position: stair.position, rotation: 0, width: stair.width, runLength: 3 },
      ownerOpeningTarget: 'destination',
    },
  })
  const initial = { ...nodes, [stair.id]: authoredStair, [opening.id]: opening }
  expect(planOwnedFloorOpenings(initial)).toEqual([])
  const moved = {
    ...initial,
    [stair.id]: { ...authoredStair, position: [4, 0, 3], rotation: Math.PI / 2 },
  }
  const plan = planOwnedFloorOpenings(moved)
  expect(plan.filter((change) => change.op === 'update' && change.id === opening.id)).toHaveLength(
    1,
  )
  const result = apply(moved, plan)[opening.id] as FloorOpeningNode
  expect(result.polygon.some(([x, z]) => Math.abs(x - 3) < 0.005 && Math.abs(z - 4) < 0.005)).toBe(
    true,
  )
  expect(planOwnedFloorOpenings(apply(moved, plan))).toEqual([])
  const changedLevel = {
    ...apply(moved, plan),
    [stair.id]: { ...moved[stair.id], toLevelId: ground.id } as AnyNode,
  }
  expect(planOwnedFloorOpenings(changedLevel)).toContainEqual({
    op: 'update',
    id: opening.id,
    data: { parentId: ground.id },
  })
  const deleted = { ...initial }
  delete deleted[stair.id]
  expect(planOwnedFloorOpenings(deleted)).toContainEqual({ op: 'delete', id: opening.id })
})

test('an automatic stair opening keeps its node id when the stair moves to another storey', () => {
  const { nodes, stair, building, upper, plate } = fixture()
  const first = apply(nodes, planOwnedFloorOpenings(nodes))
  const original = Object.values(first).find(
    (node) => node.type === 'floor-opening' && node.surfaceId === plate.id,
  ) as FloorOpeningNode
  const third = LevelNode.parse({ id: 'level_owned_third', parentId: building.id, level: 2 })
  const thirdPlate = SlabNode.parse({
    id: 'slab_owned_third',
    parentId: third.id,
    polygon: square,
    boundary: 'auto',
  })
  third.children = [thirdPlate.id]
  const moved = {
    ...first,
    [third.id]: third,
    [thirdPlate.id]: thirdPlate,
    [building.id]: { ...building, children: [...building.children, third.id] },
    [stair.id]: { ...stair, parentId: upper.id, fromLevelId: upper.id, toLevelId: third.id },
  } as Record<string, AnyNode>
  const plan = planOwnedFloorOpenings(moved)
  expect(plan).toContainEqual({
    op: 'update',
    id: original.id,
    data: expect.objectContaining({ surfaceId: thirdPlate.id, parentId: third.id }),
  })
  expect(plan.some((change) => change.op === 'delete' && change.id === original.id)).toBe(false)
})

test('a migrated manual ceiling keeps its old void until its stair is deleted', () => {
  const { nodes, stair, ceiling } = fixture()
  const hole: [number, number][] = [
    [1, 1],
    [2, 1],
    [2, 2],
    [1, 2],
  ]
  const legacy = {
    ...nodes,
    [ceiling.id]: {
      ...ceiling,
      boundary: undefined,
      holes: [hole],
      holeMetadata: [{ source: 'stair', stairId: stair.id }],
    } as AnyNode,
  }
  const migrated = migrateOwnedFloorOpenings(legacy).nodes as Record<string, AnyNode>
  expect((migrated[ceiling.id] as CeilingNode).holes).toEqual([hole])
  const deleted = { ...migrated }
  delete deleted[stair.id]
  const settled = reconcileStructureWithStableIds({
    nodes: apply(deleted, planOwnedFloorOpenings(deleted)),
  }).nodes
  expect((settled[ceiling.id] as CeilingNode).holes).toEqual([])
})

test('one stair owns one opening per level across stacked plates, including saved duplicates', () => {
  const { nodes, plate, stair, upper } = fixture()
  const platform = SlabNode.parse({
    ...plate,
    id: 'slab_owned_platform',
    plateRole: 'platform',
    elevation: 0.35,
    thickness: 0.3,
  })
  const stacked = {
    ...nodes,
    [platform.id]: platform,
    [upper.id]: { ...upper, children: [...upper.children, platform.id] },
  }
  const planned = planOwnedFloorOpenings(stacked)
  const upperOpenings = planned.flatMap((change) =>
    change.op === 'create' &&
    change.node.type === 'floor-opening' &&
    change.node.parentId === upper.id
      ? [change.node]
      : [],
  )
  expect(upperOpenings).toHaveLength(1)
  expect(Object.keys(upperOpenings[0]!.legacyPlateCuts ?? {}).sort()).toEqual(
    [plate.id, platform.id].sort(),
  )

  const first = upperOpenings[0]!
  const duplicate = FloorOpeningNode.parse({
    ...first,
    id: 'floor-opening_duplicate_stair',
    surfaceId: platform.id,
    legacyPlateCuts: { [platform.id]: [first.polygon] },
  })
  const authoredDuplicate = FloorOpeningNode.parse({
    ...first,
    id: 'floor-opening_duplicate_authored',
    surfaceId: undefined,
  })
  const saved = {
    ...stacked,
    [first.id]: { ...first, legacyPlateCuts: { [plate.id]: [first.polygon] } },
    [duplicate.id]: duplicate,
    [authoredDuplicate.id]: authoredDuplicate,
    [upper.id]: {
      ...upper,
      children: [...upper.children, platform.id, first.id, duplicate.id, authoredDuplicate.id],
    },
    [plate.id]: {
      ...plate,
      holes: [first.polygon, first.polygon],
      holeMetadata: [
        { source: 'floor-opening' as const, openingId: first.id },
        { source: 'floor-opening' as const, openingId: authoredDuplicate.id },
      ],
    },
    [platform.id]: {
      ...platform,
      holes: [first.polygon],
      holeMetadata: [{ source: 'floor-opening' as const, openingId: duplicate.id }],
    },
  }
  const synced = apply(saved, planOwnedFloorOpenings(saved))
  expect(
    Object.values(synced).filter(
      (node) =>
        node.type === 'floor-opening' && node.ownerId === stair.id && node.parentId === upper.id,
    ),
  ).toHaveLength(1)
  expect(planOwnedFloorOpenings(synced)).toEqual([])
  const migrated = migrateOwnedFloorOpenings(saved)
  const surviving = Object.values(migrated.nodes).filter(
    (node): node is FloorOpeningNode =>
      (node as AnyNode).type === 'floor-opening' &&
      (node as FloorOpeningNode).ownerId === stair.id &&
      (node as FloorOpeningNode).parentId === upper.id,
  )
  expect(surviving).toHaveLength(1)
  expect(Object.keys(surviving[0]!.legacyPlateCuts ?? {}).sort()).toEqual(
    [plate.id, platform.id].sort(),
  )
  expect((migrated.nodes[plate.id] as SlabNode).holes).toHaveLength(1)
  expect((migrated.nodes[plate.id] as SlabNode).holeMetadata[0]?.openingId).toBe(surviving[0]!.id)
  expect((migrated.nodes[platform.id] as SlabNode).holeMetadata[0]?.openingId).toBe(
    surviving[0]!.id,
  )
  expect((migrated.nodes[upper.id] as LevelNode).children).not.toContain(duplicate.id)
  expect(migrateOwnedFloorOpenings(migrated.nodes).nodes).toBe(migrated.nodes)
  const loaded = reconcileStructureOnLoad(saved).nodes
  expect(
    Object.values(loaded).filter(
      (node) =>
        node.type === 'floor-opening' && node.ownerId === stair.id && node.parentId === upper.id,
    ),
  ).toHaveLength(1)
  expect(reconcileStructureOnLoad(loaded).nodes).toEqual(loaded)
})

test('legacy stair clearance is shared by near-identical cuts on stacked slabs', () => {
  const { nodes, plate, stair, upper } = fixture()
  const plain: [number, number][] = [
    [2, 2],
    [3, 2],
    [3, 3],
    [2, 3],
  ]
  const clearance: [number, number][] = [
    [1.999, 1.999],
    [3.001, 1.999],
    [3.001, 3.001],
    [1.999, 3.001],
  ]
  const second = SlabNode.parse({ ...plate, id: 'slab_owned_second', boundary: undefined })
  const legacy = {
    ...nodes,
    [upper.id]: { ...upper, children: [...upper.children, second.id] },
    [plate.id]: {
      ...plate,
      boundary: undefined,
      holes: [plain],
      holeMetadata: [{ source: 'stair' as const, stairId: stair.id }],
    },
    [second.id]: {
      ...second,
      holes: [clearance],
      holeMetadata: [{ source: 'stair' as const, stairId: stair.id }],
    },
  }
  const migrated = migrateOwnedFloorOpenings(legacy)
  const opening = Object.values(migrated.nodes).find(
    (node): node is FloorOpeningNode =>
      (node as AnyNode).type === 'floor-opening' && (node as FloorOpeningNode).ownerId === stair.id,
  )!
  expect(opening.legacyPlateCuts).toEqual({
    [plate.id]: [clearance],
    [second.id]: [clearance],
  })
  const reconciled = reconcileStructureWithStableIds({ nodes: migrated.nodes }).nodes
  expect((reconciled[plate.id] as SlabNode).holes).toEqual([clearance])
  expect((reconciled[second.id] as SlabNode).holes).toEqual([clearance])
})
