import { describe, expect, test } from 'bun:test'
import { BuildingNode, LevelNode } from '../schema'
import type { AnyNode, AnyNodeId } from '../schema/types'
import { DEFAULT_LEVEL_HEIGHT } from './level-height'
import { getLevelElevations, getStoredLevelHeight } from './storey'

const buildNodes = (list: AnyNode[]): Record<AnyNodeId, AnyNode> =>
  Object.fromEntries(list.map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>

const level = (
  id: string,
  ordinal: number,
  opts: { height?: number; parentId?: string | null } = {},
): LevelNode =>
  LevelNode.parse({
    id,
    level: ordinal,
    parentId: opts.parentId ?? null,
    ...(opts.height === undefined ? {} : { height: opts.height }),
  })

const building = (id: string, children: string[]): BuildingNode =>
  BuildingNode.parse({ id, children })

describe('getStoredLevelHeight', () => {
  test('returns the stored height when present', () => {
    expect(getStoredLevelHeight(level('level_a', 0, { height: 3.25 }))).toBe(3.25)
  })

  test('falls back to the default for unmigrated legacy levels', () => {
    expect(getStoredLevelHeight(level('level_a', 0))).toBe(DEFAULT_LEVEL_HEIGHT)
    expect(getStoredLevelHeight(level('level_a', 0))).toBe(2.5)
  })
})

describe('getLevelElevations', () => {
  test('single building matches a hand-computed prefix sum', () => {
    const nodes = buildNodes([
      building('building_a', ['level_0', 'level_1', 'level_2', 'level_3']),
      level('level_0', 0, { height: 3, parentId: 'building_a' }),
      level('level_1', 1, { height: 2.5, parentId: 'building_a' }),
      level('level_2', 2, { height: 2.75, parentId: 'building_a' }),
      level('level_3', 3, { height: 4, parentId: 'building_a' }),
    ])

    const elevations = getLevelElevations(nodes)
    expect(elevations.get('level_0')).toEqual({
      baseY: 0,
      height: 3,
      buildingId: 'building_a',
      ordinal: 0,
    })
    expect(elevations.get('level_1')?.baseY).toBe(3)
    expect(elevations.get('level_2')?.baseY).toBe(5.5)
    expect(elevations.get('level_3')?.baseY).toBe(8.25)
  })

  test('stacks two buildings independently with interleaved, unsorted ordinals', () => {
    const nodes = buildNodes([
      level('level_b1', 1, { height: 2.5, parentId: 'building_b' }),
      level('level_a2', 2, { height: 3, parentId: 'building_a' }),
      building('building_a', ['level_a0', 'level_a1', 'level_a2']),
      level('level_a0', 0, { height: 3.5, parentId: 'building_a' }),
      building('building_b', ['level_b0', 'level_b1']),
      level('level_b0', 0, { height: 4, parentId: 'building_b' }),
      level('level_a1', 1, { height: 3.25, parentId: 'building_a' }),
    ])

    const elevations = getLevelElevations(nodes)
    expect(elevations.get('level_a0')?.baseY).toBe(0)
    expect(elevations.get('level_a1')?.baseY).toBe(3.5)
    expect(elevations.get('level_a2')?.baseY).toBe(6.75)
    expect(elevations.get('level_b0')?.baseY).toBe(0)
    expect(elevations.get('level_b1')?.baseY).toBe(4)
    expect(elevations.get('level_a2')?.buildingId).toBe('building_a')
    expect(elevations.get('level_b1')?.buildingId).toBe('building_b')
  })

  test('negative ordinals stack from the lowest level up', () => {
    const nodes = buildNodes([
      building('building_a', ['level_basement', 'level_ground', 'level_upper']),
      level('level_upper', 1, { height: 3, parentId: 'building_a' }),
      level('level_basement', -1, { height: 2.25, parentId: 'building_a' }),
      level('level_ground', 0, { height: 2.5, parentId: 'building_a' }),
    ])

    const elevations = getLevelElevations(nodes)
    expect(elevations.get('level_basement')?.baseY).toBe(0)
    expect(elevations.get('level_ground')?.baseY).toBe(2.25)
    expect(elevations.get('level_upper')?.baseY).toBe(4.75)
  })

  test('duplicate and fractional ordinals stack stably without NaN', () => {
    const nodes = buildNodes([
      building('building_a', ['level_ground', 'level_mezz', 'level_dup_b', 'level_dup_a']),
      level('level_dup_b', 1, { height: 3, parentId: 'building_a' }),
      level('level_dup_a', 1, { height: 2.5, parentId: 'building_a' }),
      level('level_mezz', 0.5, { height: 1.5, parentId: 'building_a' }),
      level('level_ground', 0, { height: 2.5, parentId: 'building_a' }),
    ])

    const elevations = getLevelElevations(nodes)
    expect(elevations.get('level_ground')?.baseY).toBe(0)
    expect(elevations.get('level_mezz')?.baseY).toBe(2.5)
    // Stable sort: equal ordinals keep nodes-record insertion order.
    expect(elevations.get('level_dup_b')?.baseY).toBe(4)
    expect(elevations.get('level_dup_a')?.baseY).toBe(7)
    for (const elevation of elevations.values()) {
      expect(Number.isFinite(elevation.baseY)).toBe(true)
      expect(Number.isFinite(elevation.height)).toBe(true)
    }
  })

  test('levels missing height fall back to 2.5 for both height and stacking', () => {
    const nodes = buildNodes([
      building('building_a', ['level_0', 'level_1', 'level_2']),
      level('level_0', 0, { parentId: 'building_a' }),
      level('level_1', 1, { height: 3, parentId: 'building_a' }),
      level('level_2', 2, { parentId: 'building_a' }),
    ])

    const elevations = getLevelElevations(nodes)
    expect(elevations.get('level_0')?.height).toBe(2.5)
    expect(elevations.get('level_1')?.baseY).toBe(2.5)
    expect(elevations.get('level_2')?.baseY).toBe(5.5)
    expect(elevations.get('level_2')?.height).toBe(2.5)
  })

  test('resolves buildings via parentId, legacy children membership, and non-building parents', () => {
    const nodes = buildNodes([
      // level_direct is not in children; level_site has a non-building parentId.
      building('building_x', ['level_legacy', 'level_site']),
      level('level_direct', 0, { height: 3, parentId: 'building_x' }),
      level('level_legacy', 1, { height: 2.5, parentId: null }),
      level('level_site', 2, { height: 2.75, parentId: 'site_main' }),
    ])

    const elevations = getLevelElevations(nodes)
    expect(elevations.get('level_direct')?.buildingId).toBe('building_x')
    expect(elevations.get('level_legacy')?.buildingId).toBe('building_x')
    expect(elevations.get('level_site')?.buildingId).toBe('building_x')
    expect(elevations.get('level_direct')?.baseY).toBe(0)
    expect(elevations.get('level_legacy')?.baseY).toBe(3)
    expect(elevations.get('level_site')?.baseY).toBe(5.5)
  })

  test('levels with no resolvable building share one legacy stack from 0', () => {
    const nodes = buildNodes([
      level('level_orphan_1', 1, { height: 3 }),
      level('level_orphan_0', 0, { height: 2.75 }),
    ])

    const elevations = getLevelElevations(nodes)
    expect(elevations.get('level_orphan_0')).toEqual({
      baseY: 0,
      height: 2.75,
      buildingId: null,
      ordinal: 0,
    })
    expect(elevations.get('level_orphan_1')?.baseY).toBe(2.75)
  })
})
