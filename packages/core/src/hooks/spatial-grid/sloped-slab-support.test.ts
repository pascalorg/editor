import { describe, expect, test } from 'bun:test'
import { authorScene } from '../../agent-operations/author-scene'
import { authorScenePayload } from '../../agent-tools/author-scene'
import { BuildingNode, ItemNode, LevelNode, SiteNode, SlabNode, WallNode } from '../../schema'
import { levelFloors } from '../../spatial/usage-field/floors'
import { floorUnder, type SupportCache } from '../../spatial/usage-field/support'
import { clampSlabElevationForWalls } from '../../systems/slab/slab-support'
import { SpatialGridManager } from './spatial-grid-manager'
import { countBulkSlabChanges, markSlabChangeDependents } from './spatial-grid-sync'

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
})
