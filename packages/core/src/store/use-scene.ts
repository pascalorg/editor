'use client'

import { temporal } from 'zundo'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { BuildingNode, type Zone } from '../schema'
import { LevelNode } from '../schema/nodes/level'
import type { AnyNode, AnyNodeId } from '../schema/types'
import * as nodeActions from './actions/node-actions'
import * as zoneActions from './actions/zone-actions'

export type SceneState = {
  // 1. The Data: A flat dictionary of all nodes
  nodes: Record<AnyNodeId, AnyNode>
  zones: Record<Zone['id'], Zone>

  // 2. The Root: Which nodes are at the top level?
  rootNodeIds: AnyNodeId[]
  zoneIds: Zone['id'][]

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

  // Zone actions
  createZone: (zone: Zone) => void
  createZones: (zones: Zone[]) => void
  updateZone: (id: Zone['id'], data: Partial<Zone>) => void
  updateZones: (updates: { id: Zone['id']; data: Partial<Zone> }[]) => void
  deleteZone: (id: Zone['id']) => void
  deleteZones: (ids: Zone['id'][]) => void
}

// type PartializedStoreState = Pick<SceneState, 'rootNodeIds' | 'nodes'>;

const useScene = create<SceneState>()(
  persist(
    temporal(
      (set, get) => ({
        // 1. Flat dictionary of all nodes
        nodes: {},
        zones: {},

        // 2. Root node IDs
        rootNodeIds: [],
        zoneIds: [],

        // 3. Dirty set
        dirtyNodes: new Set<AnyNodeId>(),

        clearScene: () => {
          set({
            nodes: {},
            rootNodeIds: [],
            zones: {},
            zoneIds: [],
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

        // --- ZONES ---

        createZones: (zones) => zoneActions.createZonesAction(set, get, zones),
        createZone: (zone) => zoneActions.createZonesAction(set, get, [zone]),

        updateZones: (updates) => zoneActions.updateZonesAction(set, get, updates),
        updateZone: (id, data) => zoneActions.updateZonesAction(set, get, [{ id, data }]),

        deleteZones: (ids) => zoneActions.deleteZonesAction(set, get, ids),
        deleteZone: (id) => zoneActions.deleteZonesAction(set, get, [id]),
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
        nodes: state.nodes,
        rootNodeIds: state.rootNodeIds,
        zones: state.zones,
        zoneIds: state.zoneIds,
      }),
      onRehydrateStorage: (state) => {
        console.log('hydration starts')

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
    if (node.type === 'wall') {
      useScene.getState().markDirty(node.id)
    }
  })
})
