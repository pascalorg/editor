import { describe, expect, test } from 'bun:test'
import { apiGraphSchema } from '../apps/editor/lib/graph-schema'
import { MigrationError, inventory, migrateLegacyGraph } from './migrate-legacy-scene.mjs'

/**
 * Mirrors a real backup from the legacy desktop build (scene 0d18a76c12c4,
 * v17): a site → building → level chain whose building and level carry the
 * legacy writer's `parentId: null` bug, one library item, and one procedural
 * rack item — the shape every legacy scene is expected to share.
 */
function legacyGraph() {
  return {
    nodes: {
      site_a: {
        object: 'node',
        id: 'site_a',
        type: 'site',
        parentId: null,
        visible: true,
        metadata: {},
        polygon: {
          type: 'polygon',
          points: [
            [-15, -15],
            [15, -15],
            [15, 15],
            [-15, 15],
          ],
        },
        children: ['building_b'],
      },
      building_b: {
        object: 'node',
        id: 'building_b',
        type: 'building',
        parentId: null,
        visible: true,
        metadata: {},
        children: ['level_c'],
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      },
      level_c: {
        object: 'node',
        id: 'level_c',
        type: 'level',
        parentId: null,
        visible: true,
        metadata: {},
        children: ['item_lib', 'item_rack'],
        level: 0,
      },
      item_lib: {
        object: 'node',
        id: 'item_lib',
        type: 'item',
        name: 'Cactus',
        parentId: 'level_c',
        visible: true,
        metadata: { isTransient: true },
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        children: [],
        asset: {
          id: 'cactus',
          category: 'furniture',
          name: 'Cactus',
          thumbnail: 'https://byrpxoiotywskoojsrzd.supabase.co/storage/v1/object/public/items/system/cactus/thumbnail.png',
          source: 'library',
          src: 'https://byrpxoiotywskoojsrzd.supabase.co/storage/v1/object/public/items/system/cactus/model.glb',
          dimensions: [0.34, 0.39, 0.27],
          tags: ['cactus'],
          offset: [-0.0039, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      },
      item_rack: {
        object: 'node',
        id: 'item_rack',
        type: 'item',
        name: 'Rack',
        parentId: 'level_c',
        visible: true,
        metadata: { isTransient: true },
        position: [3, 0, -2],
        rotation: [0, Math.PI / 2, 0],
        scale: [1, 1, 1],
        children: [],
        asset: {
          id: 'rack',
          category: 'asset',
          name: 'Rack',
          thumbnail: '/icons/box.png',
          source: 'library',
          src: 'asset://procedural/rack',
          dimensions: [2.5, 4, 1.2],
          tags: ['floor', 'rack', 'warehouse', 'storage'],
          offset: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      },
    },
    rootNodeIds: ['site_a'],
  }
}

describe('migrateLegacyGraph', () => {
  test('converts a procedural rack item into a warehouse:pallet-rack node', () => {
    const { graph, report } = migrateLegacyGraph(legacyGraph())

    expect(graph.nodes.item_rack).toBeUndefined()
    const rack = graph.nodes['pallet-rack_rack']
    expect(rack).toMatchObject({
      type: 'warehouse:pallet-rack',
      parentId: 'level_c',
      position: [3, 0, -2],
      bayClearWidth: 2.5,
      uprightHeight: 4,
      depth: 1.2,
    })
    expect(rack.metadata.isTransient).toBeUndefined()
    expect(report.converted).toEqual([
      { from: 'item_rack', to: 'pallet-rack_rack', type: 'warehouse:pallet-rack' },
    ])
  })

  test('updates children references and repairs legacy null parentIds', () => {
    const { graph, report } = migrateLegacyGraph(legacyGraph())

    expect(graph.nodes.level_c.children).toEqual(['item_lib', 'pallet-rack_rack'])
    expect(graph.nodes.building_b.parentId).toBe('site_a')
    expect(graph.nodes.level_c.parentId).toBe('building_b')
    expect(report.repairedParentIds).toBe(2)
  })

  test('clamps out-of-range legacy dimensions into schema bounds, with a note', () => {
    const legacy = legacyGraph()
    legacy.nodes.item_rack.asset.dimensions = [8, 30, 0.1]
    const { graph, report } = migrateLegacyGraph(legacy)

    const rack = graph.nodes['pallet-rack_rack']
    expect(rack.bayClearWidth).toBe(6)
    expect(rack.uprightHeight).toBe(20)
    expect(rack.depth).toBe(0.4)
    expect(report.notes).toHaveLength(3)
  })

  test('marks the warehouse plugin installed once a warehouse node exists', () => {
    const { graph } = migrateLegacyGraph(legacyGraph())
    expect(graph.installedPlugins).toEqual(['ovurrsl:warehouse'])
  })

  test('stops on an unmapped procedural kind instead of skipping the node', () => {
    const legacy = legacyGraph()
    legacy.nodes.item_rack.asset.src = 'asset://procedural/antigravity-shelf'

    expect(() => migrateLegacyGraph(legacy)).toThrow(MigrationError)
    try {
      migrateLegacyGraph(legacy)
    } catch (error) {
      expect((error as MigrationError).details).toEqual([
        { id: 'item_rack', src: 'asset://procedural/antigravity-shelf', name: 'Rack' },
      ])
    }
  })

  test('--drop-transient removes flagged nodes and their references', () => {
    const { graph, report } = migrateLegacyGraph(legacyGraph(), { dropTransient: true })

    expect(report.droppedTransient.sort()).toEqual(['item_lib', 'item_rack'])
    expect(graph.nodes.level_c.children).toEqual([])
    expect(report.converted).toHaveLength(0)
  })

  test('migrated graph passes the exact schema the API enforces', () => {
    const { graph } = migrateLegacyGraph(legacyGraph())
    const result = apiGraphSchema.safeParse(graph)
    expect(result.success).toBe(true)
  })

  test('converts the late-vintage library equipment handles', () => {
    const legacy = legacyGraph()
    legacy.nodes.item_rack.asset.src = 'asset://rack'
    legacy.nodes.item_lib.asset = {
      ...legacy.nodes.item_lib.asset,
      id: 'loaded-euro-pallet',
      src: 'asset://loaded-euro-pallet',
      dimensions: [0.8, 1.15, 1.2],
    }
    legacy.nodes.item_conv = {
      ...structuredClone(legacy.nodes.item_rack),
      id: 'item_conv',
      name: 'Flat Wire Mesh Conveyor',
      asset: { id: 'flat-wire-mesh-conveyor', src: 'asset://flat-wire-mesh-conveyor', dimensions: [7.3, 0.8, 0.6] },
    }
    legacy.nodes.level_c.children.push('item_conv')

    const { graph, report } = migrateLegacyGraph(legacy)

    expect(graph.nodes['pallet-rack_rack'].type).toBe('warehouse:pallet-rack')
    expect(graph.nodes.pallet_lib).toMatchObject({ type: 'warehouse:pallet', preset: 'epal-1', cargo: 'carton' })
    expect(graph.nodes['conveyor-roller_conv']).toMatchObject({
      type: 'warehouse:conveyor-roller',
      rollerPitch: '100',
      rollers: 73,
      transportHeight: 0.6,
    })
    expect(report.converted).toHaveLength(3)
    expect(apiGraphSchema.safeParse(graph).success).toBe(true)
  })

  test('renames legacy warehouse id prefixes the current schema refuses', () => {
    const legacy = legacyGraph()
    legacy.nodes.palletrack_x = {
      object: 'node',
      id: 'palletrack_x',
      type: 'warehouse:pallet-rack',
      parentId: 'level_c',
      visible: true,
      metadata: {},
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    }
    legacy.nodes.level_c.children.push('palletrack_x')

    const { graph, report } = migrateLegacyGraph(legacy)

    expect(graph.nodes.palletrack_x).toBeUndefined()
    expect(graph.nodes['pallet-rack_x'].type).toBe('warehouse:pallet-rack')
    expect(graph.nodes.level_c.children).toContain('pallet-rack_x')
    expect(report.renamedIds).toBe(1)
    expect(apiGraphSchema.safeParse(graph).success).toBe(true)
  })

  test('keeps unmapped asset:// items but reports them as invisible', () => {
    const legacy = legacyGraph()
    legacy.nodes.item_rack.asset.src = 'asset://dispatch-packing-table'

    const { graph, report } = migrateLegacyGraph(legacy)

    expect(graph.nodes.item_rack.asset.src).toBe('asset://dispatch-packing-table')
    expect(report.invisible).toEqual([
      { id: 'item_rack', src: 'asset://dispatch-packing-table', name: 'Rack' },
    ])
  })
})

describe('inventory', () => {
  test('counts node types and procedural kinds separately', () => {
    expect(inventory(legacyGraph())).toEqual({
      site: 1,
      building: 1,
      level: 1,
      item: 1,
      'item → asset://procedural/rack': 1,
    })
  })
})
