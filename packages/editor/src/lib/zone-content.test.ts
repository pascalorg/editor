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

/**
 * A 10x10 zone with its corner at the origin, on level `level_1`.
 */
const zone = {
  id: 'zone_a',
  type: 'zone',
  parentId: 'level_1',
  polygon: [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
} as unknown as ZoneNode

function positioned(
  id: string,
  type: string,
  x: number,
  z: number,
  parentId = 'level_1',
  props: Record<string, unknown> = {},
) {
  return { id, type, parentId, position: [x, 1, z], ...props } as unknown as AnyNode
}

function sceneOf(...nodes: AnyNode[]): Readonly<Record<AnyNodeId, AnyNode>> {
  return Object.fromEntries(nodes.map((n) => [n.id, n])) as Record<AnyNodeId, AnyNode>
}

describe('collectZoneObjectIds', () => {
  /**
   * The defect this function exists for: a zone full of racking reported
   * nothing inside it, because the only positioned kind the delete path knows
   * is `item` and a rack is `warehouse:pallet-rack`.
   */
  test('finds plugin-contributed kinds, not only item nodes', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      positioned('rack_1', 'warehouse:pallet-rack', 5, 5),
      positioned('item_1', 'item', 6, 6),
    )

    const found = collectZoneObjectIds(scene, zone)
    expect(found).toContain('rack_1' as AnyNodeId)
    expect(found).toContain('item_1' as AnyNodeId)

    // The delete path sees the item and misses the rack — the discrepancy this
    // function was added to work around rather than silently widen.
    expect(collectZoneContentIds(scene, zone)).not.toContain('rack_1' as AnyNodeId)
  })

  test('excludes objects standing outside the polygon', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      positioned('inside', 'warehouse:pallet', 1, 1),
      positioned('outside', 'warehouse:pallet', 40, 40),
    )
    const found = collectZoneObjectIds(scene, zone)
    expect(found).toContain('inside' as AnyNodeId)
    expect(found).not.toContain('outside' as AnyNodeId)
  })

  test('excludes objects on another level', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      positioned('here', 'warehouse:pallet', 5, 5),
      positioned('upstairs', 'warehouse:pallet', 5, 5, 'level_2'),
    )
    const found = collectZoneObjectIds(scene, zone)
    expect(found).toEqual(['here' as AnyNodeId])
  })

  /** A zone is not standing inside itself, and neither is its own fabric. */
  test('excludes the zone fabric and other zones', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      positioned('other_zone', 'zone', 5, 5),
      positioned('a_wall', 'wall', 5, 5),
      positioned('a_slab', 'slab', 5, 5),
      positioned('a_rack', 'warehouse:pallet-rack', 5, 5),
    )
    expect(collectZoneObjectIds(scene, zone)).toEqual(['a_rack' as AnyNodeId])
  })

  test('a node without a usable position is skipped rather than throwing', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      { id: 'no_pos', type: 'warehouse:pallet', parentId: 'level_1' } as unknown as AnyNode,
      positioned('ok', 'warehouse:pallet', 5, 5),
    )
    expect(collectZoneObjectIds(scene, zone)).toEqual(['ok' as AnyNodeId])
  })
})

describe('collectZoneObjectLabels', () => {
  // Read widened: a plugin kind is not in `AnyNode['type']`, which is the whole
  // reason a zone full of racking looked empty before `collectZoneObjectIds`.
  const displayName = (node: AnyNode) =>
    (node.type as string) === 'warehouse:pallet-rack' ? 'Pallet Rack' : ''

  test('one label per node standing in the zone', () => {
    const scene = sceneOf(
      positioned('a', 'warehouse:pallet-rack', 2, 2),
      positioned('b', 'warehouse:pallet-rack', 3, 3),
      positioned('c', 'item', 4, 4),
      positioned('far', 'warehouse:pallet-rack', 90, 90),
    )

    expect(collectZoneObjectLabels(scene, zone, displayName)).toEqual([
      'Pallet Rack',
      'Pallet Rack',
      'item',
    ])
  })

  /**
   * THE reason this returns strings.
   *
   * The panel reads it through `useShallow`, which compares elements with
   * `Object.is`. When the selector built `{ label, count }` objects, two calls
   * over an identical scene were never shallow-equal, so every render reported
   * a changed snapshot and React never settled — error 185, and the editor went
   * down the moment a zone panel opened. Nothing about the rendered output
   * catches that; only the stability of the value does.
   */
  test('two calls over an unchanged scene are shallow-equal', () => {
    const scene = sceneOf(
      positioned('a', 'warehouse:pallet-rack', 2, 2),
      positioned('b', 'warehouse:pallet-rack', 3, 3),
      positioned('c', 'item', 4, 4),
    )

    expect(
      shallow(
        collectZoneObjectLabels(scene, zone, displayName),
        collectZoneObjectLabels(scene, zone, displayName),
      ),
    ).toBe(true)
  })

  test('a moved node makes it shallow-UNequal, so the panel still updates', () => {
    const before = sceneOf(positioned('a', 'warehouse:pallet-rack', 2, 2))
    const after = sceneOf(positioned('a', 'warehouse:pallet-rack', 90, 90))

    expect(
      shallow(
        collectZoneObjectLabels(before, zone, displayName),
        collectZoneObjectLabels(after, zone, displayName),
      ),
    ).toBe(false)
  })
})

describe('resolveZoneTakeoffReports', () => {
  beforeEach(() => {
    nodeRegistry._reset()
  })

  /**
   * Domain-accurate warehouse takeoff extension implementation for testing
   * host integration, takeoff resolution, and boundary filtering.
   */
  const warehouseExtension: ZoneTakeoffExtension = {
    id: 'pascal:warehouse:zone-takeoff',
    pluginId: 'ovurrsl:warehouse',
    supportsZone({ contentIds, nodes }) {
      if (!contentIds || contentIds.length === 0) return false
      return contentIds.some((id) => {
        const type = (nodes[id] as { type?: unknown })?.type
        return typeof type === 'string' && type.startsWith('warehouse:')
      })
    },
    deriveTakeoff({ zone, contentIds, nodes }) {
      let bays = 0
      let levels = 0
      let palletCapacity = 0
      let directAccess = 0
      let pickingCapacity = 0

      let palletRackBays = 0
      let driveInLanes = 0
      let liveRackChannels = 0
      let longspanBays = 0
      let m3Bays = 0
      let floorPallets = 0
      let mezzanines = 0

      for (const id of contentIds) {
        const node = nodes[id] as any
        if (!node || typeof node.type !== 'string' || !node.type.startsWith('warehouse:')) {
          continue
        }

        switch (node.type) {
          case 'warehouse:pallet-rack': {
            const b = node.bays ?? 1
            const lvls = node.levels ?? 4
            const slotsPerBayLevel = node.slotsPerBayLevel ?? 3
            palletRackBays += b
            bays += b
            levels += lvls
            const slots = b * lvls * slotsPerBayLevel
            palletCapacity += slots
            directAccess += slots
            if (node.pickingSlots) {
              pickingCapacity += node.pickingSlots
            }
            break
          }
          case 'warehouse:drive-in-rack': {
            const lanes = node.lanes ?? 1
            const lvls = node.levels ?? 4
            const depth = node.depthPallets ?? 5
            driveInLanes += lanes
            bays += lanes
            levels += lvls
            const slots = lanes * lvls * depth
            palletCapacity += slots
            directAccess += lanes * lvls
            break
          }
          case 'warehouse:live-rack': {
            const channels = node.channels ?? 1
            const lvls = node.levels ?? 3
            const depth = node.depthPallets ?? 4
            liveRackChannels += channels
            bays += channels
            levels += lvls
            palletCapacity += channels * lvls * depth
            directAccess += channels * lvls
            break
          }
          case 'warehouse:longspan-rack': {
            const b = node.bays ?? 1
            const lvls = node.levels ?? 4
            longspanBays += b
            bays += b
            levels += lvls
            pickingCapacity += b * lvls * 10
            break
          }
          case 'warehouse:m3-rack': {
            const b = node.bays ?? 1
            const lvls = node.levels ?? 5
            const drawers = node.drawers ?? 8
            m3Bays += b
            bays += b
            levels += lvls
            pickingCapacity += drawers
            break
          }
          case 'warehouse:mezzanine': {
            mezzanines += 1
            break
          }
          case 'warehouse:pallet': {
            floorPallets += 1
            palletCapacity += 1
            directAccess += 1
            break
          }
          case 'warehouse:tote-cart': {
            const cap = node.capacity ?? 4
            pickingCapacity += cap
            break
          }
        }
      }

      if (bays === 0 && palletCapacity === 0 && pickingCapacity === 0 && floorPallets === 0 && mezzanines === 0) {
        return null
      }

      return {
        id: `${zone.id}:warehouse-takeoff`,
        title: 'Warehouse storage takeoff',
        metrics: [
          {
            key: 'total-bays',
            label: 'Storage Bays',
            value: bays,
            abbreviation: 'Bays',
            sublabel: `${bays} storage bays`,
          },
          {
            key: 'total-levels',
            label: 'Storage Levels',
            value: levels,
            abbreviation: 'Lvls',
            sublabel: 'Beams & shelves',
          },
          {
            key: 'pallet-capacity',
            label: 'Pallet Capacity',
            value: palletCapacity,
            abbreviation: 'Pallets',
            sublabel: `${directAccess} direct access`,
          },
          {
            key: 'picking-capacity',
            label: 'Carton / Picking',
            value: pickingCapacity,
            abbreviation: 'Pick',
            sublabel: 'Carton & tote slots',
          },
        ],
        breakdown: [
          ...(palletRackBays > 0
            ? [{ id: 'selective-pallet-rack', label: 'Selective Pallet Rack', count: palletRackBays }]
            : []),
          ...(driveInLanes > 0
            ? [{ id: 'drive-in-rack', label: 'Drive-In Rack', count: driveInLanes }]
            : []),
          ...(liveRackChannels > 0
            ? [{ id: 'live-rack', label: 'Live Dynamic Racking', count: liveRackChannels }]
            : []),
          ...(longspanBays > 0
            ? [{ id: 'longspan-shelving', label: 'Longspan M7 Shelving', count: longspanBays }]
            : []),
          ...(m3Bays > 0
            ? [{ id: 'm3-shelving', label: 'M3 Picking Shelving', count: m3Bays }]
            : []),
          ...(floorPallets > 0
            ? [{ id: 'floor-pallets', label: 'Floor Pallet Staging', count: floorPallets }]
            : []),
          ...(mezzanines > 0
            ? [{ id: 'mezzanines', label: 'Mezzanine Raised Platforms', count: mezzanines }]
            : []),
        ],
      }
    },
  }

  test('returns stable EMPTY_TAKEOFF_REPORTS when no extensions are active', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      positioned('rack_1', 'warehouse:pallet-rack', 5, 5),
    )
    const reports1 = resolveZoneTakeoffReports(scene, zone)
    const reports2 = resolveZoneTakeoffReports(scene, zone)

    expect(reports1).toEqual([])
    expect(reports2).toEqual([])
    expect(reports1).toBe(reports2) // Stable empty array reference
  })

  test('returns stable EMPTY_TAKEOFF_REPORTS when zone has no warehouse objects', () => {
    registerZoneTakeoffExtension(warehouseExtension)
    const scene = sceneOf(
      zone as unknown as AnyNode,
      positioned('item_1', 'item', 5, 5),
    )
    const reports = resolveZoneTakeoffReports(scene, zone)
    expect(reports).toEqual([])
  })

  test('resolves detailed warehouse metrics (bays, levels, pallet/carton capacities) for rack nodes', () => {
    registerZoneTakeoffExtension(warehouseExtension)

    const scene = sceneOf(
      zone as unknown as AnyNode,
      positioned('rack_1', 'warehouse:pallet-rack', 3, 3, 'level_1', {
        bays: 4,
        levels: 5,
        slotsPerBayLevel: 3, // 4 * 5 * 3 = 60 pallets
        pickingSlots: 12,
      }),
      positioned('drivein_1', 'warehouse:drive-in-rack', 7, 7, 'level_1', {
        lanes: 2,
        levels: 4,
        depthPallets: 5, // 2 * 4 * 5 = 40 pallets
      }),
    )

    const reports = resolveZoneTakeoffReports(scene, zone)
    expect(reports).toHaveLength(1)

    const report = reports[0]!
    expect(report.id).toBe('zone_a:warehouse-takeoff')
    expect(report.title).toBe('Warehouse storage takeoff')

    // Bays: 4 (pallet rack) + 2 (drive in lanes) = 6 bays
    const baysMetric = report.metrics.find((m) => m.key === 'total-bays')
    expect(baysMetric?.value).toBe(6)

    // Levels: 5 (pallet rack) + 4 (drive in) = 9 levels
    const levelsMetric = report.metrics.find((m) => m.key === 'total-levels')
    expect(levelsMetric?.value).toBe(9)

    // Pallet capacity: 60 + 40 = 100 pallet positions
    const palletMetric = report.metrics.find((m) => m.key === 'pallet-capacity')
    expect(palletMetric?.value).toBe(100)

    // Picking slots: 12
    const pickMetric = report.metrics.find((m) => m.key === 'picking-capacity')
    expect(pickMetric?.value).toBe(12)

    // Breakdown includes both rack kinds with exact counts
    expect(report.breakdown).toBeDefined()
    expect(report.breakdown?.find((b) => b.id === 'selective-pallet-rack')?.count).toBe(4)
    expect(report.breakdown?.find((b) => b.id === 'drive-in-rack')?.count).toBe(2)
  })

  test('resolves mixed multi-equipment takeoff: live-rack, longspan, m3, mezzanine, floor pallet, tote cart', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      positioned('live_1', 'warehouse:live-rack', 2, 2, 'level_1', {
        channels: 3,
        levels: 4,
        depthPallets: 5, // 3 * 4 * 5 = 60 pallets
      }),
      positioned('longspan_1', 'warehouse:longspan-rack', 4, 4, 'level_1', {
        bays: 2,
        levels: 4, // 2 * 4 * 10 = 80 picking items
      }),
      positioned('m3_1', 'warehouse:m3-rack', 6, 6, 'level_1', {
        bays: 3,
        levels: 6,
        drawers: 24, // 24 drawers
      }),
      positioned('pallet_1', 'warehouse:pallet', 8, 2, 'level_1'),
      positioned('cart_1', 'warehouse:tote-cart', 8, 4, 'level_1', { capacity: 6 }),
      positioned('mezz_1', 'warehouse:mezzanine', 8, 8, 'level_1'),
    )

    const reports = resolveZoneTakeoffReports(scene, zone, [warehouseExtension])
    expect(reports).toHaveLength(1)

    const report = reports[0]!
    // Bays: 3 (live) + 2 (longspan) + 3 (m3) = 8 bays
    expect(report.metrics.find((m) => m.key === 'total-bays')?.value).toBe(8)
    // Levels: 4 + 4 + 6 = 14 levels
    expect(report.metrics.find((m) => m.key === 'total-levels')?.value).toBe(14)
    // Pallet capacity: 60 (live) + 1 (floor pallet) = 61 pallets
    expect(report.metrics.find((m) => m.key === 'pallet-capacity')?.value).toBe(61)
    // Picking capacity: 80 (longspan) + 24 (m3 drawers) + 6 (tote cart) = 110 picking slots
    expect(report.metrics.find((m) => m.key === 'picking-capacity')?.value).toBe(110)

    // Breakdown includes all categories
    const breakdownIds = report.breakdown?.map((b) => b.id)
    expect(breakdownIds).toContain('live-rack')
    expect(breakdownIds).toContain('longspan-shelving')
    expect(breakdownIds).toContain('m3-shelving')
    expect(breakdownIds).toContain('floor-pallets')
    expect(breakdownIds).toContain('mezzanines')
  })

  test('excludes objects outside the zone polygon from takeoff calculation', () => {
    registerZoneTakeoffExtension(warehouseExtension)

    const scene = sceneOf(
      zone as unknown as AnyNode,
      // Inside zone (0..10, 0..10)
      positioned('inside_rack', 'warehouse:pallet-rack', 5, 5, 'level_1', {
        bays: 2,
        levels: 4,
        slotsPerBayLevel: 2, // 16 pallets
      }),
      // Outside zone polygon
      positioned('outside_rack', 'warehouse:pallet-rack', 50, 50, 'level_1', {
        bays: 10,
        levels: 10,
        slotsPerBayLevel: 3, // 300 pallets
      }),
      positioned('outside_pallet', 'warehouse:pallet', 100, 100, 'level_1'),
    )

    const reports = resolveZoneTakeoffReports(scene, zone)
    expect(reports).toHaveLength(1)

    const report = reports[0]!
    // Only inside_rack (2 bays, 16 pallets) is counted; outside racks are completely excluded
    expect(report.metrics.find((m) => m.key === 'total-bays')?.value).toBe(2)
    expect(report.metrics.find((m) => m.key === 'pallet-capacity')?.value).toBe(16)
    expect(report.breakdown?.find((b) => b.id === 'selective-pallet-rack')?.count).toBe(2)
    expect(report.breakdown?.find((b) => b.id === 'floor-pallets')).toBeUndefined()
  })

  test('excludes objects on different parent levels from takeoff calculation', () => {
    registerZoneTakeoffExtension(warehouseExtension)

    const scene = sceneOf(
      zone as unknown as AnyNode,
      // On level_1 (matching zone.parentId)
      positioned('level1_rack', 'warehouse:pallet-rack', 5, 5, 'level_1', {
        bays: 3,
        levels: 4,
        slotsPerBayLevel: 2, // 24 pallets
      }),
      // On level_2 (different level)
      positioned('level2_rack', 'warehouse:pallet-rack', 5, 5, 'level_2', {
        bays: 8,
        levels: 5,
        slotsPerBayLevel: 3, // 120 pallets
      }),
    )

    const reports = resolveZoneTakeoffReports(scene, zone)
    expect(reports).toHaveLength(1)

    const report = reports[0]!
    expect(report.metrics.find((m) => m.key === 'total-bays')?.value).toBe(3)
    expect(report.metrics.find((m) => m.key === 'pallet-capacity')?.value).toBe(24)
  })

  test('excludes zone fabric nodes (wall, slab, ceiling, zone) from takeoff calculation', () => {
    registerZoneTakeoffExtension(warehouseExtension)

    const scene = sceneOf(
      zone as unknown as AnyNode,
      positioned('wall_1', 'wall', 5, 5),
      positioned('slab_1', 'slab', 5, 5),
      positioned('ceiling_1', 'ceiling', 5, 5),
      positioned('zone_2', 'zone', 5, 5),
      positioned('rack_1', 'warehouse:pallet-rack', 5, 5, 'level_1', {
        bays: 2,
        levels: 3,
        slotsPerBayLevel: 2, // 12 pallets
      }),
    )

    const reports = resolveZoneTakeoffReports(scene, zone)
    expect(reports).toHaveLength(1)
    expect(reports[0]?.metrics.find((m) => m.key === 'total-bays')?.value).toBe(2)
  })

  /**
   * Shallow equality and render stability test to guard against React 185 render loops.
   */
  test('preserves reference and shallow equality stability across multiple evaluations of unchanged scene', () => {
    registerZoneTakeoffExtension(warehouseExtension)

    const scene = sceneOf(
      zone as unknown as AnyNode,
      positioned('rack_1', 'warehouse:pallet-rack', 4, 4, 'level_1', {
        bays: 2,
        levels: 4,
        slotsPerBayLevel: 2,
      }),
      positioned('m3_1', 'warehouse:m3-rack', 6, 6, 'level_1', {
        bays: 1,
        levels: 4,
        drawers: 8,
      }),
    )

    const run1 = resolveZoneTakeoffReports(scene, zone)
    const run2 = resolveZoneTakeoffReports(scene, zone)

    // Deep equality of reports across evaluations
    expect(run1).toEqual(run2)
    expect(run1[0]?.metrics).toEqual(run2[0]?.metrics)
    expect(run1[0]?.breakdown).toEqual(run2[0]?.breakdown)

    // Metric keys and values match exactly
    const metricKeys1 = run1[0]?.metrics.map((m) => `${m.key}:${m.value}`)
    const metricKeys2 = run2[0]?.metrics.map((m) => `${m.key}:${m.value}`)
    expect(shallow(metricKeys1, metricKeys2)).toBe(true)

    // Empty scene yields identical reference for EMPTY_TAKEOFF_REPORTS
    const emptyScene = sceneOf(zone as unknown as AnyNode)
    const emptyRun1 = resolveZoneTakeoffReports(emptyScene, zone)
    const emptyRun2 = resolveZoneTakeoffReports(emptyScene, zone)
    expect(emptyRun1).toBe(emptyRun2)
    expect(shallow(emptyRun1, emptyRun2)).toBe(true)
  })

  test('scene mutation properly changes report and breaks shallow equality for reactivity', () => {
    registerZoneTakeoffExtension(warehouseExtension)

    const before = sceneOf(
      zone as unknown as AnyNode,
      positioned('rack_1', 'warehouse:pallet-rack', 4, 4, 'level_1', {
        bays: 2,
        levels: 4,
        slotsPerBayLevel: 2,
      }),
    )
    // Move rack outside the zone
    const after = sceneOf(
      zone as unknown as AnyNode,
      positioned('rack_1', 'warehouse:pallet-rack', 99, 99, 'level_1', {
        bays: 2,
        levels: 4,
        slotsPerBayLevel: 2,
      }),
    )

    const reportsBefore = resolveZoneTakeoffReports(before, zone)
    const reportsAfter = resolveZoneTakeoffReports(after, zone)

    expect(reportsBefore).toHaveLength(1)
    expect(reportsAfter).toHaveLength(0)
    expect(shallow(reportsBefore, reportsAfter)).toBe(false)
  })
})

