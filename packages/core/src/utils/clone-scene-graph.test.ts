import { describe, expect, test } from 'bun:test'
import type { CollectionId } from '../schema/collections'
import type { AnyNode, AnyNodeId } from '../schema/types'
import {
  cloneLevelSubtree,
  cloneSceneGraph,
  forkSceneGraph,
  type SceneGraph,
} from './clone-scene-graph'

function makeNode(id: string, type: string, extra: Record<string, unknown> = {}): AnyNode {
  return {
    object: 'node',
    id,
    type,
    parentId: null,
    visible: true,
    metadata: {},
    ...extra,
  } as unknown as AnyNode
}

function makeSceneGraph(): SceneGraph {
  const site = makeNode('site_1', 'site', { children: ['level_1'] })
  const level = makeNode('level_1', 'level', {
    parentId: 'site_1',
    children: ['wall_1', 'scan_1', 'guide_1'],
  })
  const wall = makeNode('wall_1', 'wall', { parentId: 'level_1' })
  const scan = makeNode('scan_1', 'scan', { parentId: 'level_1', url: 'scan.glb' })
  const guide = makeNode('guide_1', 'guide', { parentId: 'level_1', url: 'guide.png' })

  return {
    nodes: {
      ['site_1' as AnyNodeId]: site,
      ['level_1' as AnyNodeId]: level,
      ['wall_1' as AnyNodeId]: wall,
      ['scan_1' as AnyNodeId]: scan,
      ['guide_1' as AnyNodeId]: guide,
    },
    rootNodeIds: ['site_1' as AnyNodeId],
    collections: {
      ['collection_1' as CollectionId]: {
        id: 'collection_1' as CollectionId,
        name: 'References',
        nodeIds: ['scan_1', 'guide_1'] as AnyNodeId[],
      },
    },
    installedPlugins: ['pascal:trees'],
  }
}

describe('forkSceneGraph', () => {
  test('strips scan and guide nodes by default', () => {
    const forked = forkSceneGraph(makeSceneGraph())
    const nodes = Object.values(forked.nodes)

    expect(nodes.some((node) => node.type === 'scan')).toBe(false)
    expect(nodes.some((node) => node.type === 'guide')).toBe(false)
    expect(nodes.some((node) => node.type === 'wall')).toBe(true)
    expect(forked.collections).toEqual({})
    expect(forked.installedPlugins).toEqual(['pascal:trees'])
  })

  test('preserves scan and guide nodes when requested', () => {
    const forked = forkSceneGraph(makeSceneGraph(), { preserveScans: true })
    const nodes = Object.values(forked.nodes)

    expect(nodes.some((node) => node.type === 'scan')).toBe(true)
    expect(nodes.some((node) => node.type === 'guide')).toBe(true)
    expect(nodes.map((node) => node.id)).not.toContain('scan_1')
    expect(nodes.map((node) => node.id)).not.toContain('guide_1')
    expect(
      Object.values(forked.collections ?? {}).flatMap((collection) => collection.nodeIds),
    ).toHaveLength(2)
    expect(forked.installedPlugins).toEqual(['pascal:trees'])
  })
})

describe('supportSlabId remap', () => {
  test('cloneSceneGraph remaps supportSlabId to the cloned slab id', () => {
    const level = makeNode('level_1', 'level', { children: ['slab_1', 'item_1'] })
    const slab = makeNode('slab_1', 'slab', { parentId: 'level_1' })
    const item = makeNode('item_1', 'item', { parentId: 'level_1', supportSlabId: 'slab_1' })

    const cloned = cloneSceneGraph({
      nodes: {
        ['level_1' as AnyNodeId]: level,
        ['slab_1' as AnyNodeId]: slab,
        ['item_1' as AnyNodeId]: item,
      },
      rootNodeIds: ['level_1' as AnyNodeId],
    })

    const clonedSlab = Object.values(cloned.nodes).find((node) => node.type === 'slab')!
    const clonedItem = Object.values(cloned.nodes).find((node) => node.type === 'item')!
    expect(clonedSlab.id).not.toBe('slab_1')
    expect((clonedItem as { supportSlabId?: string }).supportSlabId).toBe(clonedSlab.id)
  })

  test('cloneLevelSubtree remaps in-subtree hosts and preserves external references', () => {
    const level = makeNode('level_1', 'level', { children: ['slab_1', 'item_1', 'item_2'] })
    const slab = makeNode('slab_1', 'slab', { parentId: 'level_1' })
    const hosted = makeNode('item_1', 'item', { parentId: 'level_1', supportSlabId: 'slab_1' })
    const external = makeNode('item_2', 'item', {
      parentId: 'level_1',
      supportSlabId: 'slab_external',
    })

    const { clonedNodes, idMap } = cloneLevelSubtree(
      {
        ['level_1' as AnyNodeId]: level,
        ['slab_1' as AnyNodeId]: slab,
        ['item_1' as AnyNodeId]: hosted,
        ['item_2' as AnyNodeId]: external,
      },
      'level_1' as AnyNodeId,
    )

    const clonedHosted = clonedNodes.find((node) => node.id === idMap.get('item_1'))!
    const clonedExternal = clonedNodes.find((node) => node.id === idMap.get('item_2'))!
    expect((clonedHosted as { supportSlabId?: string }).supportSlabId).toBe(idMap.get('slab_1')!)
    expect((clonedExternal as { supportSlabId?: string }).supportSlabId).toBe('slab_external')
  })
})
