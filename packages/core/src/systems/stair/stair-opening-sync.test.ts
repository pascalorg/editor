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
  test('only applies stair holes to destination slabs that contain the opening', () => {
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

  test('does not add stair holes when a manual surface hole already covers them', () => {
    const building = BuildingNode.parse({ name: 'Building' })
    const ground = LevelNode.parse({ name: 'Ground', level: 0, parentId: building.id })
    const upper = LevelNode.parse({ name: 'Upper', level: 1, parentId: building.id })
    const manualOpening: Array<[number, number]> = [
      [1.2, 0.8],
      [2.8, 0.8],
      [2.8, 2.9],
      [1.2, 2.9],
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
      [1.2, 0.8],
      [2.8, 0.8],
      [2.8, 2.9],
      [1.2, 2.9],
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
})
