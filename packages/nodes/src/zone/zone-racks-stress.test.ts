import { describe, expect, it } from 'bun:test'
import type { AnyNode, AnyNodeId, ZoneNode } from '@pascal-app/core'
import {
  calculateZoneProjection,
  deriveZoneRackFootprints,
  getRackDimensions,
  isPointInZoneFootprint,
  isWarehouseEquipmentNode,
} from './zone-racks'

const asNodeId = (id: string): AnyNodeId => id as unknown as AnyNodeId
const asNodes = (nodes: Record<string, AnyNode>): Record<string, AnyNode> => nodes

function createStressZone(
  id: string,
  polygon: [number, number][],
  parentId = 'level_0',
): ZoneNode {
  return {
    id: asNodeId(id),
    type: 'zone',
    name: `Zone ${id}`,
    parentId: asNodeId(parentId),
    polygon,
    roomNumber: id.toUpperCase(),
    spaceRole: 'storage',
    enclosureStatus: 'open',
  } as unknown as ZoneNode
}

describe('Challenger 2: Minimap Racks & Projection Stress Testing', () => {
  it('projects racks with negative world coordinates and negative zone bounds accurately', () => {
    // Negative zone from [-100, -80] to [-20, -10]
    const zone = createStressZone('negative_zone', [
      [-100, -80],
      [-20, -80],
      [-20, -10],
      [-100, -10],
    ])

    const nodes: Record<string, AnyNode> = {
      neg_rack_1: {
        id: asNodeId('neg_rack_1'),
        type: 'warehouse:pallet-rack',
        parentId: asNodeId('level_0'),
        position: [-60, 0, -45],
        rotation: [0, 0, 0],
        bayClearWidth: 2.7,
        depth: 1.1,
      } as unknown as AnyNode,
      neg_rack_rot: {
        id: asNodeId('neg_rack_rot'),
        type: 'warehouse:pallet-rack',
        parentId: asNodeId('level_0'),
        position: [-40, 0, -30],
        rotation: [0, Math.PI / 4, 0], // 45 deg
        bayClearWidth: 2.7,
        depth: 1.1,
      } as unknown as AnyNode,
    }

    const footprints = deriveZoneRackFootprints(asNodes(nodes), zone)
    expect(footprints.length).toBe(2)

    for (const fp of footprints) {
      expect(fp.points.length).toBe(4)
      for (const [x, y] of fp.points) {
        expect(Number.isFinite(x)).toBe(true)
        expect(Number.isFinite(y)).toBe(true)
        // SVG coordinates must be positive and within the 276x176 canvas bounds
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(276)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(176)
      }
    }
  })

  it('preserves geometric rectangular orthogonality and diagonal lengths under arbitrary rotations', () => {
    const zone = createStressZone('rot_zone', [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ])

    // Test multiple non-standard yaw rotations: 15°, 33°, 115°, 210°, 315°
    const angles = [15, 33, 115, 210, 315].map((deg) => (deg * Math.PI) / 180)

    for (let i = 0; i < angles.length; i++) {
      const rot = angles[i]!
      const id = `rot_rack_${i}`
      const node: AnyNode = {
        id: asNodeId(id),
        type: 'warehouse:pallet-rack',
        parentId: asNodeId('level_0'),
        position: [50, 0, 50],
        rotation: [0, rot, 0],
        bayClearWidth: 2.7,
        uprightWidth: 0.1,
        depth: 1.2,
      } as unknown as AnyNode

      const [fp] = deriveZoneRackFootprints(asNodes({ [id]: node }), zone)
      expect(fp).toBeDefined()
      expect(fp?.worldCorners).toBeDefined()

      const corners = fp!.worldCorners!
      expect(corners.length).toBe(4)

      // In world space, width = 2.7 + 2*0.1 = 2.9, depth = 1.2
      // Diagonal length = sqrt(2.9^2 + 1.2^2) = sqrt(8.41 + 1.44) = sqrt(9.85) ~= 3.13847
      const d1 = Math.hypot(corners[0]![0] - corners[2]![0], corners[0]![1] - corners[2]![1])
      const d2 = Math.hypot(corners[1]![0] - corners[3]![0], corners[1]![1] - corners[3]![1])
      const expectedDiag = Math.hypot(2.9, 1.2)

      expect(d1).toBeCloseTo(expectedDiag, 3)
      expect(d2).toBeCloseTo(expectedDiag, 3)
      expect(d1).toBeCloseTo(d2, 3) // Diagonals must be equal (rectangle)
    }
  })

  it('correctly handles 0-level racks and level isolation in minimap footprints', () => {
    const zoneGround = createStressZone('zone_ground', [
      [0, 0],
      [50, 0],
      [50, 50],
      [0, 50],
    ], 'level_0')

    const nodes: Record<string, AnyNode> = {
      rackGroundZeroLevel: {
        id: asNodeId('rack_0_level'),
        type: 'warehouse:pallet-rack',
        parentId: asNodeId('level_0'),
        position: [25, 0, 25],
        levels: 0, // 0 levels
        bayClearWidth: 2.7,
        depth: 1.1,
      } as unknown as AnyNode,
      rackMezzanineLevel: {
        id: asNodeId('rack_mezz_level'),
        type: 'warehouse:pallet-rack',
        parentId: asNodeId('level_mezzanine_1'), // Different level
        position: [25, 3.5, 25],
        bayClearWidth: 2.7,
        depth: 1.1,
      } as unknown as AnyNode,
    }

    const footprints = deriveZoneRackFootprints(asNodes(nodes), zoneGround)
    // Only the rack on level_0 should be rendered, despite identical (X, Z) coordinates
    expect(footprints.length).toBe(1)
    expect(footprints[0]?.id).toBe('rack_0_level')
  })

  it('stress tests a high-density zone containing 250+ equipment nodes', () => {
    const bigZone = createStressZone('zone_mega', [
      [0, 0],
      [200, 0],
      [200, 200],
      [0, 200],
    ])

    const nodes: Record<string, AnyNode> = {}
    for (let r = 0; r < 250; r++) {
      const id = `rack_mega_${r}`
      const x = 10 + (r % 15) * 12
      const z = 10 + Math.floor(r / 15) * 10
      nodes[id] = {
        id: asNodeId(id),
        type: r % 3 === 0 ? 'warehouse:drive-in-rack' : r % 3 === 1 ? 'warehouse:pallet-rack' : 'warehouse:m3-rack',
        parentId: asNodeId('level_0'),
        position: [x, 0, z],
        bayClearWidth: 2.7,
        depth: 1.1,
      } as unknown as AnyNode
    }

    const start = performance.now()
    const footprints = deriveZoneRackFootprints(asNodes(nodes), bigZone)
    const duration = performance.now() - start

    expect(footprints.length).toBe(250)
    expect(duration).toBeLessThan(50) // Must compute sub-50ms for 250 nodes

    for (const fp of footprints) {
      expect(fp.points.length).toBe(4)
      for (const [px, py] of fp.points) {
        expect(Number.isFinite(px)).toBe(true)
        expect(Number.isFinite(py)).toBe(true)
      }
    }
  })
})
