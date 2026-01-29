'use client'

import { type BuildingNode, type ItemNode, type LevelNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { create } from 'zustand'
import type { Asset } from '../../../packages/core/src/schema/nodes/item'

export type Phase = 'site' | 'structure' | 'furnish'

export type Mode = 'select' | 'edit' | 'delete' | 'build'

// Structure mode tools (building elements)
export type StructureTool =
  | 'wall'
  | 'room'
  | 'custom-room'
  | 'slab'
  | 'ceiling'
  | 'roof'
  | 'column'
  | 'stair'
  | 'item'
  | 'zone'

// Furnish mode tools (items and decoration)
export type FurnishTool = 'item'

// Site mode tools
export type SiteTool = 'property-line'

// Catalog categories for furnish mode items
export type CatalogCategory =
  | 'furniture'
  | 'appliance'
  | 'bathroom'
  | 'kitchen'
  | 'outdoor'
  | 'window'
  | 'door'

export type StructureLayer = 'zones' | 'elements'

// Combined tool type
export type Tool = SiteTool | StructureTool | FurnishTool

type EditorState = {
  phase: Phase
  setPhase: (phase: Phase) => void
  mode: Mode
  setMode: (mode: Mode) => void
  tool: Tool | null
  setTool: (tool: Tool | null) => void
    structureLayer: StructureLayer
  setStructureLayer: (layer: StructureLayer) => void
  catalogCategory: CatalogCategory | null
  setCatalogCategory: (category: CatalogCategory | null) => void
  selectedItem: Asset | null
  setSelectedItem: (item: Asset) => void
  movingNode: ItemNode | null
  setMovingNode: (node: ItemNode | null) => void
  selectedReferenceId: string | null
  setSelectedReferenceId: (id: string | null) => void
}

const useEditor = create<EditorState>()((set, get) => ({
  phase: 'site',
  setPhase: (phase) => {
    const currentPhase = get().phase
    if (currentPhase === phase) return

    set({ phase })

    // Clear tool and catalog when switching phases
    set({ tool: null, catalogCategory: null })

    const viewer = useViewer.getState()
    const scene = useScene.getState()

    // Helper to find building and level 0
    const selectBuildingAndLevel0 = () => {
      let buildingId = viewer.selection.buildingId

      // If no building selected, find the first one
      if (!buildingId) {
        const firstBuildingId = scene.rootNodeIds.find((id) => {
          const node = scene.nodes[id]
          return node?.type === 'building'
        })
        if (firstBuildingId) {
          buildingId = firstBuildingId as BuildingNode['id']
          viewer.setSelection({ buildingId })
        }
      }

      // If no level selected, find level 0 in the building
      if (buildingId && !viewer.selection.levelId) {
        const buildingNode = scene.nodes[buildingId] as BuildingNode
        const level0Id = buildingNode.children.find((childId) => {
          const levelNode = scene.nodes[childId] as LevelNode
          return levelNode?.type === 'level' && levelNode.level === 0
        })
        if (level0Id) {
          viewer.setSelection({ levelId: level0Id as LevelNode['id'] })
        } else if (buildingNode.children[0]) {
          // Fallback to first level if level 0 doesn't exist
          viewer.setSelection({ levelId: buildingNode.children[0] as LevelNode['id'] })
        }
      }
    }

    switch (phase) {
      case 'site':
        // In Site mode, we zoom out and deselect specific levels/buildings
        viewer.resetSelection()
        viewer.setLevelMode('stacked')
        break

      case 'structure':
        selectBuildingAndLevel0()
        viewer.setLevelMode('stacked')
        break

      case 'furnish':
        selectBuildingAndLevel0()
        viewer.setLevelMode('solo')
        // Furnish mode only supports elements layer, not zones
        set({ structureLayer: 'elements' })
        break
    }
  },
  mode: 'select',
  setMode: (mode) => {
    set({ mode })

    const { phase, structureLayer, tool } = get()

    // When entering build mode in structure phase with zones layer, activate zone tool
    if (mode === 'build' && phase === 'structure' && structureLayer === 'zones') {
      set({ tool: 'zone' })
    }
    // When leaving build mode, clear tool
    else if (mode !== 'build' && tool) {
      set({ tool: null })
    }
  },
  tool: null,
  setTool: (tool) => set({ tool }),
  structureLayer: 'elements',
  setStructureLayer: (layer) => {
    const { mode, tool } = get()
    set({ structureLayer: layer })

    const viewer = useViewer.getState()
    viewer.setSelection({
      selectedIds: [],
      zoneId: null,
    })

    // Handle tool changes based on layer
    if (layer === 'zones') {
      // In zones layer with build mode, activate zone tool
      if (mode === 'build') {
        set({ tool: 'zone' })
      }
    } else {
      // In elements layer, clear zone tool if it was active
      if (tool === 'zone') {
        set({ tool: null })
      }
    }
  },
  catalogCategory: null,
  setCatalogCategory: (category) => set({ catalogCategory: category }),
  selectedItem: null,
  setSelectedItem: (item) => set({ selectedItem: item }),
  movingNode: null,
  setMovingNode: (node) => set({ movingNode: node }),
  selectedReferenceId: null,
  setSelectedReferenceId: (id) => set({ selectedReferenceId: id }),
}))

export default useEditor
