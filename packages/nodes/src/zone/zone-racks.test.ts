import { describe, expect, test } from 'bun:test'
import { type AnyNode, ZoneNode } from '@pascal-app/core'
import {
  calculateZoneProjection,
  deriveZoneRackFootprints,
  getRackDimensions,
  isPointInZoneFootprint,
  isWarehouseEquipmentNode,
} from './zone-racks'

describe('zone-racks calculation and projection', () => {
  const defaultZone = ZoneNode.parse({
    id: 'zone_main',
    name: 'Storage Zone A',
    parentId: 'lvl_1',
    polygon: [
      [0, 0],
      [20, 0],
      [20, 10],
      [0, 10],
    ],
  })

  test('returns empty array when zone is empty or has no racks', () => {
    const emptyNodes: Record<string, AnyNode> = {}
    const footprints = deriveZoneRackFootprints(emptyNodes, defaultZone)
    expect(footprints).toEqual([])

    // Empty zone with null / undefined inputs
    expect(deriveZoneRackFootprints(undefined, defaultZone)).toEqual([])
    expect(deriveZoneRackFootprints(emptyNodes, undefined)).toEqual([])

    // Zone with invalid polygon (< 3 points)
    const invalidZone = ZoneNode.parse({
      id: 'zone_invalid',
      name: 'Invalid Zone',
      polygon: [
        [0, 0],
        [1, 1],
      ],
    })
    expect(deriveZoneRackFootprints(emptyNodes, invalidZone)).toEqual([])
  })

  test('extracts unrotated pallet rack footprint correctly', () => {
    // Pallet rack with bayClearWidth=2.7, uprightWidth=0.122 -> width=2.944, depth=1.1
    const nodes: Record<string, AnyNode> = {
      rack_1: {
        id: 'rack_1',
        type: 'warehouse:pallet-rack',
        parentId: 'lvl_1',
        position: [10, 0, 5],
        rotation: [0, 0, 0],
        bayClearWidth: 2.7,
        uprightWidth: 0.122,
        depth: 1.1,
      } as unknown as AnyNode,
    }

    const footprints = deriveZoneRackFootprints(nodes, defaultZone)
    expect(footprints).toHaveLength(1)

    const footprint = footprints[0]!
    expect(footprint.id).toBe('rack_1')
    expect(footprint.type).toBe('warehouse:pallet-rack')
    expect(footprint.width).toBeCloseTo(2.944, 4)
    expect(footprint.depth).toBeCloseTo(1.1, 4)
    expect(footprint.rotation).toBe(0)

    // Check world corners centered around [10, 5]
    // Corners: [-1.472, -0.55], [1.472, -0.55], [1.472, 0.55], [-1.472, 0.55]
    // World corners: [8.528, 4.45], [11.472, 4.45], [11.472, 5.55], [8.528, 5.55]
    expect(footprint.worldCorners).toBeDefined()
    const wc = footprint.worldCorners!
    expect(wc[0]![0]).toBeCloseTo(8.528, 3)
    expect(wc[0]![1]).toBeCloseTo(4.45, 3)
    expect(wc[1]![0]).toBeCloseTo(11.472, 3)
    expect(wc[1]![1]).toBeCloseTo(4.45, 3)
    expect(wc[2]![0]).toBeCloseTo(11.472, 3)
    expect(wc[2]![1]).toBeCloseTo(5.55, 3)
    expect(wc[3]![0]).toBeCloseTo(8.528, 3)
    expect(wc[3]![1]).toBeCloseTo(5.55, 3)

    // Projected SVG points should form a rectangle
    expect(footprint.points).toHaveLength(4)
    const [p0, p1, p2, p3] = footprint.points
    // Horizontal edges p0->p1 and p3->p2 should have equal Y coordinates
    expect(p0[1]).toBeCloseTo(p1[1], 3)
    expect(p3[1]).toBeCloseTo(p2[1], 3)
    // Vertical edges p0->p3 and p1->p2 should have equal X coordinates
    expect(p0[0]).toBeCloseTo(p3[0], 3)
    expect(p1[0]).toBeCloseTo(p2[0], 3)
  })

  test('extracts rotated racks at 0, PI/4, PI/2, and PI radians', () => {
    const angles = [
      { name: '0 deg', rot: 0 },
      { name: '45 deg', rot: Math.PI / 4 },
      { name: '90 deg', rot: Math.PI / 2 },
      { name: '180 deg', rot: Math.PI },
    ]

    for (const { rot } of angles) {
      const nodes: Record<string, AnyNode> = {
        rack_rot: {
          id: 'rack_rot',
          type: 'warehouse:pallet-rack',
          parentId: 'lvl_1',
          position: [10, 0, 5],
          rotation: [0, rot, 0],
          width: 3.0,
          depth: 1.0,
        } as unknown as AnyNode,
      }

      const footprints = deriveZoneRackFootprints(nodes, defaultZone)
      expect(footprints).toHaveLength(1)

      const footprint = footprints[0]!
      expect(footprint.rotation).toBeCloseTo(rot, 5)

      const wc = footprint.worldCorners!
      expect(wc).toHaveLength(4)

      // Verify corner distances from center [10, 5] are preserved under rotation:
      // Half width = 1.5, half depth = 0.5 -> expected radius = sqrt(1.5^2 + 0.5^2) = sqrt(2.5) ≈ 1.5811
      const expectedRadius = Math.hypot(1.5, 0.5)
      for (const [wx, wz] of wc) {
        const dist = Math.hypot(wx - 10, wz - 5)
        expect(dist).toBeCloseTo(expectedRadius, 4)
      }

      // Opposite sides should have equal length
      const side01 = Math.hypot(wc[1][0] - wc[0][0], wc[1][1] - wc[0][1])
      const side23 = Math.hypot(wc[3][0] - wc[2][0], wc[3][1] - wc[2][1])
      const side12 = Math.hypot(wc[2][0] - wc[1][0], wc[2][1] - wc[1][1])
      const side30 = Math.hypot(wc[0][0] - wc[3][0], wc[0][1] - wc[3][1])

      expect(side01).toBeCloseTo(3.0, 4) // width
      expect(side23).toBeCloseTo(3.0, 4)
      expect(side12).toBeCloseTo(1.0, 4) // depth
      expect(side30).toBeCloseTo(1.0, 4)
    }
  })

  test('extracts 90-degree rotated rack world and SVG coordinates correctly', () => {
    // Center at [10, 5], width=4, depth=2, rotY = PI/2
    const nodes: Record<string, AnyNode> = {
      rack_90: {
        id: 'rack_90',
        type: 'warehouse:pallet-rack',
        parentId: 'lvl_1',
        position: [10, 0, 5],
        rotation: [0, Math.PI / 2, 0],
        width: 4.0,
        depth: 2.0,
      } as unknown as AnyNode,
    }

    const footprints = deriveZoneRackFootprints(nodes, defaultZone)
    const wc = footprints[0]!.worldCorners!

    // When rotY = PI/2 (cos=0, sin=1):
    // wx = posX + dz
    // wz = posZ - dx
    // c0 = [-2, -1] -> wx = 10 + (-1) = 9,  wz = 5 - (-2) = 7
    // c1 = [ 2, -1] -> wx = 10 + (-1) = 9,  wz = 5 - 2    = 3
    // c2 = [ 2,  1] -> wx = 10 + 1    = 11, wz = 5 - 2    = 3
    // c3 = [-2,  1] -> wx = 10 + 1    = 11, wz = 5 - (-2) = 7
    expect(wc[0]![0]).toBeCloseTo(9, 4)
    expect(wc[0]![1]).toBeCloseTo(7, 4)
    expect(wc[1]![0]).toBeCloseTo(9, 4)
    expect(wc[1]![1]).toBeCloseTo(3, 4)
    expect(wc[2]![0]).toBeCloseTo(11, 4)
    expect(wc[2]![1]).toBeCloseTo(3, 4)
    expect(wc[3]![0]).toBeCloseTo(11, 4)
    expect(wc[3]![1]).toBeCloseTo(7, 4)
  })

  test('handles multiple rack types with accurate dimensions', () => {
    const nodes: Record<string, AnyNode> = {
      selective_double_deep: {
        id: 'selective_double_deep',
        type: 'warehouse:pallet-rack',
        parentId: 'lvl_1',
        position: [3, 0, 2],
        bayClearWidth: 2.7,
        uprightWidth: 0.122,
        depth: 1.1,
        depthPositions: 2,
        depthGap: 0.05,
      } as unknown as AnyNode,

      drive_in: {
        id: 'drive_in',
        type: 'warehouse:drive-in-rack',
        parentId: 'lvl_1',
        position: [8, 0, 4],
        laneClearWidth: 1.35,
        uprightWidth: 0.122,
        palletsDeep: 4,
        palletRunDepth: 1.2,
        depthClearance: 0.025,
      } as unknown as AnyNode,

      longspan: {
        id: 'longspan',
        type: 'warehouse:longspan-rack',
        parentId: 'lvl_1',
        position: [14, 0, 6],
        bayLength: 2.0,
        uprightWidth: 0.06,
        frameDepth: 0.8,
      } as unknown as AnyNode,

      m3_shelving: {
        id: 'm3_shelving',
        type: 'warehouse:m3-rack',
        parentId: 'lvl_1',
        position: [18, 0, 8],
        shelfLength: 1.0,
        uprightWidth: 0.04,
        shelfDepth: 0.5,
      } as unknown as AnyNode,

      live_rack: {
        id: 'live_rack',
        type: 'warehouse:live-rack',
        parentId: 'lvl_1',
        position: [5, 0, 8],
        bayWidth: 1.5,
        channelDepth: 6.0,
      } as unknown as AnyNode,

      cantilever: {
        id: 'cantilever',
        type: 'warehouse:cantilever-rack',
        parentId: 'lvl_1',
        position: [11, 0, 8],
        width: 2.4,
        depth: 1.2,
      } as unknown as AnyNode,
    }

    const footprints = deriveZoneRackFootprints(nodes, defaultZone)
    expect(footprints).toHaveLength(6)

    const find = (id: string) => footprints.find((f) => f.id === id)!

    // 1. Double-deep selective pallet rack (2.7 + 2*0.122 = 2.944 width, 2*1.1 + 0.05 = 2.25 depth)
    const sel = find('selective_double_deep')
    expect(sel.width).toBeCloseTo(2.944, 3)
    expect(sel.depth).toBeCloseTo(2.25, 3)

    // 2. Drive-in rack (1.35 + 2*0.122 = 1.594 width, 4 * (1.2 + 0.025) = 4.9 depth)
    const di = find('drive_in')
    expect(di.width).toBeCloseTo(1.594, 3)
    expect(di.depth).toBeCloseTo(4.9, 3)

    // 3. Longspan (2.0 + 2*0.06 = 2.12 width, 0.8 depth)
    const ls = find('longspan')
    expect(ls.width).toBeCloseTo(2.12, 3)
    expect(ls.depth).toBeCloseTo(0.8, 3)

    // 4. M3 Shelving (1.0 + 2*0.04 = 1.08 width, 0.5 depth)
    const m3 = find('m3_shelving')
    expect(m3.width).toBeCloseTo(1.08, 3)
    expect(m3.depth).toBeCloseTo(0.5, 3)

    // 5. Live rack (1.5 width, 6.0 depth)
    const live = find('live_rack')
    expect(live.width).toBeCloseTo(1.5, 3)
    expect(live.depth).toBeCloseTo(6.0, 3)

    // 6. Cantilever (2.4 width, 1.2 depth)
    const cant = find('cantilever')
    expect(cant.width).toBeCloseTo(2.4, 3)
    expect(cant.depth).toBeCloseTo(1.2, 3)
  })

  test('filters out nodes on different levels', () => {
    const nodes: Record<string, AnyNode> = {
      rack_same_level: {
        id: 'rack_same_level',
        type: 'warehouse:pallet-rack',
        parentId: 'lvl_1',
        position: [10, 0, 5],
      } as unknown as AnyNode,
      rack_different_level: {
        id: 'rack_different_level',
        type: 'warehouse:pallet-rack',
        parentId: 'lvl_2',
        position: [10, 0, 5],
      } as unknown as AnyNode,
    }

    const footprints = deriveZoneRackFootprints(nodes, defaultZone)
    expect(footprints).toHaveLength(1)
    expect(footprints[0]!.id).toBe('rack_same_level')
  })

  test('filters out non-warehouse architectural fabric nodes', () => {
    const nodes: Record<string, AnyNode> = {
      wall_1: {
        id: 'wall_1',
        type: 'wall',
        parentId: 'lvl_1',
        position: [10, 0, 5],
      } as unknown as AnyNode,
      slab_1: {
        id: 'slab_1',
        type: 'slab',
        parentId: 'lvl_1',
        position: [10, 0, 5],
      } as unknown as AnyNode,
      ceiling_1: {
        id: 'ceiling_1',
        type: 'ceiling',
        parentId: 'lvl_1',
        position: [10, 0, 5],
      } as unknown as AnyNode,
      zone_other: {
        id: 'zone_other',
        type: 'zone',
        parentId: 'lvl_1',
        position: [10, 0, 5],
      } as unknown as AnyNode,
      rack_valid: {
        id: 'rack_valid',
        type: 'warehouse:pallet-rack',
        parentId: 'lvl_1',
        position: [10, 0, 5],
      } as unknown as AnyNode,
    }

    const footprints = deriveZoneRackFootprints(nodes, defaultZone)
    expect(footprints).toHaveLength(1)
    expect(footprints[0]!.id).toBe('rack_valid')
  })

  test('filters out racks standing outside the zone polygon boundary', () => {
    const nodes: Record<string, AnyNode> = {
      rack_inside: {
        id: 'rack_inside',
        type: 'warehouse:pallet-rack',
        parentId: 'lvl_1',
        position: [10, 0, 5], // Inside [0..20, 0..10]
      } as unknown as AnyNode,
      rack_outside_far: {
        id: 'rack_outside_far',
        type: 'warehouse:pallet-rack',
        parentId: 'lvl_1',
        position: [50, 0, 50], // Far outside
      } as unknown as AnyNode,
      rack_outside_negative: {
        id: 'rack_outside_negative',
        type: 'warehouse:pallet-rack',
        parentId: 'lvl_1',
        position: [-5, 0, 5], // Outside negative X
      } as unknown as AnyNode,
    }

    const footprints = deriveZoneRackFootprints(nodes, defaultZone)
    expect(footprints).toHaveLength(1)
    expect(footprints[0]!.id).toBe('rack_inside')
  })

  test('calculateZoneProjection computes correct scale and offset', () => {
    const polygon = [
      [0, 0],
      [100, 0],
      [100, 50],
      [0, 50],
    ] as const

    const proj = calculateZoneProjection(polygon, 300, 200, 20)
    expect(proj.minX).toBe(0)
    expect(proj.maxX).toBe(100)
    expect(proj.minY).toBe(0)
    expect(proj.maxY).toBe(50)

    // width = 100, height = 50
    // availWidth = 300 - 40 = 260 -> scaleX = 2.6
    // availHeight = 200 - 40 = 160 -> scaleY = 3.2
    // scale = min(2.6, 3.2) = 2.6
    expect(proj.scale).toBeCloseTo(2.6, 4)

    // offsetX = (300 - 100 * 2.6) / 2 = (300 - 260) / 2 = 20
    // offsetY = (200 - 50 * 2.6) / 2 = (200 - 130) / 2 = 35
    expect(proj.offsetX).toBeCloseTo(20, 4)
    expect(proj.offsetY).toBeCloseTo(35, 4)
  })

  test('getRackDimensions returns explicit dimensions when present', () => {
    const nodeWithExplicit = {
      id: 'custom_1',
      type: 'warehouse:custom',
      width: 4.5,
      depth: 1.8,
    } as unknown as AnyNode

    expect(getRackDimensions(nodeWithExplicit)).toEqual({ width: 4.5, depth: 1.8 })

    const nodeWithTuple = {
      id: 'custom_2',
      type: 'item',
      dimensions: [3.2, 2.0, 1.4],
    } as unknown as AnyNode

    expect(getRackDimensions(nodeWithTuple)).toEqual({ width: 3.2, depth: 1.4 })
  })

  test('isWarehouseEquipmentNode correctly identifies warehouse and rack types', () => {
    expect(isWarehouseEquipmentNode({ id: '1', type: 'warehouse:pallet-rack' } as AnyNode)).toBe(
      true,
    )
    expect(isWarehouseEquipmentNode({ id: '2', type: 'warehouse:drive-in-rack' } as AnyNode)).toBe(
      true,
    )
    expect(isWarehouseEquipmentNode({ id: '3', type: 'warehouse:conveyor' } as AnyNode)).toBe(true)
    expect(isWarehouseEquipmentNode({ id: '4', type: 'longspan-rack' } as AnyNode)).toBe(true)
    expect(isWarehouseEquipmentNode({ id: '5', type: 'm3-shelving' } as AnyNode)).toBe(true)
    expect(isWarehouseEquipmentNode({ id: '6', type: 'wall' } as AnyNode)).toBe(false)
    expect(isWarehouseEquipmentNode({ id: '7', type: 'slab' } as AnyNode)).toBe(false)
    expect(isWarehouseEquipmentNode({ id: '8', type: 'zone' } as AnyNode)).toBe(false)
  })

  test('isPointInZoneFootprint detects points inside and on boundary with tolerance', () => {
    const square = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ] as const

    // Strictly interior point
    expect(isPointInZoneFootprint([5, 5], square)).toBe(true)

    // Exactly on boundary edge
    expect(isPointInZoneFootprint([0, 5], square)).toBe(true)
    expect(isPointInZoneFootprint([10, 5], square)).toBe(true)

    // Just outside edge within tolerance (0.5m)
    expect(isPointInZoneFootprint([10.3, 5], square, 0.5)).toBe(true)

    // Far outside
    expect(isPointInZoneFootprint([15, 5], square)).toBe(false)
    expect(isPointInZoneFootprint([-2, 5], square)).toBe(false)
  })
})
