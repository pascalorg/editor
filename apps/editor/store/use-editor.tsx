'use client'

import type { AssetInput } from '@pascal-app/core'
import {
  type BuildingNode,
  type DoorNode,
  type ItemNode,
  type LevelNode,
  type Space,
  useScene,
  type WindowNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { create } from 'zustand'

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
  | 'window'
  | 'door'

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
  selectedItem: AssetInput | null
  setSelectedItem: (item: AssetInput) => void
  movingNode: ItemNode | WindowNode | DoorNode | null
  setMovingNode: (node: ItemNode | WindowNode | DoorNode | null) => void
  selectedReferenceId: string | null
  setSelectedReferenceId: (id: string | null) => void
  // Space detection for cutaway mode
  spaces: Record<string, Space>
  setSpaces: (spaces: Record<string, Space>) => void
  // Generic hole editing (works for slabs, ceilings, and any future polygon nodes)
  editingHole: { nodeId: string; holeIndex: number } | null
  setEditingHole: (hole: { nodeId: string; holeIndex: number } | null) => void
}

const useEditor = create<EditorState>()((set, get) => ({
  phase: 'site',
  setPhase: (phase) => {
    const currentPhase = get().phase
    if (currentPhase === phase) return

    set({ phase })

    // Reset to select mode and clear tool/catalog when switching phases
    set({ mode: 'select', tool: null, catalogCategory: null })

    const viewer = useViewer.getState()
    const scene = useScene.getState()

    // Helper to find building and level 0
    const selectBuildingAndLevel0 = () => {
      let buildingId = viewer.selection.buildingId

      // If no building selected, find the first one from site's children
      if (!buildingId) {
        const siteNode = scene.rootNodeIds[0] ? scene.nodes[scene.rootNodeIds[0]] : null
        if (siteNode?.type === 'site') {
          const firstBuilding = siteNode.children
            .map((child) => (typeof child === 'string' ? scene.nodes[child] : child))
            .find((node) => node?.type === 'building')
          if (firstBuilding) {
            buildingId = firstBuilding.id as BuildingNode['id']
            viewer.setSelection({ buildingId })
          }
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
        break

      case 'structure':
        selectBuildingAndLevel0()
        break

      case 'furnish':
        selectBuildingAndLevel0()
        // Furnish mode only supports elements layer, not zones
        set({ structureLayer: 'elements' })
        break
    }
  },
  mode: 'select',
  setMode: (mode) => {
    set({ mode })

    const { phase, structureLayer, tool } = get()

    if (mode === 'build') {
      // Clear selection when entering build mode
      const viewer = useViewer.getState()
      viewer.setSelection({
        selectedIds: [],
        zoneId: null,
      })
      
      // Ensure a tool is selected in build mode
      if (!tool) {
        if (phase === 'structure' && structureLayer === 'zones') {
          set({ tool: 'zone' })
        } else if (phase === 'structure' && structureLayer === 'elements') {
          set({ tool: 'wall' })
        } else if (phase === 'furnish') {
          set({ tool: 'item', catalogCategory: 'furniture' })
        }
      }
    }
    // When leaving build mode, clear tool
    else if (tool) {
      set({ tool: null })
    }
  },
  tool: null,
  setTool: (tool) => set({ tool }),
  structureLayer: 'elements',
  setStructureLayer: (layer) => {
    set({ structureLayer: layer, mode: 'select', tool: null })

    const viewer = useViewer.getState()
    viewer.setSelection({
      selectedIds: [],
      zoneId: null,
    })
  },
  catalogCategory: null,
  setCatalogCategory: (category) => set({ catalogCategory: category }),
  selectedItem: null,
  setSelectedItem: (item) => set({ selectedItem: item }),
  movingNode: null as ItemNode | WindowNode | DoorNode | null,
  setMovingNode: (node) => set({ movingNode: node }),
  selectedReferenceId: null,
  setSelectedReferenceId: (id) => set({ selectedReferenceId: id }),
  spaces: {},
  setSpaces: (spaces) => set({ spaces }),
  editingHole: null,
  setEditingHole: (hole) => set({ editingHole: hole }),
}))

export default useEditor
