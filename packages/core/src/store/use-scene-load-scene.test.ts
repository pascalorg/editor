import { beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNodeId, createBoxBlockTopology } from '../schema'
import useScene from './use-scene'

describe('loadScene default scene', () => {
  beforeEach(() => {
    useScene.setState({
      nodes: {},
      rootNodeIds: [],
      dirtyNodes: new Set(),
      collections: {},
    } as never)
    useScene.temporal.getState().clear()
  })

  test('links every default node to its parent', () => {
    useScene.getState().loadScene()

    const { nodes, rootNodeIds } = useScene.getState()
    const site = Object.values(nodes).find((node) => node.type === 'site')
    const building = Object.values(nodes).find((node) => node.type === 'building')
    const level = Object.values(nodes).find((node) => node.type === 'level')

    expect(site).toBeDefined()
    expect(building).toBeDefined()
    expect(level).toBeDefined()
    expect(rootNodeIds).toEqual([site?.id])

    // The hosted scene authority validates parent/child symmetry; a default
    // scene saved as-is must already satisfy it.
    expect(site?.parentId).toBeNull()
    expect(building?.parentId).toBe(site?.id as never)
    expect(level?.parentId).toBe(building?.id as never)
    expect(site && 'children' in site ? site.children : []).toEqual([building?.id])
    expect(building && 'children' in building ? building.children : []).toEqual([level?.id])
  })

  test('migrates legacy custom-mesh nodes to blocks', () => {
    useScene.getState().setScene(
      {
        site_legacy: {
          object: 'node',
          id: 'site_legacy',
          type: 'site',
          parentId: null,
          visible: true,
          metadata: {},
          children: ['building_legacy'],
        },
        building_legacy: {
          object: 'node',
          id: 'building_legacy',
          type: 'building',
          parentId: 'site_legacy',
          visible: true,
          metadata: {},
          children: ['level_legacy'],
        },
        level_legacy: {
          object: 'node',
          id: 'level_legacy',
          type: 'level',
          parentId: 'building_legacy',
          visible: true,
          metadata: {},
          children: ['custom-mesh_legacy'],
          level: 0,
          height: 3,
        },
        'custom-mesh_legacy': {
          object: 'node',
          id: 'custom-mesh_legacy',
          type: 'custom-mesh',
          parentId: 'level_legacy',
          visible: true,
          metadata: {},
          children: ['item_legacy'],
          position: [0, 0, 0],
          rotation: 0,
          topology: createBoxBlockTopology(),
          slots: {},
          slotNames: { body: 'Body' },
        },
        item_legacy: {
          object: 'node',
          id: 'item_legacy',
          type: 'item',
          parentId: 'custom-mesh_legacy',
          visible: true,
          metadata: {},
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          children: [],
          customMeshFaceId: 'f-top',
          asset: {
            id: 'asset_legacy',
            category: 'test',
            name: 'Legacy item',
            thumbnail: '/thumbnail.webp',
            src: '/model.glb',
            dimensions: [1, 1, 1],
          },
        },
      } as never,
      ['site_legacy' as AnyNodeId],
    )

    const { nodes } = useScene.getState()
    expect(nodes['custom-mesh_legacy' as AnyNodeId]).toBeUndefined()
    expect(nodes['block_legacy' as AnyNodeId]?.type).toBe('block')
    expect(
      nodes.level_legacy && 'children' in nodes.level_legacy ? nodes.level_legacy.children : [],
    ).toEqual(['block_legacy'])
    expect(nodes.item_legacy?.parentId).toBe('block_legacy')
    expect(
      nodes.item_legacy && 'blockFaceId' in nodes.item_legacy
        ? nodes.item_legacy.blockFaceId
        : null,
    ).toBe('f-top')
  })
})
