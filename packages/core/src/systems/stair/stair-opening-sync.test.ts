import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  changedStairOpeningOwners,
  FloorOpeningNode,
  planOwnedFloorOpenings,
} from '../../index'
import {
  BuildingNode,
  CeilingNode,
  LevelNode,
  SlabNode,
  StairNode,
  StairSegmentNode,
} from '../../schema'
import { syncAutoStairOpenings } from './stair-opening-sync'

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

test('headroom cuts follow tread heights and slab undersides while preserving authored holes', async () => {
  const { measureStairHeadroom, resolveStairWalkingSurfaces, syncAutoStairOpenings } = await import(
    '@pascal-app/core'
  )
  const { containsPoint } = await import('../../lib/polygon-boolean')
  const building = BuildingNode.parse({})
  const ground = LevelNode.parse({ parentId: building.id, level: 0, height: 3 })
  const upper = LevelNode.parse({ parentId: building.id, level: 1 })
  const flight = StairSegmentNode.parse({ height: 3, length: 5, stepCount: 15, fillToFloor: false })
  const stair = StairNode.parse({
    parentId: ground.id,
    fromLevelId: ground.id,
    toLevelId: upper.id,
    children: [flight.id],
    totalRise: 3,
    slabOpeningMode: 'destination',
  })
  const manual: [number, number][] = [
    [-3, -3],
    [-2, -3],
    [-2, -2],
    [-3, -2],
  ]
  const slab = SlabNode.parse({
    parentId: upper.id,
    elevation: 0,
    thickness: 0.2,
    polygon: [
      [-4, -4],
      [4, -4],
      [4, 8],
      [-4, 8],
    ],
    holes: [manual],
    holeMetadata: [{ source: 'manual' }],
  })
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [building, ground, upper, stair, { ...flight, parentId: stair.id }, slab].map((node) => [
      node.id,
      node,
    ]),
  )
  expect(resolveStairWalkingSurfaces(stair, nodes).at(-1)?.top).toBeCloseTo(3)
  expect(
    measureStairHeadroom(stair, nodes).obstructions.some((hit) => hit.nodeId === slab.id),
  ).toBe(true)
  const patch = syncAutoStairOpenings(nodes).find((update) => update.id === slab.id)!.data
  expect(patch.holes?.[0]).toEqual(manual)
  const cuts = patch.holes!.slice(1).map((outer) => ({ outer, holes: [] }))
  expect(containsPoint(cuts, [0, 1.2])).toBe(false)
  expect(containsPoint(cuts, [0, 1.5])).toBe(true)
  const opened = { ...nodes, [slab.id]: { ...slab, ...patch } }
  expect(measureStairHeadroom(stair, opened).obstructions).toHaveLength(0)
  expect(syncAutoStairOpenings(opened)).toHaveLength(0)
  const thicker = { ...nodes, [slab.id]: { ...slab, thickness: 0.8 } }
  const larger = syncAutoStairOpenings(thicker)
    .find((update) => update.id === slab.id)!
    .data.holes!.slice(1)
    .map((outer) => ({ outer, holes: [] }))
  expect(containsPoint(larger, [0, 0.5])).toBe(true)
})

test('repeated signed spiral turns measure the upper tread underside and preserve the centre of annular cuts', async () => {
  const { measureStairHeadroom, stairClearanceOpening } = await import('@pascal-app/core')
  const { containsPoint } = await import('../../lib/polygon-boolean')
  for (const sign of [-1, 1]) {
    const stair = StairNode.parse({
      stairType: 'spiral',
      totalRise: 3,
      stepCount: 40,
      sweepAngle: sign * 4 * Math.PI,
      innerRadius: 0.4,
      width: 1,
      thickness: 0.05,
      showCenterColumn: false,
      topLandingMode: 'none',
    })
    const nodes = { [stair.id]: stair }
    const measured = measureStairHeadroom(stair, nodes)
    expect(measured.minimum).toBeCloseTo(1.45)
    expect(measured.obstructions.length).toBeGreaterThan(0)
    const withLanding = { ...stair, topLandingMode: 'integrated' as const }
    expect(measureStairHeadroom(withLanding, { [stair.id]: withLanding }).minimum!).toBeLessThan(
      measured.minimum!,
    )
    const cuts = stairClearanceOpening(stair, nodes, 2.8)!.map((outer) => ({ outer, holes: [] }))
    expect(containsPoint(cuts, [0, 0])).toBe(false)
    expect(containsPoint(cuts, [0.9, 0])).toBe(true)
  }
})

test('clearance queries preserve cuts and report incomplete coverage when effective counts exceed the query budget', async () => {
  const { measureStairHeadroom, resolveStairWalkingSurfaces, syncAutoStairOpenings } = await import(
    '@pascal-app/core'
  )
  const building = BuildingNode.parse({})
  const ground = LevelNode.parse({ parentId: building.id, level: 0, height: 3 })
  const upper = LevelNode.parse({ parentId: building.id, level: 1 })
  const first = StairSegmentNode.parse({ height: 3, length: 5, stepCount: 15, fillToFloor: false })
  const second = StairSegmentNode.parse({ height: 3, length: 5, stepCount: 15, fillToFloor: false })
  const stair = StairNode.parse({
    parentId: ground.id,
    fromLevelId: ground.id,
    toLevelId: upper.id,
    totalRise: 6,
    children: [first.id, second.id],
    slabOpeningMode: 'destination',
  })
  const slab = SlabNode.parse({
    parentId: upper.id,
    elevation: 0,
    thickness: 0.2,
    polygon: [
      [-2, -2],
      [2, -2],
      [2, 12],
      [-2, 12],
    ],
  })
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [building, ground, upper, stair, first, second, slab].map((node) => [node.id, node]),
  )
  const patch = syncAutoStairOpenings(nodes).find((update) => update.id === slab.id)!.data
  const opened = { ...nodes, [slab.id]: { ...slab, ...patch } }
  const oversized = {
    ...opened,
    [first.id]: { ...first, stepCount: 10001 },
    [second.id]: { ...second, stepCount: -10001 },
  }
  expect(measureStairHeadroom(stair, oversized).status).toBe('unresolved')
  expect(() => resolveStairWalkingSurfaces(stair, oversized)).toThrow(RangeError)
  expect(syncAutoStairOpenings(oversized)).toHaveLength(0)
  const other = StairNode.parse({
    parentId: ground.id,
    fromLevelId: ground.id,
    totalRise: 3,
    stairType: 'spiral',
    stepCount: 10001,
  })
  const incomplete = measureStairHeadroom(stair, { ...nodes, [other.id]: other })
  expect(incomplete.status).toBe('unresolved')
  expect(incomplete.checkedSurfaceTypes).toEqual(['slab', 'ceiling', 'stair-body'])
})

test('intermediate slab cuts stop above the floating body and hidden flights retain downstream chain transforms', async () => {
  const { resolveStairWalkingSurfaces, stairClearanceOpening } = await import('@pascal-app/core')
  const first = StairSegmentNode.parse({
    height: 3,
    length: 5,
    stepCount: 15,
    fillToFloor: false,
    thickness: 0.25,
  })
  const second = StairSegmentNode.parse({
    height: 3,
    length: 5,
    stepCount: 15,
    fillToFloor: false,
    thickness: 0.25,
  })
  const stair = StairNode.parse({ totalRise: 6, children: [first.id, second.id] })
  const nodes: Record<string, AnyNode> = {
    [stair.id]: stair,
    [first.id]: first,
    [second.id]: second,
  }
  const cuts = stairClearanceOpening(stair, nodes, 2.8, 0, 3)!
  const end = Math.max(...cuts.flatMap((ring) => ring.map((point) => point[1])))
  // The sloped underside crosses the slab beyond the first upper tread.
  expect(end).toBeGreaterThan(5 + 5 / 15)
  expect(end).toBeLessThan(6)
  const surfaces = resolveStairWalkingSurfaces(stair, {
    ...nodes,
    [first.id]: { ...first, visible: false },
  })
  expect(surfaces[0]?.nodeId).toBe(second.id)
  expect(surfaces[0]?.walkingLine[0][2]).toBeCloseTo(5)
  expect(surfaces[0]?.top).toBeCloseTo(3.2)
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
})
