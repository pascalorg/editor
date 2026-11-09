import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  ElevatorNode,
  LevelNode,
  SlabNode,
  StairNode,
  WallNode,
} from '../../schema'
import { getLevelElevations } from '../../services/storey'
import { usageShapes } from './shapes'
import type { Nodes } from './walls'

function house(extra: AnyNode[]): Nodes {
  const building = BuildingNode.parse({ id: 'building_1', children: ['level_0', 'level_1'] })
  const ground = LevelNode.parse({ id: 'level_0', parentId: 'building_1', level: 0, children: [] })
  const upper = LevelNode.parse({ id: 'level_1', parentId: 'building_1', level: 1, children: [] })
  return Object.fromEntries(
    [building, ground, upper, ...extra].map((node) => [node.id, node]),
  ) as Nodes
}

const slab = (id: string, levelId: string, over: Record<string, unknown> = {}) =>
  SlabNode.parse({
    id,
    parentId: levelId,
    polygon: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
    elevation: 0.05,
    ...over,
  })

const wall = (levelId: string) =>
  WallNode.parse({
    id: `wall_${levelId}`,
    parentId: levelId,
    start: [0, 0],
    end: [4, 0],
    thickness: 0.1,
    children: [],
  })

describe('usage shapes of a house', () => {
  test('a wall on an upper level stands at that level, in absolute building metres', () => {
    const nodes = house([wall('level_0'), wall('level_1')])
    const { levels } = usageShapes(nodes)
    const base = getLevelElevations(nodes).get('level_1')!.baseY
    expect(base).toBeGreaterThan(2)
    const ground = levels
      .find((l) => l.levelId === 'level_0')!
      .prisms.find((p) => p.kind === 'wall')!
    const upper = levels
      .find((l) => l.levelId === 'level_1')!
      .prisms.find((p) => p.kind === 'wall')!
    expect(ground.z0).toBe(0)
    expect(upper.z0).toBeCloseTo(base, 6)
    expect(upper.z1 - upper.z0).toBeCloseTo(ground.z1 - ground.z0, 6)
  })

  test('a stair is filed under the level it starts from and rises through the one above', () => {
    const stair = StairNode.parse({
      id: 'stair_1',
      parentId: 'level_0',
      fromLevelId: 'level_0',
      toLevelId: 'level_1',
      totalRise: 3,
      stepCount: 10,
      fillToFloor: true,
    })
    const { levels } = usageShapes(house([stair]))
    const below = levels
      .find((l) => l.levelId === 'level_0')!
      .prisms.filter((p) => p.kind === 'stair')
    expect(below).toHaveLength(10)
    expect(Math.max(...below.map((p) => p.z1))).toBeCloseTo(3, 6)
    expect(
      levels.find((l) => l.levelId === 'level_1')!.prisms.filter((p) => p.kind === 'stair'),
    ).toHaveLength(0)
  })

  test('the floor is the slab surface at the height the circulation graph reads, less recessed slabs', () => {
    const nodes = house([
      slab('slab_a', 'level_0'),
      slab('slab_b', 'level_1', { elevation: 0.1 }),
      slab('slab_pool', 'level_0', { recessed: true }),
    ])
    const { levels, skipped } = usageShapes(nodes)
    const base = getLevelElevations(nodes).get('level_1')!.baseY
    const ground = levels.find((l) => l.levelId === 'level_0')!.floors
    expect(ground.map((f) => f.nodeId)).toEqual(['slab_a'])
    expect(ground[0]!.y).toBeCloseTo(0.05, 6)
    expect(levels.find((l) => l.levelId === 'level_1')!.floors[0]!.y).toBeCloseTo(base + 0.1, 6)
    expect(skipped.some((s) => s.nodeId === 'slab_pool')).toBe(true)
  })

  test('a slab hole is a hole in the floor', () => {
    const holed = slab('slab_a', 'level_0', {
      holes: [
        [
          [1, 1],
          [2, 1],
          [2, 2],
          [1, 2],
        ],
      ],
    })
    const floor = usageShapes(house([holed])).levels[0]!.floors[0]!
    expect(floor.holes).toHaveLength(1)
  })

  test('what is not shaped yet is counted, not hidden', () => {
    const lift = ElevatorNode.parse({ id: 'elevator_1', parentId: 'level_0' })
    expect(usageShapes(house([lift])).unshaped).toEqual({ elevator: 1 })
  })

  test('one stair the resolvers refuse does not take the others down', () => {
    const fine = StairNode.parse({
      id: 'stair_ok',
      parentId: 'level_0',
      fromLevelId: 'level_0',
      totalRise: 3,
    })
    const huge = StairNode.parse({
      id: 'stair_huge',
      parentId: 'level_0',
      fromLevelId: 'level_0',
      stepCount: 100_000,
      totalRise: 3,
    })
    const result = usageShapes(house([fine, huge]))
    expect(result.skipped.map((s) => s.nodeId)).toEqual(['stair_huge'])
    expect(result.levels[0]!.prisms.some((p) => p.nodeId === 'stair_ok')).toBe(true)
  })
})
