import { describe, expect, test } from 'bun:test'
import { calculateWarehouseBOM, generateWarehouseBomPdf } from '@ovurrsl/plugin-warehouse'
import { type AnyNode, ZoneNode } from '@pascal-app/core'
import { collectZoneObjectIds } from '@pascal-app/editor'

describe('Zone BOM Export Action Wiring', () => {
  const zoneA = ZoneNode.parse({
    id: 'zone_a',
    name: 'Pallet Storage A',
    parentId: 'level_1',
    polygon: [
      [0, 0],
      [20, 0],
      [20, 20],
      [0, 20],
    ],
  })

  const zoneB = ZoneNode.parse({
    id: 'zone_b',
    name: 'Mezzanine B',
    parentId: 'level_1',
    polygon: [
      [30, 0],
      [50, 0],
      [50, 20],
      [30, 20],
    ],
  })

  const sceneNodes: Record<string, AnyNode> = {
    zone_a: zoneA as unknown as AnyNode,
    zone_b: zoneB as unknown as AnyNode,
    // Rack inside Zone A
    pallet_rack_a1: {
      id: 'pallet_rack_a1',
      type: 'warehouse:pallet-rack',
      parentId: 'level_1',
      position: [10, 0, 10],
      rotation: [0, 0, 0],
      bayClearWidth: 2.7,
      depth: 1.1,
      uprightHeight: 7.0,
      uprightWidth: 0.09,
      uprightDepth: 0.08,
      beamThickness: 0.05,
      beamHeight: 0.12,
      firstLevelClear: 1.2,
      levelClear: 1.2,
      levels: 4,
      depthPositions: 1,
      decking: 'wire-mesh',
      bracing: 'z-bracing',
    } as unknown as AnyNode,
    // Another rack inside Zone A
    pallet_rack_a2: {
      id: 'pallet_rack_a2',
      type: 'warehouse:pallet-rack',
      parentId: 'level_1',
      position: [14, 0, 10],
      rotation: [0, 0, 0],
      bayClearWidth: 2.7,
      depth: 1.1,
      uprightHeight: 7.0,
      uprightWidth: 0.09,
      uprightDepth: 0.08,
      beamThickness: 0.05,
      beamHeight: 0.12,
      firstLevelClear: 1.2,
      levelClear: 1.2,
      levels: 4,
      depthPositions: 1,
      decking: 'wire-mesh',
      bracing: 'z-bracing',
    } as unknown as AnyNode,
    // Mezzanine inside Zone B
    mezzanine_b1: {
      id: 'mezzanine_b1',
      type: 'warehouse:mezzanine',
      parentId: 'level_1',
      position: [40, 0, 10],
      rotation: [0, 0, 0],
      polygon: [
        [35, 5],
        [45, 5],
        [45, 15],
        [35, 15],
      ],
      grid: {
        baysX: 2,
        baysY: 2,
        bayWidthM: 5.0,
        bayDepthM: 5.0,
      },
      tiers: [
        {
          index: 0,
          elevationM: 'auto',
          clearHeightM: 3.0,
          loadClass: 500,
          floorType: 'WOOD_CHIPBOARD_30',
          accessories: {
            staircases: [],
            swingGates: [],
            upAndOverGates: [],
            safetyZones: [],
          },
        },
      ],
    } as unknown as AnyNode,
    // Rack outside any zone
    pallet_rack_outside: {
      id: 'pallet_rack_outside',
      type: 'warehouse:pallet-rack',
      parentId: 'level_1',
      position: [100, 0, 100],
      rotation: [0, 0, 0],
      bayClearWidth: 2.7,
      depth: 1.1,
      uprightHeight: 7.0,
      levels: 4,
    } as unknown as AnyNode,
  }

  test('collectZoneObjectIds accurately extracts objects standing in zone', () => {
    const zoneAIds = collectZoneObjectIds(sceneNodes, zoneA)
    expect(zoneAIds).toContain('pallet_rack_a1')
    expect(zoneAIds).toContain('pallet_rack_a2')
    expect(zoneAIds).not.toContain('mezzanine_b1')
    expect(zoneAIds).not.toContain('pallet_rack_outside')
    expect(zoneAIds).toHaveLength(2)

    const zoneBIds = collectZoneObjectIds(sceneNodes, zoneB)
    expect(zoneBIds).toContain('mezzanine_b1')
    expect(zoneBIds).not.toContain('pallet_rack_a1')
    expect(zoneBIds).toHaveLength(1)
  })

  test('calculates zone-scoped BOM with filterNodeIds and metadata', () => {
    const contentIds = collectZoneObjectIds(sceneNodes, zoneA)
    const bomA = calculateWarehouseBOM(sceneNodes, {
      filterNodeIds: contentIds,
      zoneName: zoneA.name,
      scopeLabel: `Zone ${zoneA.name}`,
    })

    expect(bomA.zoneName).toBe('Pallet Storage A')
    expect(bomA.scopeLabel).toBe('Zone Pallet Storage A')
    expect(bomA.sections.some((s) => s.id === 'selective-pallet-racks')).toBe(true)
    expect(bomA.sections.some((s) => s.id === 'mezzanines')).toBe(false)
    expect(bomA.totalPartsCount).toBeGreaterThan(0)
  })

  test('generates valid binary PDF buffer from zone BOM without errors', async () => {
    const contentIds = collectZoneObjectIds(sceneNodes, zoneA)
    const bomA = calculateWarehouseBOM(sceneNodes, {
      filterNodeIds: contentIds,
      zoneName: zoneA.name,
      scopeLabel: `Zone ${zoneA.name}`,
    })

    const pdfBytes = await generateWarehouseBomPdf(bomA)
    expect(pdfBytes).toBeDefined()
    expect(pdfBytes.length).toBeGreaterThan(500)

    // PDF magic bytes %PDF- (0x25 0x50 0x44 0x46 0x2D)
    expect(pdfBytes[0]).toBe(0x25)
    expect(pdfBytes[1]).toBe(0x50)
    expect(pdfBytes[2]).toBe(0x44)
    expect(pdfBytes[3]).toBe(0x46)
    expect(pdfBytes[4]).toBe(0x2d)

    // Check that Zone title was encoded into PDF stream
    const pdfText = Buffer.from(pdfBytes).toString('latin1')
    expect(pdfText).toContain('Pallet Storage A')
  })

  test('calculates global warehouse BOM vs zone-scoped BOM', () => {
    const globalBom = calculateWarehouseBOM(sceneNodes, {
      scopeLabel: 'Total Warehouse',
    })

    expect(globalBom.scopeLabel).toBe('Total Warehouse')
    expect(globalBom.zoneName).toBeUndefined()
    expect(globalBom.sections.some((s) => s.id === 'selective-pallet-racks')).toBe(true)
    expect(globalBom.sections.some((s) => s.id === 'mezzanine-structures')).toBe(true)
    expect(globalBom.totalPartsCount).toBeGreaterThan(0)

    const contentIdsA = collectZoneObjectIds(sceneNodes, zoneA)
    const zoneBomA = calculateWarehouseBOM(sceneNodes, {
      filterNodeIds: contentIdsA,
      zoneName: zoneA.name,
      scopeLabel: `Zone ${zoneA.name}`,
    })

    // Global BOM contains both Zone A racks, Zone B mezzanine, and outside rack
    expect(globalBom.totalPartsCount).toBeGreaterThan(zoneBomA.totalPartsCount)
  })
})
