'use client'

import type { TemporalState } from 'zundo'
import { temporal } from 'zundo'
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { persist } from 'zustand/middleware'
import { BuildingNode } from '../schema'
import { LevelNode } from '../schema/nodes/level'
import { SiteNode } from '../schema/nodes/site'
import type { AnyNode, AnyNodeId } from '../schema/types'
import { isObject } from '../utils/types'
import * as nodeActions from './actions/node-actions'

export type SceneState = {
  // 1. The Data: A flat dictionary of all nodes
  nodes: Record<AnyNodeId, AnyNode>

  // 2. The Root: Which nodes are at the top level?
  rootNodeIds: AnyNodeId[]

  // 3. The "Dirty" Set: For the Wall/Physics systems
  dirtyNodes: Set<AnyNodeId>

  // Actions
  loadScene: () => void
  clearScene: () => void
  setScene: (nodes: Record<AnyNodeId, AnyNode>, rootNodeIds: AnyNodeId[]) => void

  markDirty: (id: AnyNodeId) => void
  clearDirty: (id: AnyNodeId) => void

  createNode: (node: AnyNode, parentId?: AnyNodeId) => void
  createNodes: (ops: { node: AnyNode; parentId?: AnyNodeId }[]) => void

  updateNode: (id: AnyNodeId, data: Partial<AnyNode>) => void
  updateNodes: (updates: { id: AnyNodeId; data: Partial<AnyNode> }[]) => void

  deleteNode: (id: AnyNodeId) => void
  deleteNodes: (ids: AnyNodeId[]) => void
}

// type PartializedStoreState = Pick<SceneState, 'rootNodeIds' | 'nodes'>;

type UseSceneStore = UseBoundStore<StoreApi<SceneState>> & {
  temporal: StoreApi<TemporalState<Pick<SceneState, 'nodes' | 'rootNodeIds'>>>
}

const useScene: UseSceneStore = create<SceneState>()(
  persist(
    temporal(
      (set, get) => ({
        // 1. Flat dictionary of all nodes
        nodes: {},

        // 2. Root node IDs
        rootNodeIds: [],

        // 3. Dirty set
        dirtyNodes: new Set<AnyNodeId>(),

        clearScene: () => {
          set({
            nodes: {},
            rootNodeIds: [],
            dirtyNodes: new Set<AnyNodeId>(),
          })
          get().loadScene() // Default scene
        },

        setScene: (nodes, rootNodeIds) => {
          // Backward compat: add default scale to item nodes loaded from external sources
          // (pascal_local_projects, Supabase) saved before scale was added to ItemNode
          const patchedNodes = { ...nodes }
          for (const [id, node] of Object.entries(patchedNodes)) {
            if (node.type === 'item' && !('scale' in node)) {
              patchedNodes[id as AnyNodeId] = { ...(node as object), scale: [1, 1, 1] } as AnyNode
            }
          }
          set({
            nodes: patchedNodes,
            rootNodeIds,
            dirtyNodes: new Set<AnyNodeId>(),
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
        createNode: (node, parentId) =>
          nodeActions.createNodesAction(set, get, [{ node, parentId }]),

        updateNodes: (updates) => nodeActions.updateNodesAction(set, get, updates),
        updateNode: (id, data) => nodeActions.updateNodesAction(set, get, [{ id, data }]),

        // --- DELETE ---

        deleteNodes: (ids) => nodeActions.deleteNodesAction(set, get, ids),

        deleteNode: (id) => nodeActions.deleteNodesAction(set, get, [id]),
      }),
      {
        partialize: (state) => {
          const { nodes, rootNodeIds } = state // Only track nodes and rootNodeIds in history
          return { nodes, rootNodeIds }
        },
        limit: 50, // Limit to last 50 actions
      },
    ),
    {
      name: 'editor-storage',
      version: 1,
      partialize: (state) => ({
        nodes: Object.fromEntries(
          Object.entries(state.nodes).filter(([_, node]) => {
            const meta = node.metadata
            const isTransient = isObject(meta) && 'isTransient' in meta && meta.isTransient === true

            return !isTransient
          }),
        ),
        rootNodeIds: state.rootNodeIds,
      }),
      merge: (persistedState, currentState) => {
        console.log('merge calling...', persistedState, currentState)
        const persisted = persistedState as Partial<SceneState>
        // Backward compat: add default scale to item nodes saved before scale was added
        if (persisted.nodes) {
          for (const [id, node] of Object.entries(persisted.nodes)) {
            if (node.type === 'item' && !('scale' in node)) {
              persisted.nodes[id as AnyNodeId] = { ...(node as object), scale: [1, 1, 1] } as AnyNode
            }
          }
        }
        return { ...currentState, ...persisted }
      },
      onRehydrateStorage: (state) => {
        console.log('hydrating...')

        return (state, error) => {
          if (error) {
            console.log('an error happened during hydration', error)
            return
          }

          if (!state) {
            console.log('hydration finished - no state')
            return
          }

          // Migration: Wrap old scenes (where root is not a SiteNode) in a SiteNode
          const rootId = state.rootNodeIds?.[0]
          const rootNode = rootId ? state.nodes[rootId] : null

          if (rootNode && rootNode.type !== 'site') {
            console.log('Migrating old scene: wrapping in SiteNode')

            // Collect existing root nodes (should be BuildingNode or ItemNode)
            const existingRoots = (state.rootNodeIds || [])
              .map(id => state.nodes[id])
              .filter(node => node?.type === 'building' || node?.type === 'item')

            // Create a new SiteNode with existing roots as children
            const site = SiteNode.parse({
              children: existingRoots,
            })

            // Add site to nodes
            state.nodes[site.id] = site

            // Update root to be the site
            state.rootNodeIds = [site.id]

            console.log('Migration complete: scene now has SiteNode as root')
          }

          console.log('hydration finished')
        }
      },
    },
  ),
)

export default useScene

// Track previous temporal state lengths
let prevPastLength = 0
let prevFutureLength = 0

// Subscribe to the temporal store (Undo/Redo events)
useScene.temporal.subscribe((state) => {
  const currentPastLength = state.pastStates.length
  const currentFutureLength = state.futureStates.length

  // Undo: futureStates increases (state moved from past to future)
  // Redo: pastStates increases while futureStates decreases (state moved from future to past)
  const didUndo = currentFutureLength > prevFutureLength
  const didRedo = currentPastLength > prevPastLength && currentFutureLength < prevFutureLength

  if (didUndo || didRedo) {
    // Use RAF to ensure all middleware and store updates are complete
    requestAnimationFrame(() => {
      const currentNodes = useScene.getState().nodes

      // Trigger a full scene re-validation after undo/redo
      Object.values(currentNodes).forEach((node) => {
        useScene.getState().markDirty(node.id)
      })
    })
  }

  // Update tracked lengths
  prevPastLength = currentPastLength
  prevFutureLength = currentFutureLength
})
