import { describe, expect, test } from 'bun:test'
import { planSceneNodeChanges } from '../index'
import type { AnyNode, AnyNodeId, Collection, CollectionId } from '../schema'
import { applySceneChanges } from './apply-changes'
import { editCollection, writeCollections } from './collections'

const nodes = {
  level_a: { id: 'level_a', type: 'level', parentId: null, children: ['wall_a', 'item_lamp'] },
  wall_a: { id: 'wall_a', type: 'wall', parentId: 'level_a', children: ['window_a'] },
  window_a: { id: 'window_a', type: 'window', parentId: 'wall_a' },
  item_lamp: { id: 'item_lamp', type: 'item', parentId: 'level_a', asset: { name: 'Lamp' } },
} as unknown as Record<string, AnyNode>

describe('collections', () => {
  test('a collection persists its members and template; items mirror membership', () => {
    const { changes } = editCollection(
      { nodes, collections: {} },
      { template: 'lights', name: 'Lighting', add: ['item_lamp', 'window_a'] },
    )
    const collections = writeCollections({}, changes!.collections!)
    const [collection] = Object.values(collections)
    expect(collection).toEqual({
      id: expect.stringMatching(/^collection_/),
      name: 'Lighting',
      color: '#f5b83d',
      template: 'lights',
      nodeIds: ['item_lamp', 'window_a'] as AnyNodeId[],
    })
    const after = applySceneChanges(nodes, changes)
    expect(after.item_lamp).toMatchObject({ collectionIds: [collection!.id] })
    expect(after.window_a).not.toHaveProperty('collectionIds')
  })

  test('deleting a member that does not mirror membership still leaves its collection', () => {
    const collection: Collection = {
      id: 'collection_windows' as CollectionId,
      name: 'Windows',
      nodeIds: ['window_a', 'item_lamp'] as AnyNodeId[],
    }
    const { collections } = planSceneNodeChanges(
      {
        nodes: nodes as Record<AnyNodeId, AnyNode>,
        rootNodeIds: ['level_a'] as AnyNodeId[],
        collections: { [collection.id]: collection },
      },
      { delete: ['window_a'] as AnyNodeId[] },
    )
    expect(collections[collection.id]?.nodeIds).toEqual(['item_lamp'] as AnyNodeId[])
  })
})
