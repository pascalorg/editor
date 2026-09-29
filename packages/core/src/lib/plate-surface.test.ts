import { describe, expect, test } from 'bun:test'
import { SlabNode, WallNode, ZoneNode } from '../schema'
import {
  classifyPlateSideAt,
  clearPlateSurfaceCaches,
  computePlateSurfacePartition,
  type PlateLevelContext,
  parseRoomFinishRole,
  plateFinishKey,
  roomFinishRole,
} from './plate-surface'
import { area, containsPoint, intersection, union } from './polygon-boolean'

const WOOD = 'library:wood-woodplank48'
const TILE = 'library:flooring-tiles3'
const TERRAZZO = 'library:flooring-terrazzo19'

function wall(id: string, start: [number, number], end: [number, number]) {
  return WallNode.parse({ id, parentId: 'level_1', start, end, thickness: 0.2, height: 2.5 })
}

function zone(id: string, polygon: Array<[number, number]>, floor?: ZoneNode['floor']) {
  return ZoneNode.parse({
    id,
    parentId: 'level_1',
    name: id,
    polygon,
    spaceRole: 'room',
    ...(floor ? { floor } : {}),
  })
}

/**
 * Two 4 × 4 rooms sharing a 0.2 m divider, one with a finish region, plus a
 * manual slab sitting on the right-hand room's floor.
 *
 *   wall centrelines: outer rectangle (0,0)–(8.2,4.2), divider at x = 4.1
 *   clear polygons:   A = x 0.1…4.0,  B = x 4.2…8.1,  both z 0.1…4.1
 */
function twoRoomLevel() {
  const walls = [
    wall('wall_n', [0, 0], [8.2, 0]),
    wall('wall_e', [8.2, 0], [8.2, 4.2]),
    wall('wall_s', [8.2, 4.2], [0, 4.2]),
    wall('wall_w', [0, 4.2], [0, 0]),
    wall('wall_mid', [4.1, 0], [4.1, 4.2]),
  ]
  const zones = [
    zone(
      'zone_a',
      [
        [0, 0],
        [4.1, 0],
        [4.1, 4.2],
        [0, 4.2],
      ],
      {
        finish: WOOD,
        regions: [
          {
            id: 'region_1',
            finish: TERRAZZO,
            polygon: [
              [0.5, 0.5],
              [2, 0.5],
              [2, 2],
              [0.5, 2],
            ],
          },
        ],
      },
    ),
    zone(
      'zone_b',
      [
        [4.1, 0],
        [8.2, 0],
        [8.2, 4.2],
        [4.1, 4.2],
      ],
      { finish: TILE },
    ),
  ]
  const plate = SlabNode.parse({
    id: 'slab_plate',
    parentId: 'level_1',
    boundary: 'auto',
    autoFromWalls: true,
    zoneIds: ['zone_a', 'zone_b'],
    elevation: 0.05,
    thickness: 0.2,
    polygon: [
      [-0.1, -0.1],
      [8.3, -0.1],
      [8.3, 4.3],
      [-0.1, 4.3],
    ],
  })
  const manual = SlabNode.parse({
    id: 'slab_manual',
    parentId: 'level_1',
    elevation: 0.05,
    thickness: 0.05,
    polygon: [
      [6, 2],
      [7.5, 2],
      [7.5, 3.5],
      [6, 3.5],
    ],
  })
  const context: PlateLevelContext = { walls, zones, slabs: [plate, manual] }
  return { plate, manual, context }
}

function roleAt(
  partition: NonNullable<ReturnType<typeof computePlateSurfacePartition>>,
  point: [number, number],
): string | null {
  const hits = partition.cells.filter((cell) => containsPoint(cell.polygons, point))
  expect(hits.length).toBeLessThanOrEqual(1)
  return hits[0]?.role ?? null
}

describe('plate top partition', () => {
  test('room finishes, a region and a manual slab split one plate top', () => {
    clearPlateSurfaceCaches()
    const { plate, manual, context } = twoRoomLevel()
    const partition = computePlateSurfacePartition(plate, context)
    if (!partition) throw new Error('expected a partition')

    expect(partition.plainTop).toBe(false)
    // One cell per distinct resolved surface: region, room A, room B, plate.
    expect(partition.cells.map((cell) => cell.role)).toEqual([
      roomFinishRole('zone_a', 'region_1'),
      roomFinishRole('zone_a'),
      roomFinishRole('zone_b'),
      'surface',
    ])
    expect(partition.cells.map((cell) => cell.materialKey)).toEqual([
      plateFinishKey(TERRAZZO),
      plateFinishKey(WOOD),
      plateFinishKey(TILE),
      plateFinishKey(undefined),
    ])

    // Sample points: inside the region, room A outside it, room B, under the
    // divider, under the outer wall, and where the manual slab masks the plate.
    expect(roleAt(partition, [1, 1])).toBe(roomFinishRole('zone_a', 'region_1'))
    expect(roleAt(partition, [3, 3])).toBe(roomFinishRole('zone_a'))
    expect(roleAt(partition, [0.6, 3.5])).toBe(roomFinishRole('zone_a'))
    expect(roleAt(partition, [5, 1])).toBe(roomFinishRole('zone_b'))
    expect(roleAt(partition, [4.1, 2])).toBe('surface')
    expect(roleAt(partition, [0, 2])).toBe('surface')
    expect(roleAt(partition, [8.25, 2])).toBe('surface')
    expect(roleAt(partition, [6.75, 2.75])).toBeNull()

    // The mask is exactly the manual slab, and no cell reaches into it.
    expect(area(partition.masked)).toBeCloseTo(1.5 * 1.5, 4)
    for (const cell of partition.cells) {
      expect(area(intersection(cell.polygons, partition.masked))).toBeLessThan(1e-6)
    }
    // The cells plus the mask tile the whole plate top, with no overlap.
    const total = partition.cells.reduce((sum, cell) => sum + area(cell.polygons), 0)
    expect(total + area(partition.masked)).toBeCloseTo(8.4 * 4.4, 3)
    expect(area(union([...partition.cells.flatMap((cell) => cell.polygons)]))).toBeCloseTo(total, 3)
    expect(manual.polygon).toHaveLength(4)
  })

  test('the same inputs build the same partition twice', () => {
    clearPlateSurfaceCaches()
    const first = computePlateSurfacePartition(twoRoomLevel().plate, twoRoomLevel().context)
    clearPlateSurfaceCaches()
    const second = computePlateSurfacePartition(twoRoomLevel().plate, twoRoomLevel().context)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  test('a plate with no room finish keeps one plain surface cell', () => {
    clearPlateSurfaceCaches()
    const { plate, context } = twoRoomLevel()
    const bare = context.zones.map((z) => ({ ...z, floor: undefined }))
    const partition = computePlateSurfacePartition(plate, {
      ...context,
      zones: bare,
      slabs: [plate],
    })
    if (!partition) throw new Error('expected a partition')
    expect(partition.plainTop).toBe(true)
    expect(partition.cells).toHaveLength(1)
    expect(partition.cells[0]?.role).toBe('surface')
  })

  test('a manual slab has no partition', () => {
    clearPlateSurfaceCaches()
    const { manual, context } = twoRoomLevel()
    expect(computePlateSurfacePartition(manual, context)).toBeNull()
  })
})

describe('plate side exposure', () => {
  /**
   * A raised plate whose north edge stands under a wall, whose east edge steps
   * down onto a lower plate, and whose south and west edges face the outside.
   */
  function steppedLevel() {
    const plate = SlabNode.parse({
      id: 'slab_upper',
      parentId: 'level_1',
      boundary: 'auto',
      autoFromWalls: true,
      zoneIds: ['zone_upper'],
      elevation: 0.35,
      thickness: 0.2,
      polygon: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
    })
    const lower = SlabNode.parse({
      id: 'slab_lower',
      parentId: 'level_1',
      boundary: 'auto',
      autoFromWalls: true,
      zoneIds: ['zone_lower'],
      elevation: 0.05,
      thickness: 0.2,
      polygon: [
        [4, 0],
        [8, 0],
        [8, 4],
        [4, 4],
      ],
    })
    const context: PlateLevelContext = {
      walls: [wall('wall_n', [0, 0], [4, 0])],
      zones: [
        zone('zone_upper', [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
        ]),
        zone('zone_lower', [
          [4, 0],
          [8, 0],
          [8, 4],
          [4, 4],
        ]),
      ],
      slabs: [plate, lower],
    }
    return { plate, context }
  }

  test('classifies exterior, riser and wall-covered edges', () => {
    clearPlateSurfaceCaches()
    const { plate, context } = steppedLevel()
    const partition = computePlateSurfacePartition(plate, context)
    if (!partition) throw new Error('expected a partition')

    // East: faces the lower plate and the room it carries → a riser.
    expect(classifyPlateSideAt(partition, [4, 2])).toBe('riser')
    // South and west: nothing on the far side → exterior edges.
    expect(classifyPlateSideAt(partition, [2, 4])).toBe('edge')
    expect(classifyPlateSideAt(partition, [0, 2])).toBe('edge')
    // The facade covers the top, but its slab thickness remains visible.
    expect(classifyPlateSideAt(partition, [2, 0])).toBe('edge')
    expect(partition.sides.some((side) => side.role === 'riser')).toBe(true)
    expect(
      partition.sides.some(
        (side) =>
          side.role === 'edge' && Math.abs(side.start[1]) < 1e-9 && Math.abs(side.end[1]) < 1e-9,
      ),
    ).toBe(true)
  })

  test('an open hole rim is an edge', () => {
    clearPlateSurfaceCaches()
    const { plate, context } = steppedLevel()
    const withHole = SlabNode.parse({
      ...plate,
      holes: [
        [
          [1, 1],
          [2, 1],
          [2, 2],
          [1, 2],
        ],
      ],
      holeMetadata: [{ source: 'manual' }],
    })
    const partition = computePlateSurfacePartition(withHole, {
      ...context,
      slabs: [withHole, ...context.slabs.slice(1)],
    })
    if (!partition) throw new Error('expected a partition')
    expect(classifyPlateSideAt(partition, [1.5, 1])).toBe('edge')
  })
})

describe('room finish roles', () => {
  test('round-trip a room role and a region role', () => {
    expect(parseRoomFinishRole(roomFinishRole('zone_1'))).toEqual({
      zoneId: 'zone_1',
      regionId: null,
    })
    expect(parseRoomFinishRole(roomFinishRole('zone_1', 'region_2'))).toEqual({
      zoneId: 'zone_1',
      regionId: 'region_2',
    })
    expect(parseRoomFinishRole('surface')).toBeNull()
    expect(parseRoomFinishRole('edge')).toBeNull()
  })

  test('equal finishes share a material key, different ones do not', () => {
    expect(plateFinishKey(WOOD)).toBe(plateFinishKey(WOOD))
    expect(plateFinishKey(WOOD)).not.toBe(plateFinishKey(TILE))
    expect(plateFinishKey({ properties: { color: '#ff0000' } })).toBe(
      plateFinishKey({ properties: { color: '#ff0000' } }),
    )
  })
})
