'use client'

import type { TemporalState } from 'zundo'
import { temporal } from 'zundo'
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { BuildingNode } from '../schema'
import type { Collection, CollectionId } from '../schema/collections'
import { generateCollectionId } from '../schema/collections'
import { LevelNode } from '../schema/nodes/level'
import { SiteNode } from '../schema/nodes/site'
import type { AnyNode, AnyNodeId } from '../schema/types'
import * as nodeActions from './actions/node-actions'

function migrateNodes(nodes: Record<string, any>): Record<string, AnyNode> {
  const patchedNodes = { ...nodes }
  for (const [id, node] of Object.entries(patchedNodes)) {
    // 1. Item scale migration
    if (node.type === 'item' && !('scale' in node)) {
      patchedNodes[id] = { ...node, scale: [1, 1, 1] }
    }
    // 2. Old roof to new roof + segment migration
    if (node.type === 'roof' && !('children' in node)) {
      const oldRoof = node
      const suffix = id.includes('_') ? id.split('_')[1] : Math.random().toString(36).slice(2)
      const segmentId = `rseg_${suffix}`

      const segment = {
        object: 'node',
        id: segmentId,
        type: 'roof-segment',
        parentId: id,
        visible: oldRoof.visible ?? true,
        metadata: {},
        position: [0, 0, 0],
        rotation: 0,
        roofType: 'gable',
        width: oldRoof.length ?? 8,
        depth: (oldRoof.leftWidth ?? 2.2) + (oldRoof.rightWidth ?? 2.2),
        wallHeight: 0,
        roofHeight: oldRoof.height ?? 2.5,
        wallThickness: 0.1,
        deckThickness: 0.1,
        overhang: 0.3,
        shingleThickness: 0.05,
      }

      patchedNodes[segmentId] = segment
      patchedNodes[id] = {
        ...oldRoof,
        children: [segmentId],
      }
    }
  }
  return patchedNodes as Record<string, AnyNode>
}

export type SceneState = {
  // 1. The Data: A flat dictionary of all nodes
  nodes: Record<AnyNodeId, AnyNode>

  // 2. The Root: Which nodes are at the top level?
  rootNodeIds: AnyNodeId[]

  // 3. The "Dirty" Set: For the Wall/Physics systems
  dirtyNodes: Set<AnyNodeId>

  // 4. Relational metadata — not nodes
  collections: Record<CollectionId, Collection>

  // Actions
  loadScene: () => void
  clearScene: () => void
  unloadScene: () => void
  setScene: (nodes: Record<AnyNodeId, AnyNode>, rootNodeIds: AnyNodeId[]) => void

  markDirty: (id: AnyNodeId) => void
  clearDirty: (id: AnyNodeId) => void

  createNode: (node: AnyNode, parentId?: AnyNodeId) => void
  createNodes: (ops: { node: AnyNode; parentId?: AnyNodeId }[]) => void

  updateNode: (id: AnyNodeId, data: Partial<AnyNode>) => void
  updateNodes: (updates: { id: AnyNodeId; data: Partial<AnyNode> }[]) => void

  deleteNode: (id: AnyNodeId) => void
  deleteNodes: (ids: AnyNodeId[]) => void

  // Collection actions
  createCollection: (name: string, nodeIds?: AnyNodeId[]) => CollectionId
  deleteCollection: (id: CollectionId) => void
  updateCollection: (id: CollectionId, data: Partial<Omit<Collection, 'id'>>) => void
  addToCollection: (id: CollectionId, nodeId: AnyNodeId) => void
  removeFromCollection: (id: CollectionId, nodeId: AnyNodeId) => void
}

// type PartializedStoreState = Pick<SceneState, 'rootNodeIds' | 'nodes'>;

type UseSceneStore = UseBoundStore<StoreApi<SceneState>> & {
  temporal: StoreApi<TemporalState<Pick<SceneState, 'nodes' | 'rootNodeIds' | 'collections'>>>
}

const useScene: UseSceneStore = create<SceneState>()(
  temporal(
    (set, get) => ({
      // 1. Flat dictionary of all nodes
      nodes: {},

      // 2. Root node IDs
      rootNodeIds: [],

      // 3. Dirty set
      dirtyNodes: new Set<AnyNodeId>(),

      // 4. Collections
      collections: {} as Record<CollectionId, Collection>,

      unloadScene: () => {
        set({
          nodes: {},
          rootNodeIds: [],
          dirtyNodes: new Set<AnyNodeId>(),
          collections: {},
        })
      },

      clearScene: () => {
        get().unloadScene()
        get().loadScene() // Default scene
      },

      setScene: (nodes, rootNodeIds) => {
        // Apply backward compatibility migrations
        const patchedNodes = migrateNodes(nodes)

        set({
          nodes: patchedNodes,
          rootNodeIds,
          dirtyNodes: new Set<AnyNodeId>(),
          collections: {},
        })
        // Mark all nodes as dirty to trigger re-validation
        Object.values(patchedNodes).forEach((node) => {
          get().markDirty(node.id)
        })
      },

      loadScene: () => {
        if (get().rootNodeIds.length > 0) {
          // Assign all nodes as dirty to force re-validation
          Object.values(get().nodes).forEach((node) => {
            get().markDirty(node.id)
          })
          return // Scene already loaded
        }

        // Create hierarchy: Site → Building → Level
        const level0 = LevelNode.parse({
          level: 0,
          children: [],
        })

        const building = BuildingNode.parse({
          children: [level0.id],
        })

        const site = SiteNode.parse({
          children: [building],
        })

        // Define all nodes flat
        const nodes: Record<AnyNodeId, AnyNode> = {
          [site.id]: site,
          [building.id]: building,
          [level0.id]: level0,
        }

        // Site is the root
        const rootNodeIds = [site.id]

        set({ nodes, rootNodeIds })
      },

      markDirty: (id) => {
        get().dirtyNodes.add(id)
      },

      clearDirty: (id) => {
        get().dirtyNodes.delete(id)
      },

      createNodes: (ops) => nodeActions.createNodesAction(set, get, ops),
      createNode: (node, parentId) => nodeActions.createNodesAction(set, get, [{ node, parentId }]),

      updateNodes: (updates) => nodeActions.updateNodesAction(set, get, updates),
      updateNode: (id, data) => nodeActions.updateNodesAction(set, get, [{ id, data }]),

      // --- DELETE ---

      deleteNodes: (ids) => nodeActions.deleteNodesAction(set, get, ids),

      deleteNode: (id) => nodeActions.deleteNodesAction(set, get, [id]),

      // --- COLLECTIONS ---

      createCollection: (name, nodeIds = []) => {
        const id = generateCollectionId()
        const collection: Collection = { id, name, nodeIds }
        set((state) => {
          const nextCollections = { ...state.collections, [id]: collection }
          // Denormalize: stamp collectionId onto each node
          const nextNodes = { ...state.nodes }
          for (const nodeId of nodeIds) {
            const node = nextNodes[nodeId]
            if (!node) continue
            const existing =
              ('collectionIds' in node ? (node.collectionIds as CollectionId[]) : undefined) ?? []
            nextNodes[nodeId] = { ...node, collectionIds: [...existing, id] } as AnyNode
          }
          return { collections: nextCollections, nodes: nextNodes }
        })
        return id
      },

      deleteCollection: (id) => {
        set((state) => {
          const col = state.collections[id]
          const nextCollections = { ...state.collections }
          delete nextCollections[id]
          // Remove collectionId from all member nodes
          const nextNodes = { ...state.nodes }
          for (const nodeId of col?.nodeIds ?? []) {
            const node = nextNodes[nodeId]
            if (!(node && 'collectionIds' in node)) continue
            nextNodes[nodeId] = {
              ...node,
              collectionIds: (node.collectionIds as CollectionId[]).filter((cid) => cid !== id),
            } as AnyNode
          }
          return { collections: nextCollections, nodes: nextNodes }
        })
      },

      updateCollection: (id, data) => {
        set((state) => {
          const col = state.collections[id]
          if (!col) return state
          return { collections: { ...state.collections, [id]: { ...col, ...data } } }
        })
      },

      addToCollection: (id, nodeId) => {
        set((state) => {
          const col = state.collections[id]
          if (!col || col.nodeIds.includes(nodeId)) return state
          const nextCollections = {
            ...state.collections,
            [id]: { ...col, nodeIds: [...col.nodeIds, nodeId] },
          }
          const node = state.nodes[nodeId]
          if (!node) return { collections: nextCollections }
          const existing =
            ('collectionIds' in node ? (node.collectionIds as CollectionId[]) : undefined) ?? []
          const nextNodes = {
            ...state.nodes,
            [nodeId]: { ...node, collectionIds: [...existing, id] } as AnyNode,
          }
          return { collections: nextCollections, nodes: nextNodes }
        })
      },

      removeFromCollection: (id, nodeId) => {
        set((state) => {
          const col = state.collections[id]
          if (!col) return state
          const nextCollections = {
            ...state.collections,
            [id]: { ...col, nodeIds: col.nodeIds.filter((n) => n !== nodeId) },
          }
          const node = state.nodes[nodeId]
          if (!(node && 'collectionIds' in node)) return { collections: nextCollections }
          const nextNodes = {
            ...state.nodes,
            [nodeId]: {
              ...node,
              collectionIds: (node.collectionIds as CollectionId[]).filter((cid) => cid !== id),
            } as AnyNode,
          }
          return { collections: nextCollections, nodes: nextNodes }
        })
      },
    }),
    {
      partialize: (state) => {
        const { nodes, rootNodeIds, collections } = state
        return { nodes, rootNodeIds, collections }
      },
      limit: 50, // Limit to last 50 actions
    },
  ),
)

export default useScene

// Track previous temporal state lengths and node snapshot for diffing
let prevPastLength = 0
let prevFutureLength = 0
let prevNodesSnapshot: Record<AnyNodeId, AnyNode> | null = null

export function clearSceneHistory() {
  useScene.temporal.getState().clear()
  prevPastLength = 0
  prevFutureLength = 0
  prevNodesSnapshot = null
}

// Subscribe to the temporal store (Undo/Redo events)
useScene.temporal.subscribe((state) => {
  const currentPastLength = state.pastStates.length
  const currentFutureLength = state.futureStates.length

  // Undo: futureStates increases (state moved from past to future)
  // Redo: pastStates increases while futureStates decreases (state moved from future to past)
  const didUndo = currentFutureLength > prevFutureLength
  const didRedo = currentPastLength > prevPastLength && currentFutureLength < prevFutureLength

  if (didUndo || didRedo) {
    // Capture the previous snapshot before RAF fires
    const snapshotBefore = prevNodesSnapshot

    // Use RAF to ensure all middleware and store updates are complete
    requestAnimationFrame(() => {
      const currentNodes = useScene.getState().nodes
      const { markDirty } = useScene.getState()

      if (snapshotBefore) {
        // Diff: only mark nodes that actually changed
        for (const [id, node] of Object.entries(currentNodes) as [AnyNodeId, AnyNode][]) {
          if (snapshotBefore[id] !== node) {
            markDirty(id)
            // Also mark parent so merged geometries update
            if (node.parentId) markDirty(node.parentId as AnyNodeId)
          }
        }
        // Nodes that were deleted (exist in prev but not current)
        for (const [id, node] of Object.entries(snapshotBefore) as [AnyNodeId, AnyNode][]) {
          if (!currentNodes[id]) {
            const parentId = node.parentId as AnyNodeId | undefined
            if (parentId) {
              markDirty(parentId)
              // Mark sibling nodes dirty so they can update their geometry
              // (e.g. adjacent walls need to recalculate miter/junction geometry)
              const parent = currentNodes[parentId]
              if (parent && 'children' in parent) {
                for (const childId of (parent as AnyNode & { children: string[] }).children) {
                  markDirty(childId as AnyNodeId)
                }
              }
            }
          }
        }
      } else {
        // No snapshot to diff against — fall back to marking all
        for (const node of Object.values(currentNodes)) {
          markDirty(node.id)
        }
      }
    })
  }

  // Update tracked lengths and snapshot
  prevPastLength = currentPastLength
  prevFutureLength = currentFutureLength
  prevNodesSnapshot = useScene.getState().nodes
})
