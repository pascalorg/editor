'use client'

import type { AssetInput } from '@pascal-app/core'
import {
  type AnyNodeId,
  type BuildingNode,
  type CeilingNode,
  type ColumnNode,
  type DoorNode,
  type ElevatorNode,
  type FenceNode,
  type ItemNode,
  type LevelNode,
  type RoofNode,
  type RoofSegmentNode,
  type RoofSurfaceMaterialRole,
  type SlabNode,
  type Space,
  type SpawnNode,
  type StairNode,
  type StairSegmentNode,
  type StairSurfaceMaterialRole,
  useScene,
  type WallNode,
  type WallSurfaceSide,
  type WindowNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  type ActivePaintMaterial,
  type PaintableMaterialTarget,
  resolveActivePaintMaterialFromSelection,
  resolvePaintTargetFromSelection,
  type SingleSurfaceMaterialRole,
} from '../lib/material-paint'

const DEFAULT_ACTIVE_SIDEBAR_PANEL = 'ai'
const DEFAULT_FLOORPLAN_PANE_RATIO = 0.5
const MIN_FLOORPLAN_PANE_RATIO = 0.15
const MAX_FLOORPLAN_PANE_RATIO = 0.85

export type ViewMode = '3d' | '2d' | 'split'
export type SplitOrientation = 'horizontal' | 'vertical'

export type Phase = 'site' | 'structure' | 'furnish'

export type Mode = 'select' | 'edit' | 'delete' | 'build' | 'material-paint'

// Structure mode tools (building elements)
export type StructureTool =
  | 'wall'
  | 'fence'
  | 'room'
  | 'custom-room'
  | 'slab'
  | 'ceiling'
  | 'roof'
  | 'column'
  | 'elevator'
  | 'stair'
  | 'item'
  | 'zone'
  | 'spawn'
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

export type FloorplanSelectionTool = 'click' | 'marquee'
export type GridSnapStep = 0.5 | 0.25 | 0.1 | 0.05

// Combined tool type
export type Tool = SiteTool | StructureTool | FurnishTool

export type MovingWallEndpoint = {
  wall: WallNode
  endpoint: 'start' | 'end'
}

export type MovingFenceEndpoint = {
  fence: FenceNode
  endpoint: 'start' | 'end'
}

export type MaterialTargetRole =
  | WallSurfaceSide
  | StairSurfaceMaterialRole
  | RoofSurfaceMaterialRole
  | SingleSurfaceMaterialRole

export type SelectedMaterialTarget = {
  nodeId: AnyNodeId
  role: MaterialTargetRole
}

type MaterialPaintSelectionSnapshot = {
  selectedId: string | null
  activePaintTarget: PaintableMaterialTarget
  activePaintMaterial: ActivePaintMaterial | null
}

export type GuideUiState = {
  locked?: boolean
  scaleReferenceVisible?: boolean
}

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
  movingNode:
    | ItemNode
    | WindowNode
    | DoorNode
    | ElevatorNode
    | CeilingNode
    | ColumnNode
    | SlabNode
    | WallNode
    | FenceNode
    | RoofNode
    | RoofSegmentNode
    | SpawnNode
    | StairNode
    | StairSegmentNode
    | BuildingNode
    | null
  setMovingNode: (
    node:
      | ItemNode
      | WindowNode
      | DoorNode
      | ElevatorNode
      | CeilingNode
      | ColumnNode
      | SlabNode
      | WallNode
      | FenceNode
      | RoofNode
      | RoofSegmentNode
      | SpawnNode
      | StairNode
      | StairSegmentNode
      | BuildingNode
      | null,
  ) => void
  movingWallEndpoint: MovingWallEndpoint | null
  setMovingWallEndpoint: (value: MovingWallEndpoint | null) => void
  movingFenceEndpoint: MovingFenceEndpoint | null
  setMovingFenceEndpoint: (value: MovingFenceEndpoint | null) => void
  curvingWall: WallNode | null
  setCurvingWall: (wall: WallNode | null) => void
  curvingFence: FenceNode | null
  setCurvingFence: (fence: FenceNode | null) => void
  selectedMaterialTarget: SelectedMaterialTarget | null
  setSelectedMaterialTarget: (target: SelectedMaterialTarget | null) => void
  activePaintMaterial: ActivePaintMaterial | null
  setActivePaintMaterial: (material: ActivePaintMaterial | null) => void
  activePaintTarget: PaintableMaterialTarget
  setActivePaintTarget: (target: PaintableMaterialTarget) => void
  primeMaterialPaintFromSelection: () => MaterialPaintSelectionSnapshot
  hoveredPaintTarget: PaintableMaterialTarget | null
  setHoveredPaintTarget: (target: PaintableMaterialTarget | null) => void
  isPaintPanelOpen: boolean
  setPaintPanelOpen: (open: boolean) => void
  selectedReferenceId: string | null
  setSelectedReferenceId: (id: string | null) => void
  guideUi: Record<string, GuideUiState>
  setGuideLocked: (guideId: string, locked: boolean) => void
  setGuideScaleReferenceVisible: (guideId: string, visible: boolean) => void
  clearGuideUi: (guideId: string) => void
  // Space detection for cutaway mode
  spaces: Record<string, Space>
  setSpaces: (spaces: Record<string, Space>) => void
  // Generic hole editing (works for slabs, ceilings, and any future polygon nodes)
  editingHole: { nodeId: string; holeIndex: number } | null
  setEditingHole: (hole: { nodeId: string; holeIndex: number } | null) => void
  // Preview mode (viewer-like experience inside the editor)
  isPreviewMode: boolean
  setPreviewMode: (preview: boolean) => void
  // Capture mode (snapshot toolbar — hides panels for clean framing)
  isCaptureMode: boolean
  setCaptureMode: (active: boolean) => void
  // View mode (3D only, 2D only, or split 2D+3D)
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
  splitOrientation: SplitOrientation
  setSplitOrientation: (orientation: SplitOrientation) => void
  // Toggleable 2D floorplan overlay (backward compat — derived from viewMode)
  isFloorplanOpen: boolean
  setFloorplanOpen: (open: boolean) => void
  toggleFloorplanOpen: () => void
  isFloorplanHovered: boolean
  setFloorplanHovered: (hovered: boolean) => void
  floorplanSelectionTool: FloorplanSelectionTool
  setFloorplanSelectionTool: (tool: FloorplanSelectionTool) => void
  gridSnapStep: GridSnapStep
  setGridSnapStep: (step: GridSnapStep) => void
  showReferenceFloor: boolean
  toggleReferenceFloor: () => void
  setShowReferenceFloor: (show: boolean) => void
  referenceFloorOffset: number
  setReferenceFloorOffset: (offset: number) => void
  referenceFloorOpacity: number
  setReferenceFloorOpacity: (opacity: number) => void
  // Development-only camera debug flag for inspecting underside geometry
  allowUndergroundCamera: boolean
  setAllowUndergroundCamera: (enabled: boolean) => void
  // First-person walkthrough mode (street view)
  isFirstPersonMode: boolean
  _viewModeBeforeFirstPerson: ViewMode | null
  setFirstPersonMode: (enabled: boolean) => void
  activeSidebarPanel: string
  setActiveSidebarPanel: (id: string) => void
  setIsCaptureMode: (enabled: boolean) => void
  floorplanPaneRatio: number
  setFloorplanPaneRatio: (ratio: number) => void
  // Mobile-only: pixel height of the secondary panel sheet while open (0 when closed).
  // Read by the mobile layout so the viewer container can shrink to preview edits.
  mobilePanelSheetHeight: number
  setMobilePanelSheetHeight: (px: number) => void
}

export type PersistedEditorUiState = Pick<
  EditorState,
  'phase' | 'mode' | 'tool' | 'structureLayer' | 'catalogCategory' | 'isFloorplanOpen' | 'viewMode'
>

type PersistedEditorLayoutState = Pick<
  EditorState,
  | 'activeSidebarPanel'
  | 'floorplanPaneRatio'
  | 'splitOrientation'
  | 'floorplanSelectionTool'
  | 'gridSnapStep'
  | 'showReferenceFloor'
  | 'referenceFloorOffset'
  | 'referenceFloorOpacity'
>
type PersistedEditorState = PersistedEditorUiState & PersistedEditorLayoutState

export const DEFAULT_PERSISTED_EDITOR_UI_STATE: PersistedEditorUiState = {
  phase: 'site',
  mode: 'select',
  tool: null,
  structureLayer: 'elements',
  catalogCategory: null,
  isFloorplanOpen: false,
  viewMode: '3d',
}

export const DEFAULT_PERSISTED_EDITOR_LAYOUT_STATE: PersistedEditorLayoutState = {
  activeSidebarPanel: DEFAULT_ACTIVE_SIDEBAR_PANEL,
  floorplanPaneRatio: DEFAULT_FLOORPLAN_PANE_RATIO,
  splitOrientation: 'horizontal',
  floorplanSelectionTool: 'click',
  gridSnapStep: 0.5,
  showReferenceFloor: false,
  referenceFloorOffset: 1,
  referenceFloorOpacity: 0.35,
}

const GRID_SNAP_STEPS: GridSnapStep[] = [0.5, 0.25, 0.1, 0.05]

function normalizeModeForPhase(phase: Phase, mode: Mode | undefined): Mode {
  if (phase === 'site') {
    return 'select'
  }

  return mode === 'build' || mode === 'delete' || mode === 'material-paint' ? mode : 'select'
}

function normalizeFloorplanPaneRatio(value: unknown): number {
  if (!(typeof value === 'number' && Number.isFinite(value))) {
    return DEFAULT_FLOORPLAN_PANE_RATIO
  }

  return Math.min(MAX_FLOORPLAN_PANE_RATIO, Math.max(MIN_FLOORPLAN_PANE_RATIO, value))
}

export function normalizePersistedEditorUiState(
  state: Partial<PersistedEditorUiState> | null | undefined,
): PersistedEditorUiState {
  const phase = state?.phase === 'structure' || state?.phase === 'furnish' ? state.phase : 'site'
  const mode = normalizeModeForPhase(phase, state?.mode)

  // Migrate old isFloorplanOpen to viewMode
  let viewMode: ViewMode = '3d'
  if (state?.viewMode === '2d' || state?.viewMode === '3d' || state?.viewMode === 'split') {
    viewMode = state.viewMode
  } else if (state?.isFloorplanOpen) {
    viewMode = 'split'
  }
  const isFloorplanOpen = viewMode !== '3d'

  if (phase === 'site') {
    return {
      ...DEFAULT_PERSISTED_EDITOR_UI_STATE,
      phase,
      mode,
      viewMode,
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
      viewMode,
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
      viewMode,
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
      viewMode,
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
    viewMode,
    isFloorplanOpen,
  }
}

function normalizePersistedEditorLayoutState(
  state: Partial<PersistedEditorLayoutState> | null | undefined,
): PersistedEditorLayoutState {
  return {
    activeSidebarPanel:
      typeof state?.activeSidebarPanel === 'string' && state.activeSidebarPanel.trim()
        ? state.activeSidebarPanel
        : DEFAULT_ACTIVE_SIDEBAR_PANEL,
    floorplanPaneRatio: normalizeFloorplanPaneRatio(state?.floorplanPaneRatio),
    splitOrientation: state?.splitOrientation === 'vertical' ? 'vertical' : 'horizontal',
    floorplanSelectionTool: state?.floorplanSelectionTool === 'marquee' ? 'marquee' : 'click',
    gridSnapStep: GRID_SNAP_STEPS.includes(state?.gridSnapStep as GridSnapStep)
      ? (state?.gridSnapStep as GridSnapStep)
      : DEFAULT_PERSISTED_EDITOR_LAYOUT_STATE.gridSnapStep,
    showReferenceFloor: state?.showReferenceFloor === true,
    referenceFloorOffset:
      typeof state?.referenceFloorOffset === 'number' && state.referenceFloorOffset >= 1
        ? Math.floor(state.referenceFloorOffset)
        : DEFAULT_PERSISTED_EDITOR_LAYOUT_STATE.referenceFloorOffset,
    referenceFloorOpacity:
      typeof state?.referenceFloorOpacity === 'number' &&
      Number.isFinite(state.referenceFloorOpacity)
        ? Math.min(0.8, Math.max(0.1, state.referenceFloorOpacity))
        : DEFAULT_PERSISTED_EDITOR_LAYOUT_STATE.referenceFloorOpacity,
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
    normalizedState.isFloorplanOpen !== DEFAULT_PERSISTED_EDITOR_UI_STATE.isFloorplanOpen ||
    normalizedState.viewMode !== DEFAULT_PERSISTED_EDITOR_UI_STATE.viewMode
  )
}

/**
 * Selects the first building and level 0 in the scene.
 * Safe to call any time — no-ops if already selected or scene is empty.
 */
export function selectDefaultBuildingAndLevel() {
  const viewer = useViewer.getState()
  const scene = useScene.getState()

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
    } else {
      // Fallback to first level if level 0 doesn't exist
      const firstLevelId = buildingNode.children.find(
        (childId) => scene.nodes[childId]?.type === 'level',
      )
      if (firstLevelId) {
        viewer.setSelection({ levelId: firstLevelId as LevelNode['id'] })
      }
    }
  }
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

        switch (phase) {
          case 'site':
            // In Site mode, we zoom out and deselect specific levels/buildings
            viewer.resetSelection()
            break

          case 'structure':
            selectDefaultBuildingAndLevel()
            break

          case 'furnish':
            selectDefaultBuildingAndLevel()
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
        } else if (mode === 'material-paint') {
          get().primeMaterialPaintFromSelection()
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
      movingNode: null as
        | ItemNode
        | WindowNode
        | DoorNode
        | ElevatorNode
        | CeilingNode
        | ColumnNode
        | SlabNode
        | WallNode
        | FenceNode
        | RoofNode
        | RoofSegmentNode
        | SpawnNode
        | StairNode
        | StairSegmentNode
        | BuildingNode
        | null,
      setMovingNode: (node) => set({ movingNode: node }),
      movingWallEndpoint: null,
      setMovingWallEndpoint: (value) => set({ movingWallEndpoint: value }),
      movingFenceEndpoint: null,
      setMovingFenceEndpoint: (value) => set({ movingFenceEndpoint: value }),
      curvingWall: null,
      setCurvingWall: (wall) => set({ curvingWall: wall }),
      curvingFence: null,
      setCurvingFence: (fence) => set({ curvingFence: fence }),
      selectedMaterialTarget: null,
      setSelectedMaterialTarget: (target) => set({ selectedMaterialTarget: target }),
      activePaintMaterial: null,
      setActivePaintMaterial: (material) => set({ activePaintMaterial: material }),
      activePaintTarget: 'wall',
      setActivePaintTarget: (target) =>
        set((state) =>
          state.activePaintTarget === target ? state : { activePaintTarget: target },
        ),
      primeMaterialPaintFromSelection: () => {
        const selectedId =
          useViewer.getState().selection.selectedIds.length === 1
            ? (useViewer.getState().selection.selectedIds[0] ?? null)
            : null
        const activePaintTarget =
          resolvePaintTargetFromSelection({
            nodes: useScene.getState().nodes,
            selectedId,
          }) ?? get().activePaintTarget
        const activePaintMaterial = resolveActivePaintMaterialFromSelection({
          nodes: useScene.getState().nodes,
          selectedId,
          selectedMaterialTarget: get().selectedMaterialTarget,
        })

        set({
          activePaintTarget,
          ...(activePaintMaterial ? { activePaintMaterial } : {}),
        })

        return {
          selectedId,
          activePaintTarget,
          activePaintMaterial: activePaintMaterial ?? get().activePaintMaterial,
        }
      },
      hoveredPaintTarget: null,
      setHoveredPaintTarget: (target) =>
        set((state) =>
          state.hoveredPaintTarget === target ? state : { hoveredPaintTarget: target },
        ),
      isPaintPanelOpen: false,
      setPaintPanelOpen: (open) => set({ isPaintPanelOpen: open }),
      selectedReferenceId: null,
      setSelectedReferenceId: (id) => set({ selectedReferenceId: id }),
      guideUi: {},
      setGuideLocked: (guideId, locked) =>
        set((state) => ({
          guideUi: {
            ...state.guideUi,
            [guideId]: {
              ...state.guideUi[guideId],
              locked,
            },
          },
        })),
      setGuideScaleReferenceVisible: (guideId, visible) =>
        set((state) => ({
          guideUi: {
            ...state.guideUi,
            [guideId]: {
              ...state.guideUi[guideId],
              scaleReferenceVisible: visible,
            },
          },
        })),
      clearGuideUi: (guideId) =>
        set((state) => {
          if (!state.guideUi[guideId]) {
            return state
          }
          const guideUi = { ...state.guideUi }
          delete guideUi[guideId]
          return { guideUi }
        }),
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
      isCaptureMode: false,
      setCaptureMode: (active) => set({ isCaptureMode: active }),
      viewMode: DEFAULT_PERSISTED_EDITOR_UI_STATE.viewMode,
      setViewMode: (mode) => set({ viewMode: mode, isFloorplanOpen: mode !== '3d' }),
      splitOrientation: DEFAULT_PERSISTED_EDITOR_LAYOUT_STATE.splitOrientation,
      setSplitOrientation: (orientation) => set({ splitOrientation: orientation }),
      isFloorplanOpen: DEFAULT_PERSISTED_EDITOR_UI_STATE.isFloorplanOpen,
      setFloorplanOpen: (open) => set({ isFloorplanOpen: open, viewMode: open ? 'split' : '3d' }),
      toggleFloorplanOpen: () =>
        set((state) => {
          const open = !state.isFloorplanOpen
          return { isFloorplanOpen: open, viewMode: open ? 'split' : '3d' }
        }),
      isFloorplanHovered: false,
      setFloorplanHovered: (hovered) => set({ isFloorplanHovered: hovered }),
      floorplanSelectionTool: 'click' as FloorplanSelectionTool,
      setFloorplanSelectionTool: (tool) => set({ floorplanSelectionTool: tool }),
      gridSnapStep: DEFAULT_PERSISTED_EDITOR_LAYOUT_STATE.gridSnapStep,
      setGridSnapStep: (step) => set({ gridSnapStep: step }),
      showReferenceFloor: DEFAULT_PERSISTED_EDITOR_LAYOUT_STATE.showReferenceFloor,
      toggleReferenceFloor: () =>
        set((state) => ({ showReferenceFloor: !state.showReferenceFloor })),
      setShowReferenceFloor: (show) => set({ showReferenceFloor: show }),
      referenceFloorOffset: DEFAULT_PERSISTED_EDITOR_LAYOUT_STATE.referenceFloorOffset,
      setReferenceFloorOffset: (offset) =>
        set({ referenceFloorOffset: Math.max(1, Math.floor(offset)) }),
      referenceFloorOpacity: DEFAULT_PERSISTED_EDITOR_LAYOUT_STATE.referenceFloorOpacity,
      setReferenceFloorOpacity: (opacity) =>
        set({ referenceFloorOpacity: Math.min(0.8, Math.max(0.1, opacity)) }),
      allowUndergroundCamera: false,
      setAllowUndergroundCamera: (enabled) => set({ allowUndergroundCamera: enabled }),
      isFirstPersonMode: false,
      _viewModeBeforeFirstPerson: null as ViewMode | null,
      setFirstPersonMode: (enabled) => {
        if (enabled) {
          const currentViewMode = get().viewMode
          set({
            isFirstPersonMode: true,
            _viewModeBeforeFirstPerson: currentViewMode,
            viewMode: '3d',
            isFloorplanOpen: false,
            mode: 'select',
            tool: null,
            catalogCategory: null,
          })
        } else {
          const prevMode = get()._viewModeBeforeFirstPerson
          set({
            isFirstPersonMode: false,
            _viewModeBeforeFirstPerson: null,
            ...(prevMode ? { viewMode: prevMode, isFloorplanOpen: prevMode !== '3d' } : {}),
          })
        }
      },
      activeSidebarPanel: DEFAULT_ACTIVE_SIDEBAR_PANEL,
      setActiveSidebarPanel: (id) => set({ activeSidebarPanel: id }),
      setIsCaptureMode: (enabled) => set({ isCaptureMode: enabled }),
      floorplanPaneRatio: DEFAULT_PERSISTED_EDITOR_LAYOUT_STATE.floorplanPaneRatio,
      setFloorplanPaneRatio: (ratio) =>
        set({ floorplanPaneRatio: normalizeFloorplanPaneRatio(ratio) }),
      mobilePanelSheetHeight: 0,
      setMobilePanelSheetHeight: (px) => set({ mobilePanelSheetHeight: Math.max(0, px) }),
    }),
    {
      name: 'pascal-editor-ui-preferences',
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...normalizePersistedEditorUiState(persistedState as Partial<PersistedEditorState>),
        ...normalizePersistedEditorLayoutState(persistedState as Partial<PersistedEditorState>),
      }),
      partialize: (state) => ({
        phase: state.phase,
        mode: state.mode,
        tool: state.tool,
        structureLayer: state.structureLayer,
        catalogCategory: state.catalogCategory,
        isFloorplanOpen: state.isFloorplanOpen,
        viewMode: state.viewMode,
        activeSidebarPanel: state.activeSidebarPanel,
        floorplanPaneRatio: state.floorplanPaneRatio,
        splitOrientation: state.splitOrientation,
        floorplanSelectionTool: state.floorplanSelectionTool,
        gridSnapStep: state.gridSnapStep,
        showReferenceFloor: state.showReferenceFloor,
        referenceFloorOffset: state.referenceFloorOffset,
        referenceFloorOpacity: state.referenceFloorOpacity,
      }),
    },
  ),
)

export default useEditor
