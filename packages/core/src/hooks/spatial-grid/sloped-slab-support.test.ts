import { describe, expect, test } from 'bun:test'
import { authorScene } from '../../agent-operations/author-scene'
import { authorScenePayload } from '../../agent-tools/author-scene'
import { getRenderableSlabPolygon } from '../../lib/slab-polygon'
import {
  BuildingNode,
  FenceNode,
  ItemNode,
  LevelNode,
  SiteNode,
  SlabNode,
  StairNode,
  StairSegmentNode,
  WallNode,
} from '../../schema'
import { levelFloors } from '../../spatial/usage-field/floors'
import { floorUnder, type SupportCache } from '../../spatial/usage-field/support'
import { clampSlabElevationForWalls, computeWallSlabSupport } from '../../systems/slab/slab-support'
import { stairBaseElevation } from '../../systems/stair/stair-base-elevation'
import { resolveStairTotalRise } from '../../systems/stair/stair-rise-query'
import { SpatialGridManager, spatialGridManager } from './spatial-grid-manager'
import { countBulkSlabChanges, markSlabChangeDependents } from './spatial-grid-sync'
import { resolveFenceConstructionSupport } from './support-host-patch'

const RAMP_POLYGON: Array<[number, number]> = [
  [0, 0],
  [4, 0],
  [4, 2],
  [0, 2],
]

function makeRamp(overrides: Partial<SlabNode> = {}) {
  return SlabNode.parse({
    id: 'slab_ramp',
    parentId: 'level_0',
    polygon: RAMP_POLYGON,
    elevation: 0.1,
    thickness: 0.15,
    slope: { direction: 0, pitch: 45 }, // grade = 1.0 → y(x, z) = 0.1 + x
    ...overrides,
  })
}

function makeItem(id: string, x: number, z: number, supportSlabId?: string) {
  return ItemNode.parse({
    id,
    parentId: 'level_0',
    position: [x, 0, z],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    ...(supportSlabId ? { supportSlabId } : {}),
    asset: {
      id: 'chair',
      category: 'furniture',
      name: 'Chair',
      thumbnail: '/thumb.png',
      src: '/chair.glb',
      dimensions: [0.5, 0.8, 0.5],
      attachTo: undefined,
    },
  })
}

describe('sloped slab support, raycasting, dirtying, usage-field & authoring', () => {
  test('lifts items, hosts, and candidates to the exact sloped surface height at their XZ position', () => {
    const ramp = makeRamp()
    const mgr = new SpatialGridManager()
    mgr.handleNodeCreated(ramp, 'level_0')

    expect(mgr.getSlabElevationAt('level_0', 0.5, 1)).toBeCloseTo(0.6, 6)
    expect(mgr.getSlabElevationAt('level_0', 2.0, 1)).toBeCloseTo(2.1, 6)
    expect(mgr.getSlabElevationAt('level_0', 3.5, 1)).toBeCloseTo(3.6, 6)

    const lowSupport = mgr.getSlabSupportForItem('level_0', [0.5, 0, 1], [0.5, 0.8, 0.5], [0, 0, 0])
    const highSupport = mgr.getSlabSupportForItem(
      'level_0',
      [3.5, 0, 1],
      [0.5, 0.8, 0.5],
      [0, 0, 0],
    )
    expect(lowSupport.slabId).toBe(ramp.id)
    expect(lowSupport.elevation).toBeCloseTo(0.6, 6)
    expect(highSupport.slabId).toBe(ramp.id)
    expect(highSupport.elevation).toBeCloseTo(3.6, 6)

    expect(
      mgr.getHostSlabElevationForFootprint(
        'level_0',
        ramp.id,
        [2.5, 0, 1],
        [0.5, 0.8, 0.5],
        [0, 0, 0],
      ),
    ).toBeCloseTo(2.6, 6)
    expect(
      mgr.getSupportCandidatesForFootprint('level_0', [1.5, 0, 1], [0.5, 0.8, 0.5], [0, 0, 0]),
    ).toEqual([{ slabId: ramp.id, elevation: expect.closeTo(1.6, 6) }])
  })

  test('getPointedSupportSurface intersects oblique and horizontal rays with the sloped plane', () => {
    const ramp = makeRamp()
    const mgr = new SpatialGridManager()
    mgr.handleNodeCreated(ramp, 'level_0')

    // Straight downward ray at x = 2.5, z = 1 hits y = 2.6
    const down = mgr.getPointedSupportSurface('level_0', [2.5, 6, 1], [0, -1, 0])
    expect(down.slabId).toBe(ramp.id)
    expect(down.elevation).toBeCloseTo(2.6, 6)
    expect(down.point?.[0]).toBeCloseTo(2.5, 6)
    expect(down.point?.[1]).toBeCloseTo(1, 6)

    // Horizontal ray at y = 2.1 heading +X from x = -1 hits the inclined ramp at x = 2.0
    const horiz = mgr.getPointedSupportSurface('level_0', [-1, 2.1, 1], [1, 0, 0])
    expect(horiz.slabId).toBe(ramp.id)
    expect(horiz.elevation).toBeCloseTo(2.1, 6)
    expect(horiz.point?.[0]).toBeCloseTo(2.0, 6)
  })

  test('slope edits mark overlapping dependents dirty and count as bulk slab changes', () => {
    const flat = makeRamp({ slope: undefined })
    const sloped = makeRamp({ slope: { direction: 0, pitch: 12 } })
    const wall = WallNode.parse({
      id: 'wall_on_ramp',
      parentId: 'level_0',
      start: [1, 1],
      end: [3, 1],
      height: 2.5,
    })
    const nodes = {
      level_0: LevelNode.parse({ id: 'level_0', level: 0, children: [sloped.id, wall.id] }),
      [sloped.id]: sloped,
      [wall.id]: wall,
    }
    const prevNodes = { ...nodes, [flat.id]: flat }

    const dirty = new Set<string>()
    markSlabChangeDependents(flat, sloped, nodes, (id) => dirty.add(id), prevNodes)
    expect(dirty.has(wall.id)).toBe(true)
    expect(countBulkSlabChanges(nodes, prevNodes)).toBe(1)
  })

  test('clampSlabElevationForWalls accounts for the high end of a sloped slab', () => {
    const ramp = makeRamp({ slope: { direction: 0, pitch: 15 } }) // span 4 m → rise ~1.072 m
    const wall = WallNode.parse({
      id: 'wall_edge',
      parentId: 'level_0',
      start: [0, 0],
      end: [4, 0],
      height: 2.5,
    })
    const result = clampSlabElevationForWalls(2.0, ramp, [wall], [ramp], 2.5)
    expect(result.clamped).toBe(true)
    expect(result.elevation + 4 * Math.tan((15 * Math.PI) / 180)).toBeLessThanOrEqual(2.5)
  })

  test('usage-field resolves sloped height under items and marks sloped floor regions approximate', () => {
    const ramp = makeRamp()
    const item = makeItem('item_chair', 3, 1, ramp.id)
    const level = LevelNode.parse({
      id: 'level_0',
      parentId: 'building_0',
      level: 0,
      children: [ramp.id, item.id],
    })
    const building = BuildingNode.parse({ id: 'building_0', children: [level.id] })
    const nodes = {
      [building.id]: building,
      [level.id]: level,
      [ramp.id]: ramp,
      [item.id]: item,
    }
    const cache: SupportCache = new Map()
    const y = floorUnder(
      item,
      { position: item.position, dimensions: item.asset.dimensions, rotation: item.rotation },
      nodes,
      level.id,
      cache,
    )
    expect(y).toBeCloseTo(3.1, 6)

    const { floors } = levelFloors(nodes)
    const regions = floors.get(level.id) ?? []
    expect(regions.some((r) => r.nodeId === ramp.id && r.shape === 'approx')).toBe(true)
  })

  test('authorScene persists slope on authored slabs', () => {
    const payload = authorScenePayload.parse({
      levels: [
        {
          name: 'Ground',
          slabs: [
            {
              name: 'Entry Ramp',
              polygon: RAMP_POLYGON,
              top: 0.05,
              thickness: 0.15,
              slope: { direction: 90, pitch: 4.8 },
            },
          ],
        },
      ],
    })
    const building = BuildingNode.parse({ id: 'building_0', parentId: 'site_0', children: [] })
    const site = SiteNode.parse({ id: 'site_0', children: [building.id] })
    const outcome = authorScene(
      { [site.id]: site, [building.id]: building },
      { payload },
      { activeLevelId: null },
    )
    const slabId = outcome.result.ids['slab/0/0']!
    const created = outcome.changes.create?.find((entry) => entry.node.id === slabId)?.node
    expect(created?.type).toBe('slab')
    expect((created as SlabNode).slope).toEqual({ direction: 90, pitch: 4.8 })
  })

  test('grounded sloped slabs keep their authored polygon instead of expanding into adjacent walls', () => {
    const groundedRamp = SlabNode.parse({
      id: 'slab_grounded_ramp',
      parentId: 'level_0',
      polygon: RAMP_POLYGON,
      elevation: 0.05,
      thickness: 0.05,
      slope: { direction: 0, pitch: 10 },
    })
    const adjacentWall = WallNode.parse({
      id: 'wall_edge',
      parentId: 'level_0',
      start: [0, 0],
      end: [0, 2],
      thickness: 0.2,
    })
    const rendered = getRenderableSlabPolygon(groundedRamp, {
      walls: [adjacentWall],
      siblingSlabs: [],
    })
    expect(rendered).toEqual(RAMP_POLYGON)
  })

  test('walls along a sloped slab receive sloped baseSegments and faceDatum matching the ramp plane', () => {
    const ramp = makeRamp({
      elevation: 0.1,
      slope: { direction: 0, pitch: 15 }, // grade = tan(15°) ≈ 0.26795
    })
    const uphillWall = WallNode.parse({
      id: 'wall_uphill',
      parentId: 'level_0',
      start: [0.5, 1],
      end: [3.5, 1],
    })
    const crossWall = WallNode.parse({
      id: 'wall_high_end',
      parentId: 'level_0',
      start: [3.5, 0.2],
      end: [3.5, 1.8],
    })

    const uphillSupport = computeWallSlabSupport(uphillWall, [ramp], [uphillWall])
    expect(uphillSupport.electedSlabId).toBe(ramp.id)
    expect(uphillSupport.baseSegments.length).toBe(1)
    const seg = uphillSupport.baseSegments[0]!
    const grade = Math.tan((15 * Math.PI) / 180)
    expect(seg.elevation).toBeCloseTo(0.1 + 0.5 * grade, 4)
    expect(seg.endElevation).toBeCloseTo(0.1 + 3.5 * grade, 4)
    expect(uphillSupport.baseElevation).toBeCloseTo(0.1 + 0.5 * grade, 4)
    expect(uphillSupport.elevation).toBeCloseTo(0.1 + 3.5 * grade, 4)

    const crossSupport = computeWallSlabSupport(crossWall, [ramp], [crossWall])
    expect(crossSupport.electedSlabId).toBe(ramp.id)
    // Cross-wall thickness is 0.1m (faces at x = 3.45 and 3.55); base takes the lower downhill face
    // so the wall never floats above the ramp, while faceDatum tracks each face independently.
    expect(crossSupport.baseSegments[0]!.elevation).toBeCloseTo(0.1 + 3.45 * grade, 4)
    expect(crossSupport.baseSegments[0]!.endElevation).toBeUndefined()
    expect(crossSupport.faceDatum.a[0]!.elevation).toBeCloseTo(0.1 + 3.45 * grade, 4)
    expect(crossSupport.faceDatum.b[0]!.elevation).toBeCloseTo(0.1 + 3.55 * grade, 4)
  })

  test('steep sloped slab with rise > storeyHeight still clamps when overlapping a plane-bound wall and sibling slab', () => {
    const steepRamp = makeRamp({
      elevation: 0.2,
      slope: { direction: 0, pitch: 45 }, // rise = 4.0m > 2.5m storey height
    })
    const flatFloor = SlabNode.parse({
      id: 'slab_flat_sibling',
      parentId: 'level_0',
      polygon: [
        [-2, -2],
        [6, -2],
        [6, 4],
        [-2, 4],
      ],
      elevation: 0.05,
      thickness: 0.05,
    })
    const wall = WallNode.parse({
      id: 'wall_plane_bound',
      parentId: 'level_0',
      start: [1, 1],
      end: [3, 1],
    })
    const clamped = clampSlabElevationForWalls(0.2, steepRamp, [wall], [flatFloor, steepRamp], 2.5)
    expect(clamped.clamped).toBe(true)
    // Wall spans x = [1, 3], so the ramp reaches elevation + 3.0 along the wall.
    expect(clamped.elevation + 3).toBeLessThanOrEqual(2.5)
  })

  test('stairs on sloped slabs sample point elevation for both base and deck landing rise', () => {
    const ramp = makeRamp({
      elevation: 0.1,
      slope: { direction: 0, pitch: 45 }, // y(x, z) = 0.1 + x
    })
    const deck = SlabNode.parse({
      id: 'slab_upper_deck',
      parentId: 'level_0',
      polygon: [
        [2, 0],
        [6, 0],
        [6, 2],
        [2, 2],
      ],
      elevation: 2.0,
      thickness: 0.1,
      slope: { direction: 0, pitch: 45 }, // y(x, z) = 2.0 + (x - 2)
    })
    const level = LevelNode.parse({
      id: 'level_0',
      children: [ramp.id, deck.id, 'stair_0'],
    })
    const seg = StairSegmentNode.parse({
      id: 'sseg_0',
      parentId: 'stair_0',
      length: 1,
      width: 1,
      stepCount: 5,
    })
    const stair = StairNode.parse({
      id: 'stair_0',
      parentId: level.id,
      position: [2.5, 0, 0.5],
      supportSlabId: ramp.id,
      deckSlabId: deck.id,
      children: [seg.id],
    })
    const nodes = {
      [level.id]: level,
      [ramp.id]: ramp,
      [deck.id]: deck,
      [stair.id]: stair,
      [seg.id]: seg,
    }
    // Base sits at x = 2.5 on ramp (0.1 + 2.5 = 2.6)
    expect(stairBaseElevation(stair, nodes, level.id)).toBeCloseTo(2.6, 4)
    // Landing centroid is at x = 2.5 on deck (2.0 + 0.5 = 2.5) — wait, elevate deck so rise > 0
    const higherDeck = { ...deck, elevation: 5.0 }
    const rise = resolveStairTotalRise(stair, { ...nodes, [deck.id]: higherDeck })
    // Deck at x = 2.5 sits at 5.0 + 0.5 = 5.5; rise = 5.5 - 2.6 = 2.9 (not flat 5.0 - 2.6 = 2.4)
    expect(rise).toBeCloseTo(2.9, 2)
  })

  test('resolveFenceConstructionSupport computes supportOffset against sloped slab surface at fence start', () => {
    const ramp = makeRamp({
      elevation: 0.1,
      slope: { direction: 0, pitch: 45 }, // y(2, 1) = 2.1
    })
    const level = LevelNode.parse({ id: 'level_0', children: [ramp.id] })
    const fence = FenceNode.parse({
      id: 'fence_ramp',
      parentId: level.id,
      start: [2, 1],
      end: [3, 1],
    })
    const nodes = { [level.id]: level, [ramp.id]: ramp }
    spatialGridManager.clearLevel(level.id)
    spatialGridManager.handleNodeCreated(ramp, level.id)
    try {
      const patched = resolveFenceConstructionSupport(fence, level.id, nodes, {
        constructionElevation: 2.1,
        preferredSupportSlabId: ramp.id,
      })
      expect(patched.supportSlabId).toBe(ramp.id)
      expect(patched.supportOffset).toBeUndefined()
    } finally {
      spatialGridManager.clearLevel(level.id)
    }
  })

  test('authorScene flags slab_over_wall when a sloped slab high end exceeds half the wall height', () => {
    const payload = authorScenePayload.parse({
      levels: [
        {
          name: 'Ground',
          walls: [{ id: 'w1', start: [0, 1], end: [4, 1], height: 2.4, thickness: 0.15 }],
          slabs: [
            {
              name: 'Steep Ramp',
              polygon: RAMP_POLYGON,
              top: 0.1,
              thickness: 0.15,
              slope: { direction: 0, pitch: 30 }, // rise ≈ 2.31m → maxTop ≈ 2.41m > 1.2m
            },
          ],
        },
      ],
    })
    const building = BuildingNode.parse({ id: 'building_0', parentId: 'site_0', children: [] })
    const site = SiteNode.parse({ id: 'site_0', children: [building.id] })
    const outcome = authorScene(
      { [site.id]: site, [building.id]: building },
      { payload },
      { activeLevelId: null },
    )
    expect(outcome.result.defects.some((d) => d.code === 'slab_over_wall')).toBe(true)
  })

  test('pointer cap keeps a sloped host slab when cursor grabs downhill within the item footprint', () => {
    const ramp = makeRamp({
      elevation: 0.1,
      slope: { direction: 0, pitch: 20 }, // grade ≈ 0.364
    })
    const mgr = new SpatialGridManager()
    mgr.handleNodeCreated(ramp, 'level_0')
    const grade = Math.tan((20 * Math.PI) / 180)
    // Item 1.2m wide centered at x = 2.0 (origin elevation = 0.1 + 2.0*grade ≈ 0.828)
    // Downhill footprint corner sits at x = 1.4 (elevation ≈ 0.610).
    // Cursor hit slightly downhill at x = 1.6 gives maxElevation = 0.1 + 1.6*grade ≈ 0.682.
    const cursorCap = 0.1 + 1.6 * grade
    const support = mgr.getSlabSupportForItem(
      'level_0',
      [2.0, 0, 1.0],
      [1.2, 0.8, 0.8],
      [0, 0, 0],
      cursorCap,
    )
    expect(support.slabId).toBe(ramp.id)
    expect(support.elevation).toBeCloseTo(0.1 + 2.0 * grade, 4)

    // Meanwhile, aiming at the ground floor (maxElevation = 0.05) below a raised ramp still rejects the ramp
    const raisedRamp = makeRamp({
      id: 'slab_overhead_ramp',
      elevation: 2.0,
      slope: { direction: 0, pitch: 15 },
    })
    const mgr2 = new SpatialGridManager()
    mgr2.handleNodeCreated(raisedRamp, 'level_0')
    const belowCap = mgr2.getSlabSupportForItem(
      'level_0',
      [2.0, 0, 1.0],
      [1.2, 0.8, 0.8],
      [0, 0, 0],
      0.05,
    )
    expect(belowCap.slabId).toBeNull()
  })

  test('wall clamp subtracts only the rise along overlapping plane-bound walls, not full-ramp rise', () => {
    // 10m ramp rising 15° (full rise ≈ 2.68m > storeyHeight 2.5m)
    const longRamp = SlabNode.parse({
      id: 'slab_long_ramp',
      parentId: 'level_0',
      polygon: [
        [0, 0],
        [10, 0],
        [10, 2],
        [0, 2],
      ],
      elevation: 0.2,
      thickness: 0.1,
      slope: { direction: 0, pitch: 15 },
    })
    // Plane-bound wall ONLY along the low edge (x = 0)
    const lowEndWall = WallNode.parse({
      id: 'wall_low_end',
      parentId: 'level_0',
      start: [0, 0.2],
      end: [0, 1.8],
      thickness: 0.1,
    })
    const clamped = clampSlabElevationForWalls(0.5, longRamp, [lowEndWall], [longRamp], 2.5)
    // At x = 0, wall sees nearly 0 rise, so elevation 0.5 is well below 2.5 - MIN_WALL_HEIGHT and stays unclamped.
    expect(clamped.clamped).toBe(false)
    expect(clamped.elevation).toBeCloseTo(0.5, 4)
  })
})
