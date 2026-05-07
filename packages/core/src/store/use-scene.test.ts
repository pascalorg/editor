// @ts-expect-error - bun:test is provided by the Bun runtime; core does not
// depend on @types/bun, matching the package's existing test files.
import { describe, expect, test } from 'bun:test'
import type { AnyNodeId } from '../schema/types'
import type { Collection, CollectionId } from '../schema/collections'
import useScene from './use-scene'

const resetSceneStore = () => {
  useScene.setState({
    collections: {},
    dirtyNodes: new Set(),
    nodes: {},
    readOnly: false,
    rootNodeIds: [],
  })
}

describe('useScene.setScene', () => {
  test('preserves collections referenced by detached binding nodes', () => {
    resetSceneStore()

    const collectionId = 'collection_master' as CollectionId
    const collection: Collection = {
      id: collectionId,
      name: 'Master',
      nodeIds: [],
    }
    const bindingId = 'ha_binding_master' as AnyNodeId

    useScene.getState().setScene(
      {
        [bindingId]: {
          aggregation: 'single',
          collectionId,
          id: bindingId,
          parentId: null,
          primaryResourceId: 'light.master',
          resources: [
            {
              actions: [],
              capabilities: ['power'],
              defaultActionKey: null,
              entityId: 'light.master',
              id: 'light.master',
              kind: 'entity',
              label: 'Master',
            },
          ],
          type: 'home-assistant-binding',
        } as never,
      },
      [],
      { [collectionId]: collection },
    )

    expect(useScene.getState().collections).toEqual({ [collectionId]: collection })
    expect(useScene.getState().rootNodeIds).toContain(bindingId)
  })

  test('clears collections when no scene graph collections are provided', () => {
    const collectionId = 'collection_existing' as CollectionId
    resetSceneStore()
    useScene.setState({
      collections: {
        [collectionId]: {
          id: collectionId,
          name: 'Existing',
          nodeIds: [],
        },
      },
    })

    useScene.getState().setScene({}, [])

    expect(useScene.getState().collections).toEqual({})
  })
})
