// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// include Bun ambient types in its production declaration build.
import { describe, expect, test } from 'bun:test'
import { getLevelBuildingId, getLevelStackPositions, type LevelStackEntry } from './level-stacking'

describe('getLevelBuildingId', () => {
  const buildings = [
    { id: 'building_a', children: ['level_a0'] },
    { id: 'building_b', children: ['level_b0'] },
  ]

  test('uses an explicit building parent', () => {
    expect(getLevelBuildingId('level_a0', 'building_a', buildings)).toBe('building_a')
  })

  test('falls back to building children for legacy levels without a parentId', () => {
    expect(getLevelBuildingId('level_b0', null, buildings)).toBe('building_b')
  })

  test('ignores a non-building parent before checking building children', () => {
    expect(getLevelBuildingId('level_a0', 'site_main', buildings)).toBe('building_a')
  })
})

describe('getLevelStackPositions', () => {
  test('stacks levels within one building by level index', () => {
    const entries: LevelStackEntry[] = [
      { levelId: 'level_second', buildingId: 'building_a', index: 2, height: 3.4 },
      { levelId: 'level_ground', buildingId: 'building_a', index: 0, height: 2.5 },
      { levelId: 'level_first', buildingId: 'building_a', index: 1, height: 3.1 },
    ]

    expect(Object.fromEntries(getLevelStackPositions(entries))).toEqual({
      level_ground: 0,
      level_first: 2.5,
      level_second: 5.6,
    })
  })

  test('starts each building on its own ground plane', () => {
    const entries: LevelStackEntry[] = [
      { levelId: 'level_a0', buildingId: 'building_a', index: 0, height: 2.5 },
      { levelId: 'level_b0', buildingId: 'building_b', index: 0, height: 3 },
      { levelId: 'level_a1', buildingId: 'building_a', index: 1, height: 2.8 },
      { levelId: 'level_b1', buildingId: 'building_b', index: 1, height: 3.2 },
    ]

    expect(Object.fromEntries(getLevelStackPositions(entries))).toEqual({
      level_a0: 0,
      level_b0: 0,
      level_a1: 2.5,
      level_b1: 3,
    })
  })

  test('keeps orphan levels in one legacy stack', () => {
    const entries: LevelStackEntry[] = [
      { levelId: 'level_0', buildingId: null, index: 0, height: 2.7 },
      { levelId: 'level_1', buildingId: null, index: 1, height: 3 },
    ]

    expect(Object.fromEntries(getLevelStackPositions(entries))).toEqual({
      level_0: 0,
      level_1: 2.7,
    })
  })

  test('applies an offset to its level and every higher level in the same building', () => {
    const entries: LevelStackEntry[] = [
      {
        levelId: 'level_a0',
        buildingId: 'building_a',
        index: 0,
        height: 2.5,
        baseElevation: 0,
      },
      {
        levelId: 'level_b0',
        buildingId: 'building_b',
        index: 0,
        height: 3,
        baseElevation: 0,
      },
      {
        levelId: 'level_a1',
        buildingId: 'building_a',
        index: 1,
        height: 3,
        baseElevation: 1.25,
      },
      {
        levelId: 'level_b1',
        buildingId: 'building_b',
        index: 1,
        height: 3,
        baseElevation: 0,
      },
      {
        levelId: 'level_a2',
        buildingId: 'building_a',
        index: 2,
        height: 2.8,
        baseElevation: 0,
      },
    ]

    expect(Object.fromEntries(getLevelStackPositions(entries))).toEqual({
      level_a0: 0,
      level_b0: 0,
      level_a1: 3.75,
      level_b1: 3,
      level_a2: 6.75,
    })
  })

  test('allows negative offsets', () => {
    const entries: LevelStackEntry[] = [
      {
        levelId: 'level_ground',
        buildingId: 'building_a',
        index: 0,
        height: 2.5,
        baseElevation: -0.75,
      },
      {
        levelId: 'level_first',
        buildingId: 'building_a',
        index: 1,
        height: 3,
        baseElevation: 0,
      },
    ]

    expect(Object.fromEntries(getLevelStackPositions(entries))).toEqual({
      level_ground: -0.75,
      level_first: 1.75,
    })
  })
})
