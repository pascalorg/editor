import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  LevelNode,
  SlabNode,
  StairNode,
  StairSegmentNode,
} from '../schema'
import { verifyScene } from './index'

/** One stair of a single flight on a ground floor, `steps` risers over `length` m of run. */
function flight(steps: number, rise: number, length: number) {
  const building = BuildingNode.parse({ id: 'building_f', children: ['level_f'] })
  const level = LevelNode.parse({ id: 'level_f', parentId: building.id, level: 0, height: 3 })
  const slab = SlabNode.parse({
    id: 'slab_f',
    parentId: level.id,
    polygon: [
      [-2, -2],
      [6, -2],
      [6, 6],
      [-2, 6],
    ],
    elevation: 0.05,
  })
  const stair = StairNode.parse({
    id: 'stair_f',
    parentId: level.id,
    name: 'Flight',
    position: [1, 0, 1],
    width: 1,
    totalRise: rise,
    children: ['sseg_f'],
  })
  const segment = StairSegmentNode.parse({
    id: 'sseg_f',
    parentId: stair.id,
    width: 1,
    length,
    height: rise,
    stepCount: steps,
  })
  level.children = [slab.id, stair.id]
  return Object.fromEntries(
    [building, level, slab, stair, segment].map((node) => [node.id, node]),
  ) as Record<string, AnyNode>
}

const targets = (nodes: Record<string, AnyNode>) =>
  verifyScene(structuredClone(nodes), {}, { activeLevelId: null })
    .result.issues.filter((issue) => /^stair_(comfort|going)_target$/.test(issue.type))
    .map((issue) => issue.type)

describe('stair design targets on a short flight', () => {
  test('two steps up to a door have no going or comfort target to miss', () => {
    expect(targets(flight(2, 0.2278, 0.56))).toEqual([])
  })

  test('a staircase of fifteen steps with a short run still reports its comfort', () => {
    expect(targets(flight(15, 2.95, 3))).toContain('stair_comfort_target')
  })
})
