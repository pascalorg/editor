import { expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  CeilingNode,
  FloorOpeningNode,
  LevelNode,
  SlabNode,
  StairNode,
  StairSegmentNode,
} from '../../schema'
import { syncAutoStairOpenings } from './stair-opening-sync'
import { resolveStairTotalRise } from './stair-rise-query'

test('a stair leaves an authored opening and its own slab and ceiling cuts return', () => {
  const building = BuildingNode.parse({ id: 'building_stair_move' })
  const ground = LevelNode.parse({ id: 'level_stair_move_0', parentId: building.id, level: 0 })
  const upper = LevelNode.parse({ id: 'level_stair_move_1', parentId: building.id, level: 1 })
  const opening = FloorOpeningNode.parse({
    id: 'floor-opening_stair_move',
    parentId: upper.id,
    polygon: [
      [1, 0],
      [3, 0],
      [3, 3],
      [1, 3],
    ],
  })
  const footprint: [number, number][] = [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ]
  const ceiling = CeilingNode.parse({
    id: 'ceiling_stair_move',
    parentId: ground.id,
    polygon: footprint,
    holes: [opening.polygon],
    holeMetadata: [{ source: 'floor-opening', openingId: opening.id }],
  })
  const plate = SlabNode.parse({
    id: 'slab_stair_move',
    parentId: upper.id,
    polygon: footprint,
    holes: [opening.polygon],
    holeMetadata: [{ source: 'floor-opening', openingId: opening.id }],
  })
  const segment = StairSegmentNode.parse({
    id: 'sseg_stair_move',
    parentId: 'stair_stair_move',
    width: 1,
    length: 2.6,
    height: 2.5,
    stepCount: 12,
  })
  const stair = StairNode.parse({
    id: 'stair_stair_move',
    parentId: ground.id,
    position: [2, 0, 0.2],
    fromLevelId: ground.id,
    toLevelId: upper.id,
    slabOpeningMode: 'destination',
    children: [segment.id],
  })
  const nodes = Object.fromEntries(
    [building, ground, upper, opening, ceiling, plate, segment, stair].map((node) => [
      node.id,
      node,
    ]),
  ) as Record<string, AnyNode>
  expect(syncAutoStairOpenings(nodes)).toEqual([])
  const moved = syncAutoStairOpenings({
    ...nodes,
    [stair.id]: { ...stair, position: [3.2, 0, 0.2] },
  })
  expect(moved.find((entry) => entry.id === plate.id)?.data.holeMetadata).toContainEqual({
    source: 'stair',
    stairId: stair.id,
  })
  expect(moved.find((entry) => entry.id === ceiling.id)?.data.holeMetadata).toContainEqual({
    source: 'stair',
    stairId: stair.id,
  })
})

test('a spiral reaching a 4.5 m upper floor opens its plate and the ceiling below', () => {
  const building = BuildingNode.parse({ id: 'building_spiral_reach' })
  const ground = LevelNode.parse({
    id: 'level_spiral_reach_0',
    parentId: building.id,
    level: 0,
    height: 4.5,
  })
  const upper = LevelNode.parse({
    id: 'level_spiral_reach_1',
    parentId: building.id,
    level: 1,
  })
  building.children = [ground.id, upper.id]
  const footprint: [number, number][] = [
    [0, 0],
    [5, 0],
    [5, 5],
    [0, 5],
  ]
  const plate = SlabNode.parse({
    id: 'slab_spiral_reach',
    parentId: upper.id,
    polygon: footprint,
    elevation: 0.05,
  })
  const ceiling = CeilingNode.parse({
    id: 'ceiling_spiral_reach',
    parentId: ground.id,
    polygon: footprint,
  })
  const stair = StairNode.parse({
    id: 'stair_spiral_reach',
    parentId: ground.id,
    position: [2.5, 0, 2.5],
    stairType: 'spiral',
    stepCount: 24,
    fromLevelId: ground.id,
    toLevelId: upper.id,
    slabOpeningMode: 'destination',
  })
  const nodes = Object.fromEntries(
    [building, ground, upper, plate, ceiling, stair].map((node) => [node.id, node]),
  ) as Record<string, AnyNode>
  expect(resolveStairTotalRise(stair, nodes)).toBeCloseTo(4.5)
  const updates = syncAutoStairOpenings(nodes)
  expect(updates.find((update) => update.id === plate.id)?.data.holeMetadata).toContainEqual({
    source: 'stair',
    stairId: stair.id,
  })
  expect(updates.find((update) => update.id === ceiling.id)?.data.holeMetadata).toContainEqual({
    source: 'stair',
    stairId: stair.id,
  })
})
