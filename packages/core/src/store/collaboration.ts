import * as Y from 'yjs'
import useScene, { type SceneState } from './use-scene'
import type { AnyNode, AnyNodeId } from '../schema/types'
import type { Collection, CollectionId } from '../schema/collections'

/**
 * Binds the useScene Zustand store to a Yjs document.
 * 
 * This creates a bidirectional sync between the local state and the shared CRDT.
 * It handles nodes, rootNodeIds, and collections.
 */
export function bindSceneStoreToYjs(doc: Y.Doc) {
  const ynodes = doc.getMap<AnyNode>('nodes')
  const yrootIds = doc.getArray<AnyNodeId>('rootNodeIds')
  const ycollections = doc.getMap<Collection>('collections')

  let isRemoteUpdate = false

  // --- SYNC FROM YJS TO ZUSTAND ---
  
  const syncFromYjs = () => {
    if (isRemoteUpdate) return
    isRemoteUpdate = true

    console.log('[Yjs -> Zustand] Syncing updates from Yjs to store')
    const nodes = ynodes.toJSON() as Record<AnyNodeId, AnyNode>
    const rootNodeIds = yrootIds.toArray()
    const collections = ycollections.toJSON() as Record<CollectionId, Collection>

    useScene.setState({ 
      nodes, 
      rootNodeIds,
      collections 
    })

    Object.keys(nodes).forEach(id => useScene.getState().markDirty(id as AnyNodeId))

    isRemoteUpdate = false
  }

  ynodes.observeDeep(syncFromYjs)
  yrootIds.observe(syncFromYjs)
  ycollections.observeDeep(syncFromYjs)

  // --- SYNC FROM ZUSTAND TO YJS ---

  let lastNodes = useScene.getState().nodes
  let lastRootIds = useScene.getState().rootNodeIds
  let lastCollections = useScene.getState().collections

  const unsubscribe = useScene.subscribe((state) => {
    if (isRemoteUpdate) return

    doc.transact(() => {
      // 1. Sync Nodes
      if (state.nodes !== lastNodes) {
        console.log('[Zustand -> Yjs] Syncing node changes to Yjs')
        for (const [id, node] of Object.entries(state.nodes)) {
          if (lastNodes[id as AnyNodeId] !== node) {
            ynodes.set(id, node)
          }
        }
        // Detect deletions
        for (const id in lastNodes) {
          if (!state.nodes[id as AnyNodeId]) {
            ynodes.delete(id)
          }
        }
        lastNodes = state.nodes
      }

      // 2. Sync Root IDs
      if (state.rootNodeIds !== lastRootIds) {
        // Simplified sync for rootIds array
        yrootIds.delete(0, yrootIds.length)
        yrootIds.insert(0, state.rootNodeIds)
        lastRootIds = state.rootNodeIds
      }

      // 3. Sync Collections
      if (state.collections !== lastCollections) {
        for (const [id, col] of Object.entries(state.collections)) {
          if (lastCollections[id as CollectionId] !== col) {
            ycollections.set(id as CollectionId, col)
          }
        }
        for (const id in lastCollections) {
          if (!state.collections[id as CollectionId]) {
            ycollections.delete(id)
          }
        }
        lastCollections = state.collections
      }
    }, 'local')
  })

  // Initial Sync: If Yjs is already populated, sync to Zustand. 
  // If Yjs is empty but Zustand has data, sync to Yjs.
  if (ynodes.size > 0) {
    syncFromYjs()
  } else if (Object.keys(useScene.getState().nodes).length > 0) {
    doc.transact(() => {
      const state = useScene.getState()
      Object.entries(state.nodes).forEach(([id, node]) => ynodes.set(id, node))
      yrootIds.insert(0, state.rootNodeIds)
      Object.entries(state.collections).forEach(([id, col]) => ycollections.set(id as CollectionId, col))
    }, 'local')
  }

  return () => {
    unsubscribe()
    ynodes.unobserveDeep(syncFromYjs)
    yrootIds.unobserve(syncFromYjs)
    ycollections.unobserveDeep(syncFromYjs)
  }
}
