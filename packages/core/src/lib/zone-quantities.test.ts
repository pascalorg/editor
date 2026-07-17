import { describe, expect, test } from 'bun:test'
import { type AnyNode, CeilingNode, SlabNode, WallNode, ZoneNode } from '../schema'
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
      note: 'Gross interior wall face before openings.',
    })
    expect(report.floorSurface).toEqual({
      status: 'available',
      value: 12,
      note: 'Matching slab surface after openings.',
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
      note: 'Matching slab surface after openings.',
    })
  })
})
