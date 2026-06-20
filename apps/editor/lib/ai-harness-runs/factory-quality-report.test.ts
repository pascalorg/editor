import { describe, expect, test } from 'bun:test'
import { ItemNode, PipeNode, ZoneNode } from '@pascal-app/core/schema'
import { evaluateFactoryQuality } from './factory-quality-report'
import type { FactoryPlan } from './factory-planner'
import type { FactoryScenePatch } from './factory-runner'

function itemPatch(src: string): FactoryScenePatch {
  return {
    op: 'create',
    node: ItemNode.parse({
      id: 'item_quality_asset',
      name: 'catalog equipment',
      asset: {
        id: 'factory-electric-box',
        category: 'factory',
        name: 'Electric box',
        thumbnail: '/items/factory-electric-box/thumbnail.png',
        src,
        dimensions: [1, 1, 1],
      },
    }),
  }
}

function equipmentItemPatch(id: string, stationId: string, name = stationId): FactoryScenePatch {
  return {
    op: 'create',
    node: ItemNode.parse({
      id,
      name,
      metadata: { stationId },
      asset: {
        id: 'factory-electric-box',
        category: 'factory',
        name: 'Electric box',
        thumbnail: '/items/factory-electric-box/thumbnail.png',
        src: '/items/factory-electric-box/model.glb',
        dimensions: [1, 1, 1],
      },
    }),
  }
}

function processPlan(): Extract<FactoryPlan, { kind: 'process_line' }> {
  return {
    kind: 'process_line',
    reason: 'test process line',
    process: {
      processLabel: 'Test line',
      domain: 'chemical',
      layoutStyle: 'linear',
      stations: [
        {
          id: 'feed',
          label: 'Feed',
          displayLabel: '\u8fdb\u6599',
          role: 'feed',
          equipmentHint: 'feed tank',
        },
        {
          id: 'reactor',
          label: 'Reactor',
          displayLabel: '\u53cd\u5e94\u5668',
          role: 'reactor',
          equipmentHint: 'reactor',
        },
      ],
      connections: [
        {
          fromStationId: 'feed',
          toStationId: 'reactor',
          visualKind: 'pipe',
          medium: 'material',
          fromPortId: 'outlet',
          toPortId: 'inlet',
        },
      ],
    },
  }
}

describe('evaluateFactoryQuality', () => {
  test('passes when catalog items point at hosted local assets', () => {
    const report = evaluateFactoryQuality({
      patches: [itemPatch('/items/factory-electric-box/model.glb')],
      missingAssets: [],
    })

    expect(report.passed).toBe(true)
    expect(report.score).toBe(100)
    expect(report.checks.catalogItemCount).toBe(1)
    expect(report.checks.localAssetCount).toBe(1)
    expect(report.issues.map((issue) => issue.code)).not.toContain('catalog_asset_not_found')
  })

  test('fails when a catalog item references a missing hosted asset', () => {
    const report = evaluateFactoryQuality({
      patches: [itemPatch('/items/not-a-real-factory-asset/model.glb')],
      missingAssets: [],
    })

    expect(report.passed).toBe(false)
    expect(report.issueCount.error).toBe(1)
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: 'catalog_asset_not_found',
        severity: 'error',
        assetUrl: '/items/not-a-real-factory-asset/model.glb',
      }),
    )
  })

  test('detects missing process routing and unresolved station equipment', () => {
    const report = evaluateFactoryQuality({
      plan: processPlan(),
      patches: [
        {
          op: 'create',
          node: ZoneNode.parse({
            id: 'zone_feed',
            name: '\u8fdb\u6599',
            polygon: [
              [-1, -1],
              [1, -1],
              [1, 1],
              [-1, 1],
            ],
            metadata: {
              role: 'process-line-station',
              stationId: 'feed',
            },
          }),
        },
      ],
      missingAssets: [],
    })

    expect(report.passed).toBe(false)
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'process_connection_missing', severity: 'error' }),
        expect.objectContaining({ code: 'station_equipment_unresolved', stationId: 'feed' }),
        expect.objectContaining({ code: 'station_equipment_unresolved', stationId: 'reactor' }),
      ]),
    )
  })

  test('marks warning-heavy results as needing review below the score threshold', () => {
    const report = evaluateFactoryQuality({
      patches: [],
      missingAssets: [
        { name: 'optional 1', reason: 'not generated', required: false },
        { name: 'optional 2', reason: 'not generated', required: false },
        { name: 'optional 3', reason: 'not generated', required: false },
        { name: 'optional 4', reason: 'not generated', required: false },
        { name: 'optional 5', reason: 'not generated', required: false },
        { name: 'optional 6', reason: 'not generated', required: false },
      ],
    })

    expect(report.score).toBe(64)
    expect(report.passed).toBe(false)
    expect(report.summary).toBe('Factory quality needs review (64/100).')
  })

  test('counts routed process connections with aligned port ids', () => {
    const report = evaluateFactoryQuality({
      plan: processPlan(),
      patches: [
        {
          op: 'create',
          node: ZoneNode.parse({
            id: 'zone_feed',
            name: '\u8fdb\u6599',
            polygon: [
              [-1, -1],
              [1, -1],
              [1, 1],
              [-1, 1],
            ],
            metadata: {
              role: 'process-line-station',
              stationId: 'feed',
            },
          }),
        },
        {
          op: 'create',
          node: ItemNode.parse({
            id: 'item_feed',
            name: 'feed equipment',
            metadata: { stationId: 'feed' },
            asset: {
              id: 'factory-electric-box',
              category: 'factory',
              name: 'Electric box',
              thumbnail: '/items/factory-electric-box/thumbnail.png',
              src: '/items/factory-electric-box/model.glb',
              dimensions: [1, 1, 1],
            },
          }),
        },
        {
          op: 'create',
          node: ItemNode.parse({
            id: 'item_reactor',
            name: 'reactor equipment',
            metadata: { stationId: 'reactor' },
            asset: {
              id: 'factory-electric-box',
              category: 'factory',
              name: 'Electric box',
              thumbnail: '/items/factory-electric-box/thumbnail.png',
              src: '/items/factory-electric-box/model.glb',
              dimensions: [1, 1, 1],
            },
          }),
        },
        {
          op: 'create',
          node: PipeNode.parse({
            id: 'pipe_feed_reactor',
            name: 'feed to reactor',
            start: [0, 0],
            end: [4, 0],
            medium: 'water',
            metadata: {
              role: 'process-line-connection',
              fromStationId: 'feed',
              toStationId: 'reactor',
              visualKind: 'pipe',
              fromPortId: 'outlet',
              toPortId: 'inlet',
            },
          }),
        },
      ],
      missingAssets: [],
    })

    expect(report.passed).toBe(true)
    expect(report.checks.stationEquipmentCount).toBe(2)
    expect(report.checks.routedConnectionCount).toBe(1)
    expect(report.issues).toEqual([])
  })

  test('fails when a process route intersects generated primitive equipment bounds', () => {
    const report = evaluateFactoryQuality({
      plan: processPlan(),
      patches: [
        equipmentItemPatch('item_feed', 'feed'),
        equipmentItemPatch('item_reactor', 'reactor'),
        {
          op: 'create',
          node: ItemNode.parse({
            id: 'item_stack',
            name: 'process stack',
            metadata: {
              stationId: 'process_stack',
              factoryPrimitiveRouteObstacle: {
                stationId: 'process_stack',
                source: 'artifact',
                minHeight: 0,
                maxHeight: 5,
                box: { minX: 1.5, maxX: 2.5, minZ: -0.5, maxZ: 0.5 },
              },
            },
            asset: {
              id: 'factory-electric-box',
              category: 'factory',
              name: 'Electric box',
              thumbnail: '/items/factory-electric-box/thumbnail.png',
              src: '/items/factory-electric-box/model.glb',
              dimensions: [1, 1, 1],
            },
          }),
        },
        {
          op: 'create',
          node: PipeNode.parse({
            id: 'pipe_feed_reactor',
            name: 'feed to reactor',
            start: [0, 0],
            end: [4, 0],
            elevation: 1,
            medium: 'water',
            metadata: {
              role: 'process-line-connection',
              fromStationId: 'feed',
              toStationId: 'reactor',
              visualKind: 'pipe',
              fromPortId: 'outlet',
              toPortId: 'inlet',
            },
          }),
        },
      ],
      missingAssets: [],
    })

    expect(report.passed).toBe(false)
    expect(report.checks.routeCollisionCount).toBe(1)
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: 'process_route_intersects_equipment',
        stationId: 'process_stack',
        nodeId: 'pipe_feed_reactor',
      }),
    )
  })
})
