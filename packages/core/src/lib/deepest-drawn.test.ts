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

/** A basement (-1, plane at -3.63) whose floor has two slabs on different elevations. */
function splitBasement(
  slabs: Array<{
    elevation: number
    thickness: number
    recessed?: boolean
    metadata?: Record<string, unknown>
  }>,
) {
  const level = LevelNode.parse({
    id: 'level_b',
    parentId: 'building_a',
    level: -1,
    baseElevation: -3.63,
    children: slabs.map((_, i) => `slab_${i}`),
  })
  return keyed([
    site(),
    BuildingNode.parse({ id: 'building_a', parentId: 'site_a', children: ['level_b'] }),
    level,
    ...slabs.map((slab, i) =>
      SlabNode.parse({ id: `slab_${i}`, parentId: 'level_b', polygon: corners, ...slab }),
    ),
  ])
}

test('a split-level floor is deepest at its lowest slab underside, not the highest top less the thickest slab', () => {
  // Raised part: top 0.05, 0.05 thick. Sunken part: top -1.2, 0.2 thick, underside at -1.4.
  const nodes = splitBasement([
    { elevation: 0.05, thickness: 0.05 },
    { elevation: -1.2, thickness: 0.2 },
  ])
  expect(deepestDrawnY(nodes)).toBeCloseTo(-3.63 - 1.4 - FOUNDATION_STANDARD.footingThickness, 9)
})

test('a recessed slab counts where it is drawn: by its own underside, with no footing under it', () => {
  // A pool basin: floor at -1.5, 0.3 thick, under a 0.05 m standing slab.
  const nodes = splitBasement([
    { elevation: 0.05, thickness: 0.05 },
    { elevation: -1.5, thickness: 0.3, recessed: true },
  ])
  expect(deepestDrawnY(nodes)).toBeCloseTo(-3.63 - 1.8, 9)
})

test('a thick recessed slab that stays shallow does not deepen the standing plate’s footing', () => {
  // A raised recessed plate (top 0.45, 0.5 thick: underside -0.05) beside a thin standing plate:
  // the footing under the standing plate is the deeper thing, not a thickest-slab guess.
  const nodes = splitBasement([
    { elevation: 0.05, thickness: 0.05 },
    { elevation: 0.45, thickness: 0.5, recessed: true },
  ])
  expect(deepestDrawnY(nodes)).toBeCloseTo(-3.63 - FOUNDATION_STANDARD.footingThickness, 9)
})

test('site flatwork is not a floor: a driveway laid deeper than the house’s slab does not take the dive depth down', () => {
  // The house on its 0.05 m plate; a driveway on the same level, top -0.3, 0.3 thick (underside -0.6).
  const nodes = splitBasement([
    { elevation: 0.05, thickness: 0.05 },
    { elevation: -0.3, thickness: 0.3, metadata: { flatwork: 'driveway' } },
  ])
  expect(deepestDrawnY(nodes)).toBeCloseTo(-3.63 - FOUNDATION_STANDARD.footingThickness, 9)
})
