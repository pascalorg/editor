import { describe, expect, test } from 'bun:test'
import type { AnyNode } from '../../schema'
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

  test('applies stair holes to a later destination slab when the configured offset overhangs the slab edge', () => {
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
    expect(Math.min(...hole!.map(([, z]) => z))).toBeCloseTo(-0.08)
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
