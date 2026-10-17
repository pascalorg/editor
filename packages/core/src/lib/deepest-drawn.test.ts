import { expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  LevelNode,
  SiteNode,
  SlabNode,
  WallNode,
} from '../schema'
import { deepestDrawnY, lowestGroundY } from './deepest-drawn'
import { FOUNDATION_STANDARD } from './foundation-standard'
import { FLAT_GROUND_Y } from './site-ground-height'
import { encodeTerrainField } from './terrain-codec'
import { createTerrainField } from './terrain-field'

const keyed = (nodes: AnyNode[]) =>
  Object.fromEntries(nodes.map((n) => [n.id, n])) as Record<AnyNodeId, AnyNode>

const corners: Array<[number, number]> = [
  [0, 0],
  [6, 0],
  [6, 6],
  [0, 6],
]

function site(terrain?: string) {
  return SiteNode.parse({ id: 'site_a', children: ['building_a'], ...(terrain ? { terrain } : {}) })
}

/** One level at grade with four walls on a 0.05 m slab, plus a basement when `basementY` is given. */
function house(basementY: number | null, terrain?: string) {
  const walls = (level: string) =>
    corners.map((start, i) =>
      WallNode.parse({
        id: `wall_${level}_${i}`,
        parentId: level,
        start,
        end: corners[(i + 1) % 4],
      }),
    )
  const slab = (level: string) =>
    SlabNode.parse({
      id: `slab_${level}`,
      parentId: level,
      polygon: corners,
      elevation: 0.05,
      thickness: 0.05,
    })
  const levels = ['level_g', ...(basementY === null ? [] : ['level_b'])]
  return keyed([
    site(terrain),
    BuildingNode.parse({ id: 'building_a', parentId: 'site_a', children: levels }),
    ...levels.flatMap((id) => {
      const own = walls(id)
      return [
        LevelNode.parse({
          id,
          parentId: 'building_a',
          level: id === 'level_g' ? 0 : -1,
          baseElevation: id === 'level_b' ? (basementY ?? 0) : 0,
          children: [...own.map((w) => w.id), `slab_${id}`],
        }),
        slab(id),
        ...own,
      ]
    }),
  ])
}

test('the lowest ground of a flat site is the flat plane', () => {
  expect(lowestGroundY(house(null))).toBe(FLAT_GROUND_Y)
})

test('the lowest ground of a sculpted site is the terrain its lowest sample', () => {
  const field = createTerrainField({ cols: 9, rows: 9, spacing: 1, origin: [-4, -4] })
  const heights = new Int16Array(field.heights).fill(250)
  heights[10] = -180
  expect(lowestGroundY(house(null, encodeTerrainField({ ...field, heights })))).toBeCloseTo(-1.8, 9)
})

test('over no floor the scene draws nothing deep', () => {
  expect(deepestDrawnY(keyed([site()]))).toBeNull()
})

test('a house at grade is deepest at a footing under its floor', () => {
  expect(deepestDrawnY(house(null))).toBeCloseTo(
    0.05 - 0.05 - FOUNDATION_STANDARD.footingThickness,
    9,
  )
})

test('a basement is deepest at the footing under its floor', () => {
  // The floor top is at -3.63 + 0.05 on a 0.05 m slab.
  expect(deepestDrawnY(house(-3.63))).toBeCloseTo(-3.63 - FOUNDATION_STANDARD.footingThickness, 9)
})
