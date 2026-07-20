import { describe, expect, test } from 'bun:test'
import { BuildingNode, LevelNode, SlabNode, type WallNode } from '../schema'
import type { AnyNode, AnyNodeId } from '../schema/types'
import { wallPlaneTopBoundaryRepro as reproFixture } from './__fixtures__/wall-plane-top-boundary-repro'
import { DEFAULT_LEVEL_HEIGHT } from './level-height'
import {
  CEILING_CLAMP_MARGIN,
  getCeilingClampBound,
  getCoveringSlabUndersideAt,
  getLevelAbove,
  getLevelBelow,
  getLevelElevations,
  getStoredLevelHeight,
  getWallPlaneTop,
} from './storey'

const buildNodes = (list: AnyNode[]): Record<AnyNodeId, AnyNode> =>
  Object.fromEntries(list.map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>

const level = (
  id: string,
  ordinal: number,
  opts: { height?: number; parentId?: string | null; children?: string[] } = {},
): LevelNode =>
  LevelNode.parse({
    id,
    level: ordinal,
    parentId: opts.parentId ?? null,
    children: opts.children ?? [],
    ...(opts.height === undefined ? {} : { height: opts.height }),
  })

const building = (id: string, children: string[]): BuildingNode =>
  BuildingNode.parse({ id, children })

const slabNode = (
  id: string,
  opts: {
    polygon?: Array<[number, number]>
    holes?: Array<Array<[number, number]>>
    elevation?: number
    thickness?: number
    recessed?: boolean
  },
): SlabNode =>
  SlabNode.parse({
    id,
    polygon:
      opts.polygon ??
      ([
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ] as Array<[number, number]>),
    holes: opts.holes ?? [],
    ...(opts.elevation === undefined ? {} : { elevation: opts.elevation }),
    ...(opts.thickness === undefined ? {} : { thickness: opts.thickness }),
    ...(opts.recessed === undefined ? {} : { recessed: opts.recessed }),
  })

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

describe('getLevelAbove', () => {
  test('returns the next-higher ordinal in the same building, skipping ordinal gaps', () => {
    const nodes = buildNodes([
      building('building_a', ['level_0', 'level_2', 'level_5']),
      level('level_0', 0, { parentId: 'building_a' }),
      level('level_5', 5, { parentId: 'building_a' }),
      level('level_2', 2, { parentId: 'building_a' }),
    ])

    expect(getLevelAbove('level_0', nodes)?.id).toBe('level_2')
    expect(getLevelAbove('level_2', nodes)?.id).toBe('level_5')
    expect(getLevelAbove('level_5', nodes)).toBeNull()
  })

  test('never crosses into another building', () => {
    const nodes = buildNodes([
      building('building_a', ['level_a0']),
      building('building_b', ['level_b0', 'level_b1']),
      level('level_a0', 0, { parentId: 'building_a' }),
      level('level_b0', 0, { parentId: 'building_b' }),
      level('level_b1', 1, { parentId: 'building_b' }),
    ])

    expect(getLevelAbove('level_a0', nodes)).toBeNull()
    expect(getLevelAbove('level_b0', nodes)?.id).toBe('level_b1')
  })

  test('orphan levels resolve within the shared legacy stack', () => {
    const nodes = buildNodes([
      level('level_orphan_0', 0, { height: 2.75 }),
      level('level_orphan_1', 1, { height: 3 }),
    ])

    expect(getLevelAbove('level_orphan_0', nodes)?.id).toBe('level_orphan_1')
    expect(getLevelAbove('level_orphan_1', nodes)).toBeNull()
  })

  test('returns null for an unknown level id', () => {
    const nodes = buildNodes([level('level_0', 0)])
    expect(getLevelAbove('level_missing', nodes)).toBeNull()
  })
})

describe('getLevelBelow', () => {
  test('returns the next-lower ordinal in the same building, skipping ordinal gaps', () => {
    const nodes = buildNodes([
      building('building_a', ['level_0', 'level_2', 'level_5']),
      level('level_0', 0, { parentId: 'building_a' }),
      level('level_5', 5, { parentId: 'building_a' }),
      level('level_2', 2, { parentId: 'building_a' }),
    ])

    expect(getLevelBelow('level_5', nodes)?.id).toBe('level_2')
    expect(getLevelBelow('level_2', nodes)?.id).toBe('level_0')
    expect(getLevelBelow('level_0', nodes)).toBeNull()
  })

  test('never crosses into another building', () => {
    const nodes = buildNodes([
      building('building_a', ['level_a0']),
      building('building_b', ['level_b0', 'level_b1']),
      level('level_a0', 0, { parentId: 'building_a' }),
      level('level_b0', 0, { parentId: 'building_b' }),
      level('level_b1', 1, { parentId: 'building_b' }),
    ])

    expect(getLevelBelow('level_a0', nodes)).toBeNull()
    expect(getLevelBelow('level_b1', nodes)?.id).toBe('level_b0')
  })

  test('returns null for an unknown level id', () => {
    const nodes = buildNodes([level('level_0', 0)])
    expect(getLevelBelow('level_missing', nodes)).toBeNull()
  })
})

// Two stacked levels in one building; `slabs` become children of the level
// above the queried one.
const stackedNodes = (slabs: SlabNode[], queriedHeight = 2.5) =>
  buildNodes([
    building('building_a', ['level_0', 'level_1']),
    level('level_0', 0, { height: queriedHeight, parentId: 'building_a' }),
    level('level_1', 1, {
      height: 2.5,
      parentId: 'building_a',
      children: slabs.map((node) => node.id),
    }),
    ...slabs,
  ])

describe('getCoveringSlabUndersideAt', () => {
  test('expresses a flush deck underside in the queried level local Y', () => {
    // Flush deck occupying [-0.3, 0] above the plane: underside sits at
    // storeyHeight + (0 - 0.3) = 2.2 over the queried level's floor.
    const nodes = stackedNodes([slabNode('slab_deck', { elevation: 0, thickness: 0.3 })])
    expect(getCoveringSlabUndersideAt('level_0', nodes, 2, 2)).toBeCloseTo(2.2)
  })

  test('returns null outside the slab polygon', () => {
    const nodes = stackedNodes([slabNode('slab_deck', { elevation: 0, thickness: 0.3 })])
    expect(getCoveringSlabUndersideAt('level_0', nodes, 10, 10)).toBeNull()
  })

  test('a hole in the slab vetoes coverage', () => {
    const nodes = stackedNodes([
      slabNode('slab_deck', {
        elevation: 0,
        thickness: 0.3,
        holes: [
          [
            [1, 1],
            [3, 1],
            [3, 3],
            [1, 3],
          ],
        ],
      }),
    ])
    expect(getCoveringSlabUndersideAt('level_0', nodes, 2, 2)).toBeNull()
    expect(getCoveringSlabUndersideAt('level_0', nodes, 0.5, 0.5)).toBeCloseTo(2.2)
  })

  test('recessed pools never cover', () => {
    const nodes = stackedNodes([
      slabNode('slab_pool', { elevation: -1, thickness: 0.3, recessed: true }),
    ])
    expect(getCoveringSlabUndersideAt('level_0', nodes, 2, 2)).toBeNull()
  })

  test('the lowest underside wins among overlapping covering slabs', () => {
    const nodes = stackedNodes([
      // Default floor slab occupying [0, 0.05]: underside at the plane (2.5).
      slabNode('slab_floor', {}),
      slabNode('slab_deck', { elevation: 0, thickness: 0.3 }),
    ])
    expect(getCoveringSlabUndersideAt('level_0', nodes, 2, 2)).toBeCloseTo(2.2)
  })

  test('returns null when there is no level above', () => {
    const nodes = stackedNodes([slabNode('slab_deck', { elevation: 0, thickness: 0.3 })])
    expect(getCoveringSlabUndersideAt('level_1', nodes, 2, 2)).toBeNull()
  })
})

describe('getWallPlaneTop', () => {
  const wallAt = (
    start: [number, number],
    end: [number, number],
  ): { start: [number, number]; end: [number, number] } => ({ start, end })

  test('no covering slab → the stored level height', () => {
    const nodes = stackedNodes([], 3)
    expect(getWallPlaneTop(wallAt([0.5, 2], [3.5, 2]), 'level_0', nodes)).toBe(3)
  })

  test('a flush thick deck above clamps the plane to its underside', () => {
    const nodes = stackedNodes([slabNode('slab_deck', { elevation: 0, thickness: 0.3 })])
    expect(getWallPlaneTop(wallAt([0.5, 2], [3.5, 2]), 'level_0', nodes)).toBeCloseTo(2.2)
  })

  test('a slab covering only part of the span clamps via the min of the samples', () => {
    // Deck over x ∈ [3.5, 6]: start (0,2) and chord midpoint (2,2) miss it,
    // only the end sample (4,2) lands inside — the min still clamps.
    const nodes = stackedNodes([
      slabNode('slab_deck', {
        polygon: [
          [3.5, 0],
          [6, 0],
          [6, 4],
          [3.5, 4],
        ],
        elevation: 0,
        thickness: 0.3,
      }),
    ])
    expect(getWallPlaneTop(wallAt([0, 2], [4, 2]), 'level_0', nodes)).toBeCloseTo(2.2)
  })

  test('a recessed slab above is ignored', () => {
    const nodes = stackedNodes([
      slabNode('slab_pool', { elevation: -1, thickness: 0.3, recessed: true }),
    ])
    expect(getWallPlaneTop(wallAt([0.5, 2], [3.5, 2]), 'level_0', nodes)).toBe(2.5)
  })

  test('falls back to the default height when the level does not resolve', () => {
    const nodes = stackedNodes([])
    expect(getWallPlaneTop(wallAt([0.5, 2], [3.5, 2]), 'level_missing', nodes)).toBe(
      DEFAULT_LEVEL_HEIGHT,
    )
  })

  test('repro project: both boundary walls clamp to the covering slab underside', () => {
    // Real scene subset (project_O1z9NLOylyb5kFX4): the level-1 auto slab's
    // polygon derives from the level-0 wall CENTERLINES, so every perimeter
    // wall's samples sit exactly ON the polygon boundary. Wall 2 (min-x edge)
    // clamped while Wall 1 (max-z edge) ran full height — ray-cast
    // pointInPolygon includes min-side boundaries and excludes max-side ones.
    const nodes = reproFixture as unknown as Record<AnyNodeId, AnyNode>
    const levelId = 'level_pomuk0sbwec15mf3'
    const wall1 = nodes['wall_39bnnq29h824ryy0' as AnyNodeId] as WallNode
    const wall2 = nodes['wall_on4rj410n69n3rzf' as AnyNodeId] as WallNode
    // storeyHeight 2.7 + (slab elevation 0.19757… - thickness 0.5)
    const underside = 2.7 + (0.19757210573188194 - 0.5)
    expect(getWallPlaneTop(wall1, levelId, nodes)).toBeCloseTo(underside)
    expect(getWallPlaneTop(wall2, levelId, nodes)).toBeCloseTo(underside)
  })

  test('all four rectangle walls under a same-footprint covering slab clamp', () => {
    // The repro shape distilled: wall centerlines lie exactly on the covering
    // slab's polygon edges. Every orientation must clamp identically.
    const nodes = stackedNodes([slabNode('slab_deck', { elevation: 0, thickness: 0.3 })])
    const walls: Array<[[number, number], [number, number]]> = [
      [
        [0, 0],
        [4, 0],
      ],
      [
        [4, 0],
        [4, 4],
      ],
      [
        [4, 4],
        [0, 4],
      ],
      [
        [0, 4],
        [0, 0],
      ],
    ]
    for (const [start, end] of walls) {
      expect(getWallPlaneTop(wallAt(start, end), 'level_0', nodes)).toBeCloseTo(2.2)
    }
  })

  test('a diagonal wall under the covering slab clamps', () => {
    const nodes = stackedNodes([slabNode('slab_deck', { elevation: 0, thickness: 0.3 })])
    expect(getWallPlaneTop(wallAt([0.5, 0.5], [3.5, 3.5]), 'level_0', nodes)).toBeCloseTo(2.2)
  })

  test('a wall fully outside the covering slab keeps the storey height', () => {
    const nodes = stackedNodes([slabNode('slab_deck', { elevation: 0, thickness: 0.3 })])
    expect(getWallPlaneTop(wallAt([6, 0], [6, 4]), 'level_0', nodes)).toBe(2.5)
  })

  test('a wall partially overlapping the covering slab clamps', () => {
    const nodes = stackedNodes([slabNode('slab_deck', { elevation: 0, thickness: 0.3 })])
    expect(getWallPlaneTop(wallAt([2, 2], [8, 2]), 'level_0', nodes)).toBeCloseTo(2.2)
  })
})

describe('getCeilingClampBound', () => {
  const ceilingPolygon: Array<[number, number]> = [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ]

  test('with no covering slab the bound is the storey plane minus the margin', () => {
    const nodes = stackedNodes([])
    expect(getCeilingClampBound('level_0', nodes, ceilingPolygon)).toBeCloseTo(
      2.5 - CEILING_CLAMP_MARGIN,
    )
  })

  test('a covering deck lowers the bound to its underside minus the margin', () => {
    const nodes = stackedNodes([slabNode('slab_deck', { elevation: 0, thickness: 0.3 })])
    expect(getCeilingClampBound('level_0', nodes, ceilingPolygon)).toBeCloseTo(
      2.2 - CEILING_CLAMP_MARGIN,
    )
  })

  test('a slab covering only the interior is caught by the centroid sample', () => {
    // Deck hovers over the middle of the ceiling — every vertex sample
    // misses, only the centroid (2, 2) lands inside it.
    const nodes = stackedNodes([
      slabNode('slab_deck', {
        polygon: [
          [1.5, 1.5],
          [2.5, 1.5],
          [2.5, 2.5],
          [1.5, 2.5],
        ],
        elevation: 0,
        thickness: 0.3,
      }),
    ])
    expect(getCeilingClampBound('level_0', nodes, ceilingPolygon)).toBeCloseTo(
      2.2 - CEILING_CLAMP_MARGIN,
    )
  })

  test('returns Infinity for an unresolvable level', () => {
    const nodes = stackedNodes([])
    expect(getCeilingClampBound('level_missing', nodes, ceilingPolygon)).toBe(
      Number.POSITIVE_INFINITY,
    )
  })

  test('vertices on the covering slab boundary clamp identically on every side', () => {
    // Two mirrored strips share an edge with the 4x4 deck: one along its
    // min-z edge, one along its max-z edge. Their interiors and centroids sit
    // outside the deck, so only the shared-edge vertices can register —
    // ray-cast pointInPolygon used to admit the min-side vertices and reject
    // the max-side ones, giving orientation-dependent clamps.
    const nodes = stackedNodes([slabNode('slab_deck', { elevation: 0, thickness: 0.3 })])
    const minSideStrip: Array<[number, number]> = [
      [0, -1],
      [4, -1],
      [4, 0],
      [0, 0],
    ]
    const maxSideStrip: Array<[number, number]> = [
      [0, 4],
      [4, 4],
      [4, 5],
      [0, 5],
    ]
    expect(getCeilingClampBound('level_0', nodes, minSideStrip)).toBeCloseTo(
      2.2 - CEILING_CLAMP_MARGIN,
    )
    expect(getCeilingClampBound('level_0', nodes, maxSideStrip)).toBeCloseTo(
      2.2 - CEILING_CLAMP_MARGIN,
    )
  })
})
