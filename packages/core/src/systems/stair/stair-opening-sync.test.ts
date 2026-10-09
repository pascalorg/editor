import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  CeilingNode,
  changedStairOpeningOwners,
  FloorOpeningNode,
  LevelNode,
  planOwnedFloorOpenings,
  SlabNode,
  StairNode,
  StairSegmentNode,
  syncAutoStairOpenings,
} from '../../index'

describe('syncAutoStairOpenings', () => {
  test('only applies stair holes to destination slabs that overlap the opening', () => {
    const building = BuildingNode.parse({ name: 'Building' })
    const ground = LevelNode.parse({ name: 'Ground', level: 0, parentId: building.id })
    const upper = LevelNode.parse({ name: 'Upper', level: 1, parentId: building.id })
    const landingSlab = SlabNode.parse({
      name: 'Landing Slab',
      parentId: upper.id,
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
    })
    const bedroomSlab = SlabNode.parse({
      name: 'Bedroom Slab',
      parentId: upper.id,
      polygon: [
        [4, 0],
        [8, 0],
        [8, 3],
        [4, 3],
      ],
    })
    const segment = StairSegmentNode.parse({
      parentId: 'stair_main',
      width: 1,
      length: 2.6,
      height: 2.5,
      stepCount: 12,
    })
    const stair = StairNode.parse({
      id: 'stair_main',
      name: 'Main Stair',
      parentId: ground.id,
      position: [2, 0, 0.2],
      stairType: 'straight',
      fromLevelId: ground.id,
      toLevelId: upper.id,
      slabOpeningMode: 'destination',
      children: [segment.id],
    })
    const nodes = Object.fromEntries(
      [
        building,
        ground,
        upper,
        landingSlab,
        bedroomSlab,
        stair,
        { ...segment, parentId: stair.id },
      ].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>

    const updates = syncAutoStairOpenings(nodes)
    const landingUpdate = updates.find((update) => update.id === landingSlab.id)
    const bedroomUpdate = updates.find((update) => update.id === bedroomSlab.id)

    expect(landingUpdate?.data.holes).toHaveLength(1)
    expect(landingUpdate?.data.holeMetadata).toEqual([{ source: 'stair', stairId: stair.id }])
    expect(bedroomUpdate).toBeUndefined()
  })

  test('pads the required destination clearance cut by the configured offset', () => {
    const building = BuildingNode.parse({ name: 'Building' })
    const ground = LevelNode.parse({ name: 'Ground', level: 0, parentId: building.id })
    const upper = LevelNode.parse({ name: 'Upper', level: 1, parentId: building.id })
    const landingSlab = SlabNode.parse({
      name: 'Landing Slab',
      parentId: upper.id,
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
    })
    const segment = StairSegmentNode.parse({
      parentId: 'stair_edge',
      width: 1,
      length: 2.6,
      height: 2.5,
      stepCount: 12,
    })
    const stair = StairNode.parse({
      id: 'stair_edge',
      name: 'Edge Stair',
      parentId: ground.id,
      position: [2, 0, 0],
      stairType: 'straight',
      fromLevelId: ground.id,
      toLevelId: upper.id,
      slabOpeningMode: 'destination',
      openingOffset: 0.08,
      children: [segment.id],
    })
    const nodes = Object.fromEntries(
      [building, ground, upper, landingSlab, stair, { ...segment, parentId: stair.id }].map(
        (node) => [node.id, node],
      ),
    ) as Record<string, AnyNode>

    const updates = syncAutoStairOpenings(nodes)
    const landingUpdate = updates.find((update) => update.id === landingSlab.id)
    const hole = landingUpdate?.data.holes?.[0]

    expect(hole).toBeDefined()
    expect(Math.min(...hole!.map(([, z]) => z))).toBeCloseTo(2 * (2.6 / 12) - 0.08)
    expect(landingUpdate?.data.holeMetadata).toEqual([{ source: 'stair', stairId: stair.id }])
  })

  test('does not apply stair holes to slabs on another building with a matching level number', () => {
    const buildingA = BuildingNode.parse({ name: 'Building A' })
    const groundA = LevelNode.parse({ name: 'Ground A', level: 0, parentId: buildingA.id })
    const upperA = LevelNode.parse({ name: 'Upper A', level: 1, parentId: buildingA.id })
    const buildingB = BuildingNode.parse({ name: 'Building B' })
    const upperB = LevelNode.parse({ name: 'Upper B', level: 1, parentId: buildingB.id })
    const slabA = SlabNode.parse({
      name: 'Upper A Slab',
      parentId: upperA.id,
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
    })
    const slabB = SlabNode.parse({
      name: 'Upper B Slab',
      parentId: upperB.id,
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
    })
    const segment = StairSegmentNode.parse({
      parentId: 'stair_scoped',
      width: 1,
      length: 2.6,
      height: 2.5,
      stepCount: 12,
    })
    const stair = StairNode.parse({
      id: 'stair_scoped',
      name: 'Scoped Stair',
      parentId: groundA.id,
      position: [2, 0, 0.2],
      stairType: 'straight',
      fromLevelId: groundA.id,
      toLevelId: upperA.id,
      slabOpeningMode: 'destination',
      children: [segment.id],
    })
    const nodes = Object.fromEntries(
      [
        buildingA,
        groundA,
        upperA,
        buildingB,
        upperB,
        slabA,
        slabB,
        stair,
        { ...segment, parentId: stair.id },
      ].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>

    const updates = syncAutoStairOpenings(nodes)

    expect(updates.find((update) => update.id === slabA.id)?.data.holes).toHaveLength(1)
    expect(updates.find((update) => update.id === slabB.id)).toBeUndefined()
  })

  test('uses the parent level when a stair has stale from-level data', () => {
    const building = BuildingNode.parse({ name: 'Building' })
    const ground = LevelNode.parse({ name: 'Ground', level: 0, parentId: building.id })
    const upper = LevelNode.parse({ name: 'Upper', level: 1, parentId: building.id })
    const landingSlab = SlabNode.parse({
      name: 'Landing Slab',
      parentId: upper.id,
      polygon: [
        [0, 0],
        [4, 0],
        [4, 8],
        [0, 8],
      ],
    })
    const segment = StairSegmentNode.parse({
      parentId: 'stair_stale_from',
      width: 1,
      length: 6,
      height: 2.5,
      stepCount: 12,
    })
    const stair = StairNode.parse({
      id: 'stair_stale_from',
      name: 'Stale From Stair',
      parentId: ground.id,
      position: [2, 0, 0.2],
      stairType: 'straight',
      fromLevelId: 'default',
      toLevelId: upper.id,
      slabOpeningMode: 'destination',
      children: [segment.id],
    })
    const nodes = Object.fromEntries(
      [building, ground, upper, landingSlab, stair, { ...segment, parentId: stair.id }].map(
        (node) => [node.id, node],
      ),
    ) as Record<string, AnyNode>

    const updates = syncAutoStairOpenings(nodes)
    const landingUpdate = updates.find((update) => update.id === landingSlab.id)
    const hole = landingUpdate?.data.holes?.[0]

    expect(hole).toBeDefined()
    expect(Math.min(...hole!.map(([, z]) => z))).toBeGreaterThan(0.9)
    expect(landingUpdate?.data.holeMetadata).toEqual([{ source: 'stair', stairId: stair.id }])
  })

  test('infers the destination level when a destination stair has blank level fields', () => {
    const building = BuildingNode.parse({ name: 'Building' })
    const ground = LevelNode.parse({ name: 'Ground', level: 0, parentId: building.id })
    const upper = LevelNode.parse({ name: 'Upper', level: 1, parentId: building.id })
    const landingSlab = SlabNode.parse({
      name: 'Landing Slab',
      parentId: upper.id,
      polygon: [
        [0, 0],
        [4, 0],
        [4, 8],
        [0, 8],
      ],
    })
    const segment = StairSegmentNode.parse({
      parentId: 'stair_blank_levels',
      width: 1,
      length: 6,
      height: 2.5,
      stepCount: 12,
    })
    const stair = StairNode.parse({
      id: 'stair_blank_levels',
      name: 'Blank Level Stair',
      parentId: ground.id,
      position: [2, 0, 0.2],
      stairType: 'straight',
      fromLevelId: '',
      toLevelId: '',
      slabOpeningMode: 'destination',
      children: [segment.id],
    })
    const nodes = Object.fromEntries(
      [building, ground, upper, landingSlab, stair, { ...segment, parentId: stair.id }].map(
        (node) => [node.id, node],
      ),
    ) as Record<string, AnyNode>

    const updates = syncAutoStairOpenings(nodes)
    const landingUpdate = updates.find((update) => update.id === landingSlab.id)

    expect(landingUpdate?.data.holes).toHaveLength(1)
    expect(landingUpdate?.data.holeMetadata).toEqual([{ source: 'stair', stairId: stair.id }])
  })

  test('infers the destination level when a destination stair targets its source level', () => {
    const building = BuildingNode.parse({ name: 'Building' })
    const ground = LevelNode.parse({ name: 'Ground', level: 0, parentId: building.id })
    const upper = LevelNode.parse({ name: 'Upper', level: 1, parentId: building.id })
    const landingSlab = SlabNode.parse({
      name: 'Landing Slab',
      parentId: upper.id,
      polygon: [
        [0, 0],
        [4, 0],
        [4, 8],
        [0, 8],
      ],
    })
    const segment = StairSegmentNode.parse({
      parentId: 'stair_self_target',
      width: 1,
      length: 6,
      height: 2.5,
      stepCount: 12,
    })
    const stair = StairNode.parse({
      id: 'stair_self_target',
      name: 'Self Target Stair',
      parentId: ground.id,
      position: [2, 0, 0.2],
      stairType: 'straight',
      fromLevelId: ground.id,
      toLevelId: ground.id,
      slabOpeningMode: 'destination',
      children: [segment.id],
    })
    const nodes = Object.fromEntries(
      [building, ground, upper, landingSlab, stair, { ...segment, parentId: stair.id }].map(
        (node) => [node.id, node],
      ),
    ) as Record<string, AnyNode>

    const updates = syncAutoStairOpenings(nodes)
    const landingUpdate = updates.find((update) => update.id === landingSlab.id)

    expect(landingUpdate?.data.holes).toHaveLength(1)
    expect(landingUpdate?.data.holeMetadata).toEqual([{ source: 'stair', stairId: stair.id }])
  })

  test('does not add stair holes when a manual surface hole already covers them', () => {
    const building = BuildingNode.parse({ name: 'Building' })
    const ground = LevelNode.parse({ name: 'Ground', level: 0, parentId: building.id })
    const upper = LevelNode.parse({ name: 'Upper', level: 1, parentId: building.id })
    const manualOpening: Array<[number, number]> = [
      [1.0, 0.0],
      [3.0, 0.0],
      [3.0, 3.0],
      [1.0, 3.0],
    ]
    const sourceCeiling = CeilingNode.parse({
      name: 'Source Ceiling',
      parentId: ground.id,
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      holes: [manualOpening],
      holeMetadata: [{ source: 'manual' }],
    })
    const landingSlab = SlabNode.parse({
      name: 'Landing Slab',
      parentId: upper.id,
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      holes: [manualOpening],
      holeMetadata: [{ source: 'manual' }],
    })
    const segment = StairSegmentNode.parse({
      parentId: 'stair_main',
      width: 1,
      length: 2.6,
      height: 2.5,
      stepCount: 12,
    })
    const stair = StairNode.parse({
      id: 'stair_main',
      name: 'Main Stair',
      parentId: ground.id,
      position: [2, 0, 0.2],
      stairType: 'straight',
      fromLevelId: ground.id,
      toLevelId: upper.id,
      slabOpeningMode: 'destination',
      children: [segment.id],
    })
    const nodes = Object.fromEntries(
      [
        building,
        ground,
        upper,
        sourceCeiling,
        landingSlab,
        stair,
        { ...segment, parentId: stair.id },
      ].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>

    const updates = syncAutoStairOpenings(nodes)

    expect(updates.find((update) => update.id === landingSlab.id)).toBeUndefined()
    expect(updates.find((update) => update.id === sourceCeiling.id)).toBeUndefined()
    const onlyFloorCovered = syncAutoStairOpenings({
      ...nodes,
      [sourceCeiling.id]: { ...sourceCeiling, holes: [], holeMetadata: [] },
    })
    expect(onlyFloorCovered.find((update) => update.id === landingSlab.id)).toBeUndefined()
    expect(
      onlyFloorCovered.find((update) => update.id === sourceCeiling.id)?.data.holeMetadata,
    ).toEqual([{ source: 'stair', stairId: stair.id }])
  })

  test('adds stair holes when an existing manual hole is too small', () => {
    const building = BuildingNode.parse({ name: 'Building' })
    const ground = LevelNode.parse({ name: 'Ground', level: 0, parentId: building.id })
    const upper = LevelNode.parse({ name: 'Upper', level: 1, parentId: building.id })
    const smallManualOpening: Array<[number, number]> = [
      [1.8, 1.6],
      [2.2, 1.6],
      [2.2, 2.1],
      [1.8, 2.1],
    ]
    const landingSlab = SlabNode.parse({
      name: 'Landing Slab',
      parentId: upper.id,
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      holes: [smallManualOpening],
      holeMetadata: [{ source: 'manual' }],
    })
    const segment = StairSegmentNode.parse({
      parentId: 'stair_main',
      width: 1,
      length: 2.6,
      height: 2.5,
      stepCount: 12,
    })
    const stair = StairNode.parse({
      id: 'stair_main',
      name: 'Main Stair',
      parentId: ground.id,
      position: [2, 0, 0.2],
      stairType: 'straight',
      fromLevelId: ground.id,
      toLevelId: upper.id,
      slabOpeningMode: 'destination',
      children: [segment.id],
    })
    const nodes = Object.fromEntries(
      [building, ground, upper, landingSlab, stair, { ...segment, parentId: stair.id }].map(
        (node) => [node.id, node],
      ),
    ) as Record<string, AnyNode>

    const updates = syncAutoStairOpenings(nodes)
    const landingUpdate = updates.find((update) => update.id === landingSlab.id)

    expect(landingUpdate?.data.holes).toHaveLength(2)
    expect(landingUpdate?.data.holes?.[0]).toEqual(smallManualOpening)
    expect(landingUpdate?.data.holeMetadata).toEqual([
      { source: 'manual' },
      { source: 'stair', stairId: stair.id },
    ])
  })

  test('removes stale auto stair holes when a manual hole overlaps the stair opening', () => {
    const building = BuildingNode.parse({ name: 'Building' })
    const ground = LevelNode.parse({ name: 'Ground', level: 0, parentId: building.id })
    const upper = LevelNode.parse({ name: 'Upper', level: 1, parentId: building.id })
    const manualOpening: Array<[number, number]> = [
      [1.0, 0.0],
      [3.0, 0.0],
      [3.0, 3.0],
      [1.0, 3.0],
    ]
    const staleAutoOpening: Array<[number, number]> = [
      [1.5, 1],
      [2.5, 1],
      [2.5, 2.8],
      [1.5, 2.8],
    ]
    const landingSlab = SlabNode.parse({
      name: 'Landing Slab',
      parentId: upper.id,
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      holes: [manualOpening, staleAutoOpening],
      holeMetadata: [{ source: 'manual' }, { source: 'stair', stairId: 'stair_main' }],
    })
    const segment = StairSegmentNode.parse({
      parentId: 'stair_main',
      width: 1,
      length: 2.6,
      height: 2.5,
      stepCount: 12,
    })
    const stair = StairNode.parse({
      id: 'stair_main',
      name: 'Main Stair',
      parentId: ground.id,
      position: [2, 0, 0.2],
      stairType: 'straight',
      fromLevelId: ground.id,
      toLevelId: upper.id,
      slabOpeningMode: 'destination',
      children: [segment.id],
    })
    const nodes = Object.fromEntries(
      [building, ground, upper, landingSlab, stair, { ...segment, parentId: stair.id }].map(
        (node) => [node.id, node],
      ),
    ) as Record<string, AnyNode>

    const updates = syncAutoStairOpenings(nodes)
    const landingUpdate = updates.find((update) => update.id === landingSlab.id)

    expect(landingUpdate?.data.holes).toEqual([manualOpening])
    expect(landingUpdate?.data.holeMetadata).toEqual([{ source: 'manual' }])
  })

  test('does not add a separate rectangular hole for an integrated spiral top landing', () => {
    const building = BuildingNode.parse({ name: 'Building' })
    const ground = LevelNode.parse({ name: 'Ground', level: 0, parentId: building.id })
    const upper = LevelNode.parse({ name: 'Upper', level: 1, parentId: building.id })
    const landingSlab = SlabNode.parse({
      name: 'Landing Slab',
      parentId: upper.id,
      polygon: [
        [-4, -4],
        [4, -4],
        [4, 4],
        [-4, 4],
      ],
    })
    const stair = StairNode.parse({
      id: 'stair_spiral_landing',
      name: 'Spiral Landing Stair',
      parentId: ground.id,
      position: [0, 0, 0],
      rotation: Math.PI / 2,
      stairType: 'spiral',
      fromLevelId: ground.id,
      toLevelId: upper.id,
      slabOpeningMode: 'destination',
      innerRadius: 0.35,
      width: 1.2,
      sweepAngle: Math.PI * 1.6,
      topLandingMode: 'integrated',
      topLandingDepth: 1.1,
    })
    const nodes = Object.fromEntries(
      [building, ground, upper, landingSlab, stair].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>

    const updates = syncAutoStairOpenings(nodes)
    const landingUpdate = updates.find((update) => update.id === landingSlab.id)
    const holes = landingUpdate?.data.holes ?? []
    const rectangularHoles = holes.filter((hole) => hole.length === 4)

    expect(holes).toHaveLength(1)
    expect(rectangularHoles).toHaveLength(0)
    expect(landingUpdate?.data.holeMetadata).toEqual([{ source: 'stair', stairId: stair.id }])
  })
})

test('an unrelated slab edit preserves a loaded stair opening with historical geometry', () => {
  const building = BuildingNode.parse({})
  const lower = LevelNode.parse({ parentId: building.id, level: 0, height: 3 })
  const upper = LevelNode.parse({ parentId: building.id, level: 1 })
  const segment = StairSegmentNode.parse({ height: 3, length: 4.5 })
  const stair = StairNode.parse({
    parentId: lower.id,
    fromLevelId: lower.id,
    toLevelId: upper.id,
    slabOpeningMode: 'destination',
    totalRise: 3,
    children: [segment.id],
  })
  const slab = SlabNode.parse({
    parentId: upper.id,
    polygon: [
      [-5, -5],
      [5, -5],
      [5, 10],
      [-5, 10],
    ],
  })
  const opening = FloorOpeningNode.parse({
    parentId: upper.id,
    source: 'stair',
    ownerId: stair.id,
    surfaceId: slab.id,
    cutsPrimary: true,
    polygon: [
      [-0.5, 3.5],
      [0.5, 3.5],
      [0.5, 4.5],
      [-0.5, 4.5],
    ],
  })
  building.children = [lower.id, upper.id]
  lower.children = [stair.id]
  upper.children = [slab.id, opening.id]
  segment.parentId = stair.id
  const before: Record<string, AnyNode> = Object.fromEntries(
    [building, lower, upper, segment, stair, slab, opening].map((node) => [node.id, node]),
  )
  const after = { ...before, [slab.id]: { ...slab, thickness: slab.thickness + 0.1 } }
  expect(
    planOwnedFloorOpenings(after).some((patch) => patch.op === 'update' && patch.id === opening.id),
  ).toBe(true)
  expect(
    planOwnedFloorOpenings(after, { ownerIds: changedStairOpeningOwners(before, after) }),
  ).toEqual([])
  const changed = { ...after, [segment.id]: { ...segment, length: segment.length + 1 } }
  expect(
    planOwnedFloorOpenings(changed, { ownerIds: changedStairOpeningOwners(after, changed) }).some(
      (patch) => patch.op === 'update' && patch.id === opening.id,
    ),
  ).toBe(true)
  const middle = LevelNode.parse({ parentId: building.id, level: 1, height: 2 })
  const top = { ...upper, level: 2 }
  const spanning = { ...before, [middle.id]: middle, [upper.id]: top }
  const redistributed = {
    ...spanning,
    [lower.id]: { ...lower, height: lower.height! + 0.5 },
    [middle.id]: { ...middle, height: middle.height! - 0.5 },
  }
  expect(changedStairOpeningOwners(spanning, redistributed).has(stair.id)).toBe(true)
  expect(
    changedStairOpeningOwners(before, {
      ...before,
      [segment.id]: { ...segment, visible: false },
    }).has(stair.id),
  ).toBe(true)
})

describe('mezzanine deck openings', () => {
  const box = (x0: number, z0: number, x1: number, z1: number): [number, number][] => [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ]

  function insideDeckStair(levelHeight: number) {
    const building = BuildingNode.parse({ name: 'Building' })
    const ground = LevelNode.parse({
      name: 'Ground',
      level: 0,
      parentId: building.id,
      height: levelHeight,
    })
    const upper = LevelNode.parse({ name: 'Upper', level: 1, parentId: building.id })
    const deck = SlabNode.parse({
      name: 'Deck',
      parentId: ground.id,
      support: 'open',
      elevation: 2.5,
      polygon: box(1.5, 0.1, 7.9, 3),
    })
    const hostCeiling = CeilingNode.parse({
      name: 'Host ceiling',
      parentId: ground.id,
      height: levelHeight - 0.1,
      polygon: box(0, 0, 8, 6),
    })
    const upperFloor = SlabNode.parse({
      name: 'Upper floor',
      parentId: upper.id,
      polygon: box(0, 0, 8, 6),
    })
    const segment = StairSegmentNode.parse({
      parentId: 'stair_inside',
      width: 1,
      length: 3.92,
      height: 2.5,
      stepCount: 14,
    })
    const stair = StairNode.parse({
      id: 'stair_inside',
      parentId: ground.id,
      position: [1.5, 0, 1.55],
      rotation: Math.PI / 2,
      fromLevelId: ground.id,
      toLevelId: null,
      deckSlabId: deck.id,
      slabOpeningMode: 'destination',
      children: [segment.id],
    })
    const nodes = Object.fromEntries(
      [building, ground, upper, deck, hostCeiling, upperFloor, stair, segment].map((node) => [
        node.id,
        node,
      ]),
    ) as Record<string, AnyNode>
    return { nodes, deck, hostCeiling, upperFloor, stair }
  }

  test('a deck stair with the cutout on cuts only its own deck, under the flight', () => {
    const { nodes, deck, stair } = insideDeckStair(5)
    const updates = syncAutoStairOpenings(nodes)
    expect(updates.map((update) => update.id)).toEqual([deck.id])
    const hole = updates[0]!.data.holes![0]!
    expect(updates[0]!.data.holeMetadata).toEqual([{ source: 'stair', stairId: stair.id }])
    const xs = hole.map(([x]) => x)
    // The cut ends at the top step, leaving the rest of the deck as a landing.
    expect(Math.max(...xs)).toBeCloseTo(1.5 + 3.92)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(1.5)
  })

  test('a deck stair never cuts the host ceiling or the floor above, even within headroom', () => {
    // 2.5 m deck + 2 m headroom reaches past a 4 m storey's ceiling and floor above.
    const { nodes, deck, hostCeiling, upperFloor, stair } = insideDeckStair(4)
    const ids = syncAutoStairOpenings(nodes).map((update) => update.id)
    expect(ids).toContain(deck.id)
    expect(ids).not.toContain(hostCeiling.id)
    expect(ids).not.toContain(upperFloor.id)
    // Without the deck link the same flight would cut both.
    const ordinary = { ...stair, deckSlabId: undefined, toLevelId: null }
    const unlinked = syncAutoStairOpenings({ ...nodes, [stair.id]: ordinary }).map((u) => u.id)
    expect(unlinked).toContain(hostCeiling.id)
    expect(unlinked).toContain(upperFloor.id)
  })

  test('a deck stair with the cutout off cuts nothing', () => {
    const { nodes, stair } = insideDeckStair(5)
    const outside = { ...stair, slabOpeningMode: 'none' as const }
    expect(syncAutoStairOpenings({ ...nodes, [stair.id]: outside })).toEqual([])
  })

  test('an L stair keeps its intermediate landing on a deck it meets, and cuts only its stairwell above', () => {
    const building = BuildingNode.parse({ name: 'Building' })
    const ground = LevelNode.parse({ name: 'Ground', level: 0, parentId: building.id, height: 3 })
    const upper = LevelNode.parse({ name: 'Upper', level: 1, parentId: building.id })
    const upperFloor = SlabNode.parse({
      name: 'Upper floor',
      parentId: upper.id,
      polygon: box(-2, -2, 8, 8),
    })
    // A split-level deck flush with the landing (1.5 m) that the landing runs onto.
    const deck = SlabNode.parse({
      name: 'Split-level deck',
      parentId: ground.id,
      support: 'open',
      elevation: 1.5,
      polygon: box(-1, 2.7, 4, 6),
    })
    const first = StairSegmentNode.parse({
      parentId: 'stair_l',
      width: 1,
      length: 2.5,
      height: 1.5,
      stepCount: 9,
    })
    const landing = StairSegmentNode.parse({
      parentId: 'stair_l',
      segmentType: 'landing',
      width: 2,
      length: 1,
      height: 0,
      stepCount: 0,
    })
    const second = StairSegmentNode.parse({
      parentId: 'stair_l',
      width: 1,
      length: 2.5,
      height: 1.5,
      stepCount: 9,
      attachmentSide: 'left',
    })
    const stair = StairNode.parse({
      id: 'stair_l',
      parentId: ground.id,
      position: [2, 0, 0.2],
      fromLevelId: ground.id,
      toLevelId: upper.id,
      slabOpeningMode: 'destination',
      children: [first.id, landing.id, second.id],
    })
    const nodes = Object.fromEntries(
      [building, ground, upper, upperFloor, deck, stair, first, landing, second].map((node) => [
        node.id,
        node,
      ]),
    ) as Record<string, AnyNode>
    const updates = syncAutoStairOpenings(nodes)
    const landingCentre: [number, number] = [2, 3.2]
    const contains = (ring: [number, number][], [x, z]: [number, number]) => {
      let inside = false
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, zi] = ring[i]!
        const [xj, zj] = ring[j]!
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
      }
      return inside
    }
    const deckHoles = updates.find((update) => update.id === deck.id)?.data.holes ?? []
    expect(deckHoles.some((hole) => contains(hole, landingCentre))).toBe(false)
    // The storey above still opens over the whole flight, landing included (headroom).
    const floorHoles = updates.find((update) => update.id === upperFloor.id)?.data.holes ?? []
    expect(floorHoles.some((hole) => contains(hole, landingCentre))).toBe(true)
  })
})
