import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '../schema'
import { BuildingNode, LevelNode, SiteNode, SlabNode } from '../schema'
import hillside from './__fixtures__/owner-hillside-grade.json'
import { levelGradeStanding } from './grade-standing'
import { encodeTerrainField } from './terrain-codec'
import { createTerrainField } from './terrain-field'

const buildNodes = (list: AnyNode[]): Record<AnyNodeId, AnyNode> =>
  Object.fromEntries(list.map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>

const PLATE: Array<[number, number]> = [
  [-5, -4],
  [5, -4],
  [5, 4],
  [-5, 4],
]

/**
 * A site whose east half stands `eastHeight` metres over its west half, and a three-storey
 * stack on it (2.85 m storeys on 0.2 m plates, the hillside house's numbers).
 */
function hillsideStack(eastHeight: number | null) {
  const site =
    eastHeight === null
      ? SiteNode.parse({ id: 'site_a', children: ['building_a'] })
      : SiteNode.parse({
          id: 'site_a',
          children: ['building_a'],
          terrain: encodeTerrainField(eastRise(eastHeight)),
        })
  const level = (id: string, ordinal: number) =>
    LevelNode.parse({
      id,
      level: ordinal,
      height: 2.85,
      parentId: 'building_a',
      children: [`slab_${id}`],
    })
  const slab = (levelId: string) =>
    SlabNode.parse({
      id: `slab_${levelId}`,
      parentId: levelId,
      polygon: PLATE,
      elevation: 0.2,
    })
  return buildNodes([
    site,
    BuildingNode.parse({
      id: 'building_a',
      parentId: 'site_a',
      children: ['level_garden', 'level_living', 'level_street'],
    }),
    level('level_garden', 0),
    level('level_living', 1),
    level('level_street', 2),
    slab('level_garden'),
    slab('level_living'),
    slab('level_street'),
  ])
}

/** Flat west, a step up to `metres` on the east: heights are centimetre units (step 0.01). */
function eastRise(metres: number) {
  const field = createTerrainField({ cols: 33, rows: 33, spacing: 1, origin: [-16, -16] })
  const heights = new Int16Array(field.heights)
  for (let row = 0; row < field.rows; row += 1) {
    for (let col = 0; col < field.cols; col += 1) {
      const worldX = field.origin[0] + col * field.spacing
      heights[row * field.cols + col] = worldX >= 0 ? Math.round(metres * 100) : 0
    }
  }
  return { ...field, heights }
}

describe('levelGradeStanding', () => {
  test('a 6 m rise buries half of each lower floor and leaves the top one at grade', () => {
    const nodes = hillsideStack(6)
    // Floors at 0.2 and 3.05 m: the east ground (6 m) stands over both, the west (0 m) not.
    expect(levelGradeStanding(nodes, 'level_garden')).toBe('partly-below-grade')
    expect(levelGradeStanding(nodes, 'level_living')).toBe('partly-below-grade')
    // Floor at 5.9 m: the 6 m ground is within the 0.3 m tolerance of it.
    expect(levelGradeStanding(nodes, 'level_street')).toBe('at-grade')
  })

  test('ground raised over the whole footprint buries the floor outright', () => {
    const nodes = hillsideStack(6)
    const buried = {
      ...nodes,
      site_a: SiteNode.parse({
        id: 'site_a',
        children: ['building_a'],
        terrain: encodeTerrainField({
          ...createTerrainField({ cols: 33, rows: 33, spacing: 1, origin: [-16, -16] }),
          heights: new Int16Array(33 * 33).fill(600),
        }),
      }),
    } as typeof nodes
    expect(levelGradeStanding(buried, 'level_garden')).toBe('below-grade')
  })

  test('a flat site keeps the old answers: a basement is below grade, its ground floor is not', () => {
    const nodes = buildNodes([
      SiteNode.parse({ id: 'site_a', children: ['building_a'] }),
      BuildingNode.parse({
        id: 'building_a',
        parentId: 'site_a',
        children: ['level_b', 'level_g'],
      }),
      LevelNode.parse({
        id: 'level_b',
        level: -1,
        baseElevation: -3.63,
        height: 3.4,
        parentId: 'building_a',
        children: ['slab_b'],
      }),
      LevelNode.parse({
        id: 'level_g',
        level: 0,
        height: 3,
        parentId: 'building_a',
        children: ['slab_g'],
      }),
      SlabNode.parse({ id: 'slab_b', parentId: 'level_b', polygon: PLATE, elevation: 0.28 }),
      SlabNode.parse({ id: 'slab_g', parentId: 'level_g', polygon: PLATE, elevation: 0.28 }),
    ])
    expect(levelGradeStanding(nodes, 'level_b')).toBe('below-grade')
    expect(levelGradeStanding(nodes, 'level_g')).toBe('at-grade')
  })

  test('sculpted ground that never reaches a floor leaves it at grade', () => {
    const nodes = hillsideStack(0.4)
    // East ground 0.4 m over a 0.2 m plate: inside the 0.3 m tolerance.
    expect(levelGradeStanding(nodes, 'level_garden')).toBe('at-grade')
  })

  test('an id that is no level stands at grade', () => {
    const nodes = hillsideStack(6)
    expect(levelGradeStanding(nodes, 'level_missing')).toBe('at-grade')
    expect(levelGradeStanding(nodes, 'slab_level_garden')).toBe('at-grade')
  })

  test("the owner's hillside house (14 Oct): no floor is buried, the hill stands beside it", () => {
    // The agent flattened the ground under the house (0 m over every plate) and raised a 6 m
    // plateau on the street side just past the walls. Over their own footprints all four
    // floors stand at grade — what hides them from the street is ground between the eye and
    // the house, which is the eye-window's business, not this standing's.
    const nodes = hillside.nodes as unknown as Record<AnyNodeId, AnyNode>
    for (const name of [
      'Garden level · walk-out',
      'Living level · mid-slope',
      'Street level · garage & entry',
      'Attic · dormer bedroom',
    ]) {
      const level = Object.values(nodes).find((node) => node.type === 'level' && node.name === name)
      expect(level && levelGradeStanding(nodes, level.id)).toBe('at-grade')
    }
  })
})
