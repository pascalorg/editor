'use client'

import { temporal } from 'zundo'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { BuildingNode } from '../schema'
import { LevelNode } from '../schema/nodes/level'
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

const useScene = create<SceneState>()(
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

        loadScene: () => {
          if (get().rootNodeIds.length > 0) {
            // Assign all nodes as dirty to force re-validation
            Object.values(get().nodes).forEach((node) => {
              get().markDirty(node.id)
            })
            return // Scene already loaded
          }

          const building = BuildingNode.parse({
            children: [],
          })

          const level0 = LevelNode.parse({
            level: 0,
            children: [],
          })

          building.children.push(level0.id)

          // Define all nodes flat
          const nodes: Record<AnyNodeId, AnyNode> = {
            [building.id]: building,
            [level0.id]: level0,
          }

          // Root nodes are the levels
          const rootNodeIds = [building.id]

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
      onRehydrateStorage: (state) => {
        console.log('hydrating...')

        // optional
        return (state, error) => {
          if (error) {
            console.log('an error happened during hydration', error)
          } else {
            console.log('hydration finished')
          }
        }
      },
    },
  ),
)

export default useScene

// Subscribe to the temporal store (Undo/Redo events)
useScene.temporal.subscribe((state, prevState) => {
  // Check if we just jumped in time (Undo/Redo)
  // If the 'nodes' object changed but it wasn't a normal 'set'
  const currentNodes = useScene.getState().nodes

  // Trigger a full scene re-validation
  Object.values(currentNodes).forEach((node) => {
    useScene.getState().markDirty(node.id)
  })
})
