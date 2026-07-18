import { describe, expect, test } from 'bun:test'
import { type AnyNode, CeilingNode, SlabNode, WallNode, ZoneNode } from '../schema'
import { detectSpacesForLevel } from './space-detection'
import { deriveZoneQuantityReport } from './zone-quantities'

const polygon: Array<[number, number]> = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
]

function sceneRecord(nodes: AnyNode[]): Record<string, AnyNode> {
  return Object.fromEntries(nodes.map((node) => [node.id, node]))
}

function roomNodes() {
  const zone = ZoneNode.parse({ id: 'zone_room', name: 'Studio', parentId: 'level_main', polygon })
  const slab = SlabNode.parse({ id: 'slab_room', parentId: 'level_main', polygon })
  const ceiling = CeilingNode.parse({ id: 'ceiling_room', parentId: 'level_main', polygon })
  const walls = polygon.map((start, index) =>
    WallNode.parse({
      id: `wall_${index}`,
      parentId: 'level_main',
      start,
      end: polygon[(index + 1) % polygon.length],
      height: 2.5,
    }),
  )
  return { zone, slab, ceiling, walls }
}

describe('deriveZoneQuantityReport', () => {
  test('derives room surfaces and volume only from matching enclosure geometry', () => {
    const { zone, slab, ceiling, walls } = roomNodes()
    const report = deriveZoneQuantityReport(
      zone,
      sceneRecord([zone, slab, ceiling, ...walls] as AnyNode[]),
    )

    expect(report.classification).toBe('enclosed-room')
    expect(report.footprintArea).toBeCloseTo(12)
    expect(report.perimeter).toBeCloseTo(14)
    expect(report.boundaryWallIds).toHaveLength(4)
    expect(report.wallSurface).toEqual({
      status: 'available',
      value: 35,
      note: "Gross interior wall face using each boundary wall's height.",
    })
    expect(report.floorSurface).toEqual({
      status: 'available',
      value: 12,
      note: 'Zone floor surface covered by one slab, after openings.',
    })
    expect(report.volume.status).toBe('available')
    if (report.volume.status === 'available') expect(report.volume.value).toBeCloseTo(29.4)
  })

  test('keeps standalone zones honest about unavailable room quantities', () => {
    const zone = ZoneNode.parse({
      id: 'zone_site',
      name: 'Garden',
      parentId: 'level_main',
      polygon,
    })
    const report = deriveZoneQuantityReport(zone, sceneRecord([zone]))

    expect(report.classification).toBe('footprint')
    expect(report.footprintArea).toBeCloseTo(12)
    expect(report.wallSurface.status).toBe('unavailable')
    expect(report.floorSurface.status).toBe('unavailable')
    expect(report.volume.status).toBe('unavailable')
  })

  test('subtracts matching slab openings from floor surface', () => {
    const { zone, slab } = roomNodes()
    const slabWithHole = SlabNode.parse({
      ...slab,
      holes: [
        [
          [1, 1],
          [2, 1],
          [2, 2],
          [1, 2],
        ],
      ],
    })
    const report = deriveZoneQuantityReport(zone, sceneRecord([zone, slabWithHole]))

    expect(report.floorSurface).toEqual({
      status: 'available',
      value: 11,
      note: 'Zone floor surface covered by one slab, after openings.',
    })
  })

  test('derives a concave room from covering surfaces and unequal boundary-wall heights', () => {
    const lShape: Array<[number, number]> = [
      [0, 0],
      [6, 0],
      [6, 5.5],
      [8, 5.5],
      [8, 7.5],
      [0, 7.5],
    ]
    const coveringPolygon: Array<[number, number]> = [
      [-1, -1],
      [9, -1],
      [9, 8.5],
      [-1, 8.5],
    ]
    const heights = [2, 2.2, 2.4, 2.6, 2.8, 3]
    const zone = ZoneNode.parse({
      id: 'zone_l_shape',
      name: 'L-shaped room',
      parentId: 'level_main',
      polygon: lShape,
    })
    const slab = SlabNode.parse({
      id: 'slab_level',
      parentId: 'level_main',
      polygon: coveringPolygon,
    })
    const ceiling = CeilingNode.parse({
      id: 'ceiling_level',
      parentId: 'level_main',
      polygon: coveringPolygon,
      height: 3.05,
    })
    const walls = lShape.map((start, index) =>
      WallNode.parse({
        id: `wall_l_${index}`,
        parentId: 'level_main',
        start,
        end: lShape[(index + 1) % lShape.length],
        height: heights[index],
      }),
    )

    const report = deriveZoneQuantityReport(
      zone,
      sceneRecord([zone, slab, ceiling, ...walls] as AnyNode[]),
    )

    expect(report.classification).toBe('enclosed-room')
    expect(report.footprintArea).toBeCloseTo(49)
    expect(report.perimeter).toBeCloseTo(31)
    expect(report.boundaryWallIds).toHaveLength(6)
    expect(report.wallSurface).toEqual({
      status: 'available',
      value: 79,
      note: "Gross interior wall face using each boundary wall's height.",
    })
    expect(report.floorSurface).toEqual({
      status: 'available',
      value: 49,
      note: 'Zone floor surface covered by one slab, after openings.',
    })
    expect(report.volume).toEqual({
      status: 'available',
      value: 147,
      note: 'Covered zone floor area multiplied by clear ceiling height.',
    })
  })

  test('subtracts only covering-slab openings that lie inside a concave zone', () => {
    const lShape: Array<[number, number]> = [
      [0, 0],
      [4, 0],
      [4, 2],
      [2, 2],
      [2, 4],
      [0, 4],
    ]
    const zone = ZoneNode.parse({
      id: 'zone_l_hole',
      name: 'L-shaped room',
      parentId: 'level_main',
      polygon: lShape,
    })
    const slab = SlabNode.parse({
      id: 'slab_covering',
      parentId: 'level_main',
      polygon: [
        [-1, -1],
        [5, -1],
        [5, 5],
        [-1, 5],
      ],
      holes: [
        [
          [0.5, 0.5],
          [1.5, 0.5],
          [1.5, 1.5],
          [0.5, 1.5],
        ],
        [
          [3, 3],
          [4, 3],
          [4, 4],
          [3, 4],
        ],
      ],
    })

    const report = deriveZoneQuantityReport(zone, sceneRecord([zone, slab]))

    expect(report.footprintArea).toBeCloseTo(12)
    expect(report.floorSurface).toEqual({
      status: 'available',
      value: 11,
      note: 'Zone floor surface covered by one slab, after openings.',
    })
  })

  test('uses the closed zone boundary when small wall-end seams prevent loop detection', () => {
    const zone = ZoneNode.parse({
      id: 'zone_seamed',
      name: 'Room with modeling seams',
      parentId: 'level_main',
      polygon,
    })
    const walls = polygon.map((start, index) => {
      const end = polygon[(index + 1) % polygon.length]!
      const dx = end[0] - start[0]
      const dz = end[1] - start[1]
      const length = Math.hypot(dx, dz)
      const insetX = (dx / length) * 0.02
      const insetZ = (dz / length) * 0.02
      return WallNode.parse({
        id: `wall_seamed_${index}`,
        parentId: 'level_main',
        start: [start[0] + insetX, start[1] + insetZ],
        end: [end[0] - insetX, end[1] - insetZ],
        height: 2.5,
      })
    })

    const report = deriveZoneQuantityReport(zone, sceneRecord([zone, ...walls] as AnyNode[]))

    expect(report.classification).toBe('enclosed-room')
    expect(report.boundaryWallIds).toHaveLength(4)
    expect(report.wallSurface.status).toBe('available')
    if (report.wallSurface.status === 'available') expect(report.wallSurface.value).toBeCloseTo(35)
  })

  test('uses only the detected boundary-face span of a wall split by T-junctions', () => {
    const wallInputs = [
      { start: [0, 0], end: [6, 0], height: 2 },
      { start: [6, 0], end: [6, 5], height: 2.1 },
      { start: [6, 5], end: [0, 5], height: 2.2 },
      { start: [0, 5], end: [0, 0], height: 2.3 },
      { start: [1, 0], end: [1, -2], height: 2.4 },
      { start: [1, -2], end: [3, -2], height: 2.6 },
      { start: [3, -2], end: [3, 0], height: 2.8 },
    ] as const
    const walls = wallInputs.map((input, index) =>
      WallNode.parse({
        id: `wall_t_${index}`,
        parentId: 'level_main',
        ...input,
      }),
    )
    const smallSpace = detectSpacesForLevel('level_main', walls).spaces.find(
      (space) => Math.max(...space.polygon.map((point) => point[1])) <= 0,
    )
    expect(smallSpace).toBeDefined()
    const zone = ZoneNode.parse({
      id: 'zone_t_junction',
      name: 'T-junction room',
      parentId: 'level_main',
      polygon: smallSpace!.polygon,
    })

    const report = deriveZoneQuantityReport(zone, sceneRecord([zone, ...walls] as AnyNode[]))

    expect(report.classification).toBe('enclosed-room')
    expect(new Set(report.boundaryWallIds)).toEqual(
      new Set(['wall_t_0', 'wall_t_4', 'wall_t_5', 'wall_t_6']),
    )
    expect(report.wallSurface.status).toBe('available')
    if (report.wallSurface.status === 'available') {
      expect(report.wallSurface.value).toBeCloseTo(19.6)
    }
  })
})
