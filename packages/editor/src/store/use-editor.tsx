'use client'

import type { AssetInput } from '@pascal-app/core'
import {
  type BuildingNode,
  type DoorNode,
  type ItemNode,
  type LevelNode,
  type RoofNode,
  type RoofSegmentNode,
  type Space,
  useScene,
  type WindowNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

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
  movingNode: ItemNode | WindowNode | DoorNode | RoofNode | RoofSegmentNode | null
  setMovingNode: (
    node: ItemNode | WindowNode | DoorNode | RoofNode | RoofSegmentNode | null,
  ) => void
  selectedReferenceId: string | null
  setSelectedReferenceId: (id: string | null) => void
  // Space detection for cutaway mode
  spaces: Record<string, Space>
  setSpaces: (spaces: Record<string, Space>) => void
  // Generic hole editing (works for slabs, ceilings, and any future polygon nodes)
  editingHole: { nodeId: string; holeIndex: number } | null
  setEditingHole: (hole: { nodeId: string; holeIndex: number } | null) => void
  // Preview mode (viewer-like experience inside the editor)
  isPreviewMode: boolean
  setPreviewMode: (preview: boolean) => void
  // Toggleable 2D floorplan overlay
  isFloorplanOpen: boolean
  setFloorplanOpen: (open: boolean) => void
  toggleFloorplanOpen: () => void
  isFloorplanHovered: boolean
  setFloorplanHovered: (hovered: boolean) => void
  // Development-only camera debug flag for inspecting underside geometry
  allowUndergroundCamera: boolean
  setAllowUndergroundCamera: (enabled: boolean) => void
}

export type PersistedEditorUiState = Pick<
  EditorState,
  'phase' | 'mode' | 'tool' | 'structureLayer' | 'catalogCategory' | 'isFloorplanOpen'
>

export const DEFAULT_PERSISTED_EDITOR_UI_STATE: PersistedEditorUiState = {
  phase: 'site',
  mode: 'select',
  tool: null,
  structureLayer: 'elements',
  catalogCategory: null,
  isFloorplanOpen: false,
}

function normalizeModeForPhase(phase: Phase, mode: Mode | undefined): Mode {
  if (phase === 'site') {
    return mode === 'edit' ? 'edit' : 'select'
  }

  return mode === 'build' || mode === 'delete' ? mode : 'select'
}

export function normalizePersistedEditorUiState(
  state: Partial<PersistedEditorUiState> | null | undefined,
): PersistedEditorUiState {
  const phase = state?.phase === 'structure' || state?.phase === 'furnish' ? state.phase : 'site'
  const mode = normalizeModeForPhase(phase, state?.mode)
  const isFloorplanOpen = Boolean(state?.isFloorplanOpen)

  if (phase === 'site') {
    return {
      ...DEFAULT_PERSISTED_EDITOR_UI_STATE,
      phase,
      mode,
      isFloorplanOpen,
    }
  }

  if (phase === 'furnish') {
    return {
      phase,
      mode,
      tool: mode === 'build' ? 'item' : null,
      structureLayer: 'elements',
      catalogCategory: mode === 'build' ? (state?.catalogCategory ?? 'furniture') : null,
      isFloorplanOpen,
    }
  }

  const structureLayer = state?.structureLayer === 'zones' ? 'zones' : 'elements'

  if (mode !== 'build') {
    return {
      phase,
      mode,
      tool: null,
      structureLayer,
      catalogCategory: null,
      isFloorplanOpen,
    }
  }

  if (structureLayer === 'zones') {
    return {
      phase,
      mode,
      tool: 'zone',
      structureLayer,
      catalogCategory: null,
      isFloorplanOpen,
    }
  }

  return {
    phase,
    mode,
    tool:
      state?.tool && state.tool !== 'property-line' && state.tool !== 'zone' ? state.tool : 'wall',
    structureLayer,
    catalogCategory: state?.tool === 'item' ? (state.catalogCategory ?? null) : null,
    isFloorplanOpen,
  }
}

export function hasCustomPersistedEditorUiState(
  state: Partial<PersistedEditorUiState> | null | undefined,
): boolean {
  const normalizedState = normalizePersistedEditorUiState(state)

  return (
    normalizedState.phase !== DEFAULT_PERSISTED_EDITOR_UI_STATE.phase ||
    normalizedState.mode !== DEFAULT_PERSISTED_EDITOR_UI_STATE.mode ||
    normalizedState.tool !== DEFAULT_PERSISTED_EDITOR_UI_STATE.tool ||
    normalizedState.structureLayer !== DEFAULT_PERSISTED_EDITOR_UI_STATE.structureLayer ||
    normalizedState.catalogCategory !== DEFAULT_PERSISTED_EDITOR_UI_STATE.catalogCategory ||
    normalizedState.isFloorplanOpen !== DEFAULT_PERSISTED_EDITOR_UI_STATE.isFloorplanOpen
  )
}

const useEditor = create<EditorState>()(
  persist(
    (set, get) => ({
      phase: DEFAULT_PERSISTED_EDITOR_UI_STATE.phase,
      setPhase: (phase) => {
        const currentPhase = get().phase
        if (currentPhase === phase) return

        set({ phase })

        const { mode, structureLayer } = get()

        if (mode === 'build') {
          // Stay in build mode, select the first tool for the new phase
          if (phase === 'site') {
            set({ tool: 'property-line', catalogCategory: null })
          } else if (phase === 'structure' && structureLayer === 'zones') {
            set({ tool: 'zone', catalogCategory: null })
          } else if (phase === 'structure') {
            set({ tool: 'wall', catalogCategory: null })
          } else if (phase === 'furnish') {
            set({ tool: 'item', catalogCategory: 'furniture' })
          }
        } else {
          // Reset to select mode and clear tool/catalog when switching phases
          set({ mode: 'select', tool: null, catalogCategory: null })
        }

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
      mode: DEFAULT_PERSISTED_EDITOR_UI_STATE.mode,
      setMode: (mode) => {
        set({ mode })

        const { phase, structureLayer, tool } = get()

        if (mode === 'build') {
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
      tool: DEFAULT_PERSISTED_EDITOR_UI_STATE.tool,
      setTool: (tool) => set({ tool }),
      structureLayer: DEFAULT_PERSISTED_EDITOR_UI_STATE.structureLayer,
      setStructureLayer: (layer) => {
        const { mode } = get()

        if (mode === 'build') {
          const tool = layer === 'zones' ? 'zone' : 'wall'
          set({ structureLayer: layer, tool })
        } else {
          set({ structureLayer: layer, mode: 'select', tool: null })
        }

        const viewer = useViewer.getState()
        viewer.setSelection({
          selectedIds: [],
          zoneId: null,
        })
      },
      catalogCategory: DEFAULT_PERSISTED_EDITOR_UI_STATE.catalogCategory,
      setCatalogCategory: (category) => set({ catalogCategory: category }),
      selectedItem: null,
      setSelectedItem: (item) => set({ selectedItem: item }),
      movingNode: null as ItemNode | WindowNode | DoorNode | RoofNode | RoofSegmentNode | null,
      setMovingNode: (node) => set({ movingNode: node }),
      selectedReferenceId: null,
      setSelectedReferenceId: (id) => set({ selectedReferenceId: id }),
      spaces: {},
      setSpaces: (spaces) => set({ spaces }),
      editingHole: null,
      setEditingHole: (hole) => set({ editingHole: hole }),
      isPreviewMode: false,
      setPreviewMode: (preview) => {
        if (preview) {
          set({ isPreviewMode: true, mode: 'select', tool: null, catalogCategory: null })
          // Clear zone/item selection for clean viewer drill-down hierarchy
          useViewer.getState().setSelection({ selectedIds: [], zoneId: null })
        } else {
          set({ isPreviewMode: false })
        }
      },
      isFloorplanOpen: DEFAULT_PERSISTED_EDITOR_UI_STATE.isFloorplanOpen,
      setFloorplanOpen: (open) => set({ isFloorplanOpen: open }),
      toggleFloorplanOpen: () => set((state) => ({ isFloorplanOpen: !state.isFloorplanOpen })),
      isFloorplanHovered: false,
      setFloorplanHovered: (hovered) => set({ isFloorplanHovered: hovered }),
      allowUndergroundCamera: false,
      setAllowUndergroundCamera: (enabled) => set({ allowUndergroundCamera: enabled }),
    }),
    {
      name: 'pascal-editor-ui-preferences',
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...normalizePersistedEditorUiState(persistedState as Partial<PersistedEditorUiState>),
      }),
      partialize: (state) => ({
        phase: state.phase,
        mode: state.mode,
        tool: state.tool,
        structureLayer: state.structureLayer,
        catalogCategory: state.catalogCategory,
        isFloorplanOpen: state.isFloorplanOpen,
      }),
    },
  ),
)

export default useEditor
