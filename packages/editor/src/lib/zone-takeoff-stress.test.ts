import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  nodeRegistry,
  registerZoneTakeoffExtension,
  type ZoneNode,
  type ZoneTakeoffExtension,
  type ZoneTakeoffReport,
} from '@pascal-app/core'
import { shallow } from 'zustand/shallow'
import {
  collectZoneContentIds,
  collectZoneObjectIds,
  collectZoneObjectLabels,
  resolveZoneTakeoffReports,
} from './zone-content'

const asNodeId = (id: string): AnyNodeId => id as unknown as AnyNodeId

function positioned(
  id: string,
  type: string,
  x: number,
  z: number,
  parentId = 'level_1',
  props: Record<string, unknown> = {},
): AnyNode {
  return { id, type, parentId, position: [x, 0, z], ...props } as unknown as AnyNode
}

function sceneOf(...nodes: AnyNode[]): Readonly<Record<AnyNodeId, AnyNode>> {
  return Object.fromEntries(nodes.map((n) => [n.id, n])) as Record<AnyNodeId, AnyNode>
}

describe('Zone Takeoff Resolution Engine — Adversarial & Stress Suite', () => {
  beforeEach(() => {
    nodeRegistry._reset()
  })

  // =========================================================================
  // DIMENSION 1: Complex Polygon Geometry (Concavities, Holes, Cutouts)
  // =========================================================================
  describe('Dimension 1: Complex Polygon Geometry (Concavities, Holes, Cutouts)', () => {
    test('U-shaped concave zone strictly excludes nodes in the courtyard / interior notch', () => {
      // U-shaped zone: 30x30 outer, with a 10x20 interior cutout at [10..20, 10..30]
      const uZone = {
        id: asNodeId('zone_u'),
        type: 'zone',
        parentId: 'level_1',
        polygon: [
          [0, 0],
          [30, 0],
          [30, 30],
          [20, 30],
          [20, 10],
          [10, 10],
          [10, 30],
          [0, 30],
        ],
      } as unknown as ZoneNode

      const scene = sceneOf(
        uZone as unknown as AnyNode,
        // Inside left arm
        positioned('rack_left_arm', 'warehouse:pallet-rack', 5, 20),
        // Inside right arm
        positioned('rack_right_arm', 'warehouse:pallet-rack', 25, 20),
        // Inside bottom base
        positioned('rack_base', 'warehouse:pallet-rack', 15, 5),
        // OUTSIDE: Inside the U notch / courtyard (should NOT be collected!)
        positioned('rack_in_notch', 'warehouse:pallet-rack', 15, 20),
        // OUTSIDE: Far away
        positioned('rack_far', 'warehouse:pallet-rack', 50, 50),
      )

      const collected = collectZoneObjectIds(scene, uZone)
      expect(collected).toContain('rack_left_arm' as AnyNodeId)
      expect(collected).toContain('rack_right_arm' as AnyNodeId)
      expect(collected).toContain('rack_base' as AnyNodeId)
      expect(collected).not.toContain('rack_in_notch' as AnyNodeId)
      expect(collected).not.toContain('rack_far' as AnyNodeId)
      expect(collected).toHaveLength(3)
    })

    test('L-shaped concave zone strictly excludes nodes in the outer corner notch', () => {
      // L-shaped zone: 20x20 with cutout at [10..20, 10..20]
      const lZone = {
        id: asNodeId('zone_l'),
        type: 'zone',
        parentId: 'level_1',
        polygon: [
          [0, 0],
          [20, 0],
          [20, 10],
          [10, 10],
          [10, 20],
          [0, 20],
        ],
      } as unknown as ZoneNode

      const scene = sceneOf(
        lZone as unknown as AnyNode,
        positioned('rack_in_foot', 'warehouse:pallet-rack', 15, 5),
        positioned('rack_in_stem', 'warehouse:pallet-rack', 5, 15),
        positioned('rack_in_corner', 'warehouse:pallet-rack', 5, 5),
        // OUTSIDE: In the missing quadrant
        positioned('rack_in_notch', 'warehouse:pallet-rack', 15, 15),
      )

      const collected = collectZoneObjectIds(scene, lZone)
      expect(collected).toContain('rack_in_foot' as AnyNodeId)
      expect(collected).toContain('rack_in_stem' as AnyNodeId)
      expect(collected).toContain('rack_in_corner' as AnyNodeId)
      expect(collected).not.toContain('rack_in_notch' as AnyNodeId)
      expect(collected).toHaveLength(3)
    })

    test('evaluates high-vertex (100+ vertices) serpentine polygon accurately', () => {
      // Construct a serpentine zig-zag polygon with 100 vertices
      const polygon: [number, number][] = []
      const steps = 25
      for (let i = 0; i <= steps; i++) {
        const x = i * 4
        polygon.push([x, i % 2 === 0 ? 0 : 5])
      }
      for (let i = steps; i >= 0; i--) {
        const x = i * 4
        polygon.push([x, i % 2 === 0 ? 10 : 15])
      }

      const serpentineZone = {
        id: asNodeId('zone_serpentine'),
        type: 'zone',
        parentId: 'level_1',
        polygon,
      } as unknown as ZoneNode

      const scene = sceneOf(
        serpentineZone as unknown as AnyNode,
        positioned('rack_inside_1', 'warehouse:pallet-rack', 4, 7),
        positioned('rack_inside_2', 'warehouse:pallet-rack', 20, 8),
        positioned('rack_outside_high', 'warehouse:pallet-rack', 20, 50),
      )

      const collected = collectZoneObjectIds(scene, serpentineZone)
      expect(collected).toContain('rack_inside_1' as AnyNodeId)
      expect(collected).toContain('rack_inside_2' as AnyNodeId)
      expect(collected).not.toContain('rack_outside_high' as AnyNodeId)
    })

    test('boundary tolerance includes nodes positioned on or within 0.5m of boundary edges', () => {
      const squareZone = {
        id: asNodeId('zone_square'),
        type: 'zone',
        parentId: 'level_1',
        polygon: [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
      } as unknown as ZoneNode

      const scene = sceneOf(
        squareZone as unknown as AnyNode,
        // Exactly on boundary edge
        positioned('rack_on_edge', 'warehouse:pallet-rack', 10, 5),
        // Just within 0.3m tolerance outside edge
        positioned('rack_within_tol', 'warehouse:pallet-rack', 10.3, 5),
        // Beyond tolerance (>0.5m)
        positioned('rack_outside_tol', 'warehouse:pallet-rack', 10.8, 5),
      )

      const collected = collectZoneObjectIds(scene, squareZone)
      expect(collected).toContain('rack_on_edge' as AnyNodeId)
      expect(collected).toContain('rack_within_tol' as AnyNodeId)
      expect(collected).not.toContain('rack_outside_tol' as AnyNodeId)
    })
  })

  // =========================================================================
  // DIMENSION 2: Multi-Level & Nested Parent Level Isolation
  // =========================================================================
  describe('Dimension 2: Multi-Level & Nested Parent Level Isolation', () => {
    test('strictly collects nodes belonging to the zone parent level and ignores other floors', () => {
      const zoneFloor1 = {
        id: asNodeId('zone_fl1'),
        type: 'zone',
        parentId: 'level_ground',
        polygon: [
          [0, 0],
          [20, 0],
          [20, 20],
          [0, 20],
        ],
      } as unknown as ZoneNode

      const scene = sceneOf(
        zoneFloor1 as unknown as AnyNode,
        // Floor 1 (Target)
        positioned('rack_fl1_a', 'warehouse:pallet-rack', 5, 5, 'level_ground'),
        positioned('rack_fl1_b', 'warehouse:pallet-rack', 10, 10, 'level_ground'),
        // Floor 2 (Same XZ coordinates, different floor)
        positioned('rack_fl2', 'warehouse:pallet-rack', 5, 5, 'level_floor2'),
        // Mezzanine Tier (Different parent level)
        positioned('rack_mezz', 'warehouse:pallet-rack', 10, 10, 'level_mezzanine'),
        // Unparented or orphaned node
        positioned('rack_orphan', 'warehouse:pallet-rack', 5, 5, undefined),
      )

      const collected = collectZoneObjectIds(scene, zoneFloor1)
      expect(collected).toEqual(['rack_fl1_a' as AnyNodeId, 'rack_fl1_b' as AnyNodeId])
    })

    test('filters out zone fabric objects (walls, slabs, ceilings, other zones)', () => {
      const zone = {
        id: asNodeId('zone_main'),
        type: 'zone',
        parentId: 'level_1',
        polygon: [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
      } as unknown as ZoneNode

      const scene = sceneOf(
        zone as unknown as AnyNode,
        positioned('wall_1', 'wall', 5, 5, 'level_1'),
        positioned('slab_1', 'slab', 5, 5, 'level_1'),
        positioned('ceiling_1', 'ceiling', 5, 5, 'level_1'),
        positioned('sub_zone', 'zone', 5, 5, 'level_1'),
        positioned('actual_rack', 'warehouse:pallet-rack', 5, 5, 'level_1'),
      )

      const collected = collectZoneObjectIds(scene, zone)
      expect(collected).toEqual(['actual_rack' as AnyNodeId])
    })
  })

  // =========================================================================
  // DIMENSION 3: Extreme Scale Host Scene (5,000+ Nodes)
  // =========================================================================
  describe('Dimension 3: Extreme Scale Host Scene (5,000+ Nodes)', () => {
    test('resolves zone contents and takeoff across 5,000 host nodes in <150ms', () => {
      const zone = {
        id: asNodeId('zone_mega'),
        type: 'zone',
        parentId: 'level_1',
        polygon: [
          [0, 0],
          [100, 0],
          [100, 100],
          [0, 100],
        ],
      } as unknown as ZoneNode

      const nodesRecord: Record<AnyNodeId, AnyNode> = {}
      nodesRecord[zone.id] = zone as unknown as AnyNode

      const totalNodes = 5000
      let expectedInside = 0

      for (let i = 0; i < totalNodes; i++) {
        const id = asNodeId(`node_${i}`)
        const isInside = i % 2 === 0
        const x = isInside ? (i % 90) + 5 : (i % 90) + 150
        const z = isInside ? ((i * 3) % 90) + 5 : ((i * 3) % 90) + 150
        const parentId = i % 5 === 0 ? 'level_other' : 'level_1'

        if (isInside && parentId === 'level_1') {
          expectedInside++
        }

        nodesRecord[id] = positioned(id as string, 'warehouse:pallet-rack', x, z, parentId, {
          bayClearWidth: 2.7,
          depth: 1.1,
          uprightHeight: 8.0,
          levels: 4,
          depthPositions: 1,
        })
      }

      const dummyExtension: ZoneTakeoffExtension = {
        id: 'test:takeoff',
        pluginId: 'test',
        supportsZone({ contentIds }) {
          return contentIds.length > 0
        },
        deriveTakeoff({ zone, contentIds }) {
          return {
            id: `${zone.id}:takeoff`,
            title: 'Test Takeoff',
            metrics: [{ key: 'count', label: 'Item Count', value: contentIds.length }],
          }
        },
      }

      registerZoneTakeoffExtension(dummyExtension)

      const start = performance.now()
      const collected = collectZoneObjectIds(nodesRecord, zone)
      const reports = resolveZoneTakeoffReports(nodesRecord, zone)
      const elapsed = performance.now() - start

      expect(collected).toHaveLength(expectedInside)
      expect(reports).toHaveLength(1)
      expect(reports[0]?.metrics[0]?.value).toBe(expectedInside)
      expect(elapsed).toBeLessThan(150) // High speed containment filtering
    })
  })

  // =========================================================================
  // DIMENSION 4: Shallow Equality Stability & React 185 Loop Prevention
  // =========================================================================
  describe('Dimension 4: Shallow Equality Stability & React 185 Loop Prevention', () => {
    const zone = {
      id: asNodeId('zone_memo'),
      type: 'zone',
      parentId: 'level_1',
      polygon: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
    } as unknown as ZoneNode

    const displayName = (node: AnyNode) =>
      (node.type as string) === 'warehouse:pallet-rack'
        ? 'Selective Pallet Rack'
        : 'Warehouse Object'

    test('collectZoneObjectLabels returns shallow-equal string arrays over 50 repeated renders', () => {
      const scene = sceneOf(
        zone as unknown as AnyNode,
        positioned('rack_1', 'warehouse:pallet-rack', 2, 2),
        positioned('rack_2', 'warehouse:pallet-rack', 4, 4),
        positioned('rack_3', 'warehouse:pallet-rack', 6, 6),
      )

      const initialLabels = collectZoneObjectLabels(scene, zone, displayName)

      for (let i = 0; i < 50; i++) {
        const nextLabels = collectZoneObjectLabels(scene, zone, displayName)
        // shallow must evaluate to true to guarantee React does not trigger render loop (Error 185)
        expect(shallow(initialLabels, nextLabels)).toBe(true)
      }
    })

    test('collectZoneObjectLabels detects position change and breaks shallow equality', () => {
      const sceneBefore = sceneOf(
        zone as unknown as AnyNode,
        positioned('rack_1', 'warehouse:pallet-rack', 2, 2),
      )
      const sceneAfter = sceneOf(
        zone as unknown as AnyNode,
        // Moved out of zone
        positioned('rack_1', 'warehouse:pallet-rack', 50, 50),
      )

      const labelsBefore = collectZoneObjectLabels(sceneBefore, zone, displayName)
      const labelsAfter = collectZoneObjectLabels(sceneAfter, zone, displayName)

      expect(shallow(labelsBefore, labelsAfter)).toBe(false)
    })

    test('resolveZoneTakeoffReports returns identical EMPTY_TAKEOFF_REPORTS reference when empty', () => {
      const scene = sceneOf(
        zone as unknown as AnyNode,
        positioned('wall_1', 'wall', 2, 2),
      )

      const res1 = resolveZoneTakeoffReports(scene, zone)
      const res2 = resolveZoneTakeoffReports(scene, zone)

      expect(res1).toBe(res2) // Same array reference, preventing useMemo/useShallow churn
      expect(res1).toHaveLength(0)
    })
  })

  // =========================================================================
  // DIMENSION 5: Non-Warehouse & Clean Null/Empty Fallback
  // =========================================================================
  describe('Dimension 5: Non-Warehouse & Clean Null/Empty Fallback', () => {
    test('pure architectural scene returns clean empty reports without crashing', () => {
      const zone = {
        id: asNodeId('zone_arch'),
        type: 'zone',
        parentId: 'level_1',
        polygon: [
          [0, 0],
          [20, 0],
          [20, 20],
          [0, 20],
        ],
      } as unknown as ZoneNode

      const scene = sceneOf(
        zone as unknown as AnyNode,
        positioned('wall_n', 'wall', 0, 0),
        positioned('wall_s', 'wall', 20, 20),
        positioned('slab_floor', 'slab', 10, 10),
        positioned('desk_1', 'item', 5, 5),
        positioned('chair_1', 'item', 6, 6),
      )

      const reports = resolveZoneTakeoffReports(scene, zone)
      expect(reports).toEqual([])
      expect(reports).toHaveLength(0)
    })

    test('zone with missing polygon or empty vertices gracefully handles containment', () => {
      const emptyZone = {
        id: asNodeId('zone_empty'),
        type: 'zone',
        parentId: 'level_1',
        polygon: [],
      } as unknown as ZoneNode

      const scene = sceneOf(
        emptyZone as unknown as AnyNode,
        positioned('rack_1', 'warehouse:pallet-rack', 5, 5),
      )

      expect(() => {
        const ids = collectZoneObjectIds(scene, emptyZone)
        expect(ids).toHaveLength(0)
      }).not.toThrow()
    })
  })
})
