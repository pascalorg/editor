import { describe, expect, test } from 'bun:test'
import { buildGroundLevelChanges } from '../building/ground-level'
import { buildLevelBelowChanges } from '../building/level-insertion'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  LevelNode,
  SiteNode,
  SlabNode,
} from '../schema'
import { levelFloorWorldY } from '../services/storey'
import { getStoreyDatum } from '../services/storey-datum'
import { belowGradeFootprints } from './below-grade-footprints'
import { levelGradeStanding } from './grade-standing'
import { groundLevelOf } from './ground-level'
import { GROUND_FLOOR_ABOVE_GRADE, groundSeat } from './ground-seat'
import { encodeTerrainField } from './terrain-codec'
import { createTerrainField } from './terrain-field'

type Nodes = Record<AnyNodeId, AnyNode>

const rect = (x0: number, z0: number, x1: number, z1: number): Array<[number, number]> => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
]

/** The levels, bottom to top, as [id, floor index, base offset, height, footprint]. */
type Spec = [string, number, number, number, Array<[number, number]>]

function scene(specs: Spec[], extras: AnyNode[] = [], buildingY = 0, terrain?: unknown): Nodes {
  const site = SiteNode.parse({
    id: 'site_a',
    children: ['building_a'],
    ...(terrain ? { terrain } : {}),
  })
  const building = BuildingNode.parse({
    id: 'building_a',
    parentId: 'site_a',
    children: specs.map(([id]) => id),
    position: [0, buildingY, 0],
  })
  const list: AnyNode[] = [site, building, ...extras]
  for (const [id, level, baseElevation, height, footprint] of specs) {
    list.push(
      LevelNode.parse({
        id,
        parentId: 'building_a',
        level,
        baseElevation,
        height,
        children: [`slab_${id}`],
      }),
      SlabNode.parse({ id: `slab_${id}`, parentId: id, polygon: footprint, elevation: 0.28 }),
    )
  }
  return Object.fromEntries(list.map((node) => [node.id, node])) as Nodes
}

const apply = (
  nodes: Nodes,
  changes: { create?: Array<{ node: AnyNode }>; update?: Array<{ id: string; data: unknown }> },
): Nodes => {
  const next = { ...nodes } as Record<string, AnyNode>
  for (const { node } of changes.create ?? []) {
    next[node.id] = node
    const parent = node.parentId ? next[node.parentId] : undefined
    if (parent?.type === 'building')
      next[parent.id] = { ...parent, children: [...parent.children, node.id] } as AnyNode
  }
  for (const { id, data } of changes.update ?? [])
    next[id] = { ...next[id], ...(data as object) } as AnyNode
  return next as Nodes
}

const datum = (nodes: Nodes, id: string) =>
  Math.round((levelFloorWorldY(nodes, id) ?? Number.NaN) * 1000) / 1000 + 0

/**
 * The owner's mansion (15 Oct): Reception over Lower Ground over Basement 2, the stack seated so
 * that Lower Ground's floor reads 0, which is where the basement was drawn above the terrain.
 * Basement 2 is wider than the house; Lower Ground is under part of it.
 */
const mansion = () =>
  scene([
    ['level_b2', -2, -3.4, 3.4, rect(-14, -12, 14, 12)],
    ['level_lg', -1, 0, 3.4, rect(-8, -6, 8, 6)],
    ['level_reception', 0, 0, 4, rect(-10, -8, 10, 8)],
    ['level_suites', 1, 0, 3.4, rect(-10, -8, 10, 8)],
  ])

describe('the ground line', () => {
  test('a parsed building names no ground level until one is set', () => {
    expect(BuildingNode.parse({ id: 'building_x' }).groundLevelId).toBeUndefined()
  })

  test('a house with one basement reads as it always did: no name, nothing moves', () => {
    const nodes = scene([
      ['level_base', -1, -2.5, 2.5, rect(0, 0, 6, 6)],
      ['level_ground', 0, 0, 2.5, rect(0, 0, 8, 8)],
      ['level_up', 1, 0, 2.5, rect(0, 0, 8, 8)],
    ])
    const ground = groundLevelOf(nodes, 'building_a')
    expect(ground).toMatchObject({ explicit: false, level: { id: 'level_ground' } })
    expect(levelGradeStanding(nodes, 'level_base')).toBe('below-grade')
    expect(levelGradeStanding(nodes, 'level_ground')).toBe('at-grade')
    expect(levelGradeStanding(nodes, 'level_up')).toBe('at-grade')
    expect(groundSeat(nodes, 'building_a')).toMatchObject({ seated: true, explicit: false })
  })

  test('the mansion unset: the basement the stack put at grade is read at grade, as it was drawn', () => {
    const nodes = mansion()
    expect(groundLevelOf(nodes, 'building_a')?.level.id).toBe('level_lg')
    expect(levelGradeStanding(nodes, 'level_lg')).toBe('at-grade')
    expect(levelGradeStanding(nodes, 'level_b2')).toBe('below-grade')
  })

  test('setting the ground floor seats the building: Reception at grade, both basements under it', () => {
    const nodes = mansion()
    const changes = buildGroundLevelChanges({ nodes, levelId: 'level_reception' })
    expect(changes?.moveBy).toBeCloseTo(-3.4 + GROUND_FLOOR_ABOVE_GRADE, 9)
    expect(changes?.renumbered).toBe(false)
    const next = apply(nodes, changes!)
    expect((next.building_a as BuildingNode).position).toEqual([
      0,
      -3.4 + GROUND_FLOOR_ABOVE_GRADE,
      0,
    ])
    expect((next.building_a as BuildingNode).groundLevelId).toBe('level_reception')
    expect(groundSeat(next, 'building_a')).toMatchObject({
      seated: true,
      atFoundationTop: true,
      explicit: true,
    })
    expect(datum(next, 'level_reception')).toBeCloseTo(0.28 + GROUND_FLOOR_ABOVE_GRADE, 9)
    expect(datum(next, 'level_lg')).toBeCloseTo(-3.4 + 0.28 + GROUND_FLOOR_ABOVE_GRADE, 9)
    expect(datum(next, 'level_b2')).toBeCloseTo(-6.8 + 0.28 + GROUND_FLOOR_ABOVE_GRADE, 9)
    expect(levelGradeStanding(next, 'level_reception')).toBe('at-grade')
    expect(levelGradeStanding(next, 'level_suites')).toBe('at-grade')
    expect(levelGradeStanding(next, 'level_lg')).toBe('below-grade')
    expect(levelGradeStanding(next, 'level_b2')).toBe('below-grade')
    // The plan stays where it was.
    expect((next.building_a as BuildingNode).position.filter((_, i) => i !== 1)).toEqual([0, 0])
  })

  test('the hole opens over the shown level and those between it and grade, not the deeper ones', () => {
    const next = apply(
      mansion(),
      buildGroundLevelChanges({ nodes: mansion(), levelId: 'level_reception' })!,
    )
    const extent = (ring: Array<[number, number]>) => [
      Math.min(...ring.map(([x]) => x)),
      Math.max(...ring.map(([x]) => x)),
    ]
    const lg = belowGradeFootprints(next, 'level_lg')
    expect(lg).toHaveLength(1)
    expect(extent(lg[0]!)).toEqual([-8, 8])
    // With Basement 2 shown, the wider floor joins Lower Ground's into one outline.
    const b2 = belowGradeFootprints(next, 'level_b2')
    expect(b2).toHaveLength(1)
    expect(extent(b2[0]!)).toEqual([-14, 14])
    // From the ground floor, nothing is open.
    expect(belowGradeFootprints(next, 'level_reception')).toEqual([])
  })

  test('making Lower Ground the ground floor renumbers: it is 0, Basement 2 is -1, Reception 1', () => {
    const nodes = mansion()
    const changes = buildGroundLevelChanges({ nodes, levelId: 'level_lg' })
    expect(changes?.renumbered).toBe(true)
    const next = apply(nodes, changes!)
    const index = (id: string) => (next[id as AnyNodeId] as LevelNode).level
    expect([
      index('level_b2'),
      index('level_lg'),
      index('level_reception'),
      index('level_suites'),
    ]).toEqual([-1, 0, 1, 2])
    // Already at grade: it only rises to the foundation's top, 8 in over the ground.
    expect((next.building_a as BuildingNode).position[1]).toBe(GROUND_FLOOR_ABOVE_GRADE)
    expect(levelGradeStanding(next, 'level_b2')).toBe('below-grade')
    expect(levelGradeStanding(next, 'level_reception')).toBe('at-grade')
  })

  test('the ground floor stands 8 in (0.203 m) over finished grade on a flat site', () => {
    const nodes = scene([
      ['level_base', -1, -2.5, 2.5, rect(0, 0, 6, 6)],
      ['level_ground', 0, 0, 2.5, rect(0, 0, 8, 8)],
    ])
    const changes = buildGroundLevelChanges({ nodes, levelId: 'level_ground' })
    expect(GROUND_FLOOR_ABOVE_GRADE).toBe(0.203)
    expect(changes?.unchanged).toBe(false)
    const next = apply(nodes, changes!)
    expect((next.building_a as BuildingNode).position[1]).toBeCloseTo(0.203, 9)
    expect(getStoreyDatum(next, 'level_ground')?.floorElevation).toBeCloseTo(0.203, 9)
    expect(groundSeat(next, 'building_a')?.offset).toBeCloseTo(0.203, 9)
    expect(levelGradeStanding(next, 'level_base')).toBe('below-grade')
    expect(levelGradeStanding(next, 'level_ground')).toBe('at-grade')
  })

  test('a ground floor seated before the 8 in rule, at grade, is still seated, and rises when set again', () => {
    const nodes = scene([
      ['level_base', -1, -2.5, 2.5, rect(0, 0, 6, 6)],
      ['level_ground', 0, 0, 2.5, rect(0, 0, 8, 8)],
    ])
    const named = {
      ...nodes,
      building_a: { ...nodes.building_a, groundLevelId: 'level_ground' },
    } as Nodes
    expect(groundSeat(named, 'building_a')).toMatchObject({
      explicit: true,
      seated: true,
      atFoundationTop: false,
    })
    const changes = buildGroundLevelChanges({ nodes: named, levelId: 'level_ground' })
    expect(changes?.unchanged).toBe(false)
    expect(changes?.moveBy).toBeCloseTo(0.203, 9)
  })

  test('a ground floor standing well over the ground, or under it, is not seated', () => {
    const over = scene([['level_ground', 0, 0, 2.5, rect(0, 0, 8, 8)]], [], 0.6)
    const under = scene([['level_ground', 0, 0, 2.5, rect(0, 0, 8, 8)]], [], -0.4)
    for (const nodes of [over, under]) {
      const named = {
        ...nodes,
        building_a: { ...nodes.building_a, groundLevelId: 'level_ground' },
      } as Nodes
      expect(groundSeat(named, 'building_a')?.seated).toBe(false)
    }
  })

  test('is idempotent: the same level again changes nothing', () => {
    const nodes = mansion()
    const next = apply(nodes, buildGroundLevelChanges({ nodes, levelId: 'level_reception' })!)
    expect(buildGroundLevelChanges({ nodes: next, levelId: 'level_reception' })?.unchanged).toBe(
      true,
    )
  })

  test('a deleted ground level falls back to the elevations', () => {
    const nodes = mansion()
    const next = apply(nodes, buildGroundLevelChanges({ nodes, levelId: 'level_reception' })!)
    const { level_reception: _gone, ...rest } = next as Record<string, AnyNode>
    const building = rest.building_a as BuildingNode
    rest.building_a = {
      ...building,
      children: building.children.filter((id) => id !== 'level_reception'),
    } as AnyNode
    expect(groundLevelOf(rest as Nodes, 'building_a')?.explicit).toBe(false)
  })
})

describe('stacking under the line', () => {
  const seated = () => {
    const nodes = mansion()
    return apply(nodes, buildGroundLevelChanges({ nodes, levelId: 'level_reception' })!)
  }

  test('a third basement goes under Basement 2 and no floor moves', () => {
    const nodes = seated()
    const before = ['level_b2', 'level_lg', 'level_reception', 'level_suites'].map((id) =>
      datum(nodes, id),
    )
    const built = buildLevelBelowChanges({ nodes, buildingId: 'building_a', height: 3 })
    const next = apply(nodes, built)
    expect(
      ['level_b2', 'level_lg', 'level_reception', 'level_suites'].map((id) => datum(next, id)),
    ).toEqual(before)
    expect(built.newLevel.level).toBe(-3)
    expect(getStoreyDatum(next, built.newLevel.id)?.floorElevation).toBeCloseTo(
      (getStoreyDatum(nodes, 'level_b2')?.floorElevation ?? 0) - 3,
      9,
    )
    expect(levelGradeStanding(next, built.newLevel.id)).toBe('below-grade')
    expect(groundSeat(next, 'building_a')?.seated).toBe(true)
  })
})

describe('a hillside', () => {
  /** The site's ground at 1.5 m everywhere, a lot higher than the datum. */
  const raised = () => {
    const field = createTerrainField({ cols: 33, rows: 33, spacing: 1, origin: [-16, -16] })
    return { ...field, heights: new Int16Array(field.heights.length).fill(150) }
  }

  test('seats the ground floor on the ground under it, not on the datum', () => {
    const nodes = scene(
      [
        ['level_base', -1, -2.5, 2.5, rect(-4, -4, 4, 4)],
        ['level_ground', 0, 0, 2.5, rect(-5, -5, 5, 5)],
      ],
      [],
      0,
      encodeTerrainField(raised()),
    )
    const changes = buildGroundLevelChanges({ nodes, levelId: 'level_ground' })
    expect(changes?.seat.gradeElevation).toBeCloseTo(1.5, 6)
    expect(changes?.moveBy).toBeCloseTo(1.5 + GROUND_FLOOR_ABOVE_GRADE, 6)
    const next = apply(nodes, changes!)
    expect((next.building_a as BuildingNode).position[1]).toBeCloseTo(
      1.5 + GROUND_FLOOR_ABOVE_GRADE,
      6,
    )
    expect(groundSeat(next, 'building_a')).toMatchObject({ seated: true, atFoundationTop: true })
    expect(groundSeat(next, 'building_a')?.offset).toBeCloseTo(GROUND_FLOOR_ABOVE_GRADE, 6)
    expect(levelGradeStanding(next, 'level_base')).toBe('below-grade')
    expect(levelGradeStanding(next, 'level_ground')).toBe('at-grade')
  })

  test('a floor under the line the terrain leaves out of the ground reads partly below', () => {
    // The ground at the datum, a basement whose floor stands over it (a mis-seated stack).
    const flat = createTerrainField({ cols: 33, rows: 33, spacing: 1, origin: [-16, -16] })
    const nodes = scene(
      [
        ['level_base', -1, 4, 2.5, rect(-4, -4, 4, 4)],
        ['level_ground', 0, 0, 2.5, rect(-5, -5, 5, 5)],
      ],
      [],
      0,
      encodeTerrainField(flat),
    )
    const named = {
      ...nodes,
      building_a: { ...nodes.building_a, groundLevelId: 'level_ground' },
    } as Nodes
    expect(levelGradeStanding(named, 'level_base')).toBe('partly-below-grade')
  })
})
