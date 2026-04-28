// @ts-expect-error — bun:test is provided by the Bun runtime; core does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import type { AnyNode } from '../../schema'
import { BuildingNode, LevelNode, SlabNode, StairNode, StairSegmentNode } from '../../schema'
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
})
