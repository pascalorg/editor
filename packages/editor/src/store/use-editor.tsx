'use client'

import type { AssetInput } from '@pascal-app/core'
import {
  type AnyNodeId,
  type AssemblyNode,
  type BoxNode,
  type BuildingNode,
  type CableTrayNode,
  type CapsuleNode,
  type CeilingNode,
  type ColumnNode,
  type ConveyorBeltNode,
  type CylinderNode,
  type DataWidgetNode,
  type DoorNode,
  type ElevatorNode,
  type ExtrudeNode,
  type FenceNode,
  type HalfCylinderNode,
  type ItemNode,
  type LadderNode,
  type LatheNode,
  type LevelNode,
  type PipeFittingNode,
  type PipeNode,
  type RoadNode,
  type RoofNode,
  type RoofSegmentNode,
  type RoofSurfaceMaterialRole,
  type RoundedPanelNode,
  type SlabNode,
  type Space,
  type SpawnNode,
  type SphereNode,
  type StairNode,
  type StairSegmentNode,
  type StairSurfaceMaterialRole,
  type SteelBeamNode,
  type SteelFrameNode,
  type SweepNode,
  type TankNode,
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
  | 'pipe-fitting'
  | 'pipe'
  | 'conveyor-belt'
  | 'cable-tray'
  | 'ladder'
  | 'steel-beam'
  | 'steel-frame'
  | 'road'
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
  | 'shelf'
  | 'tank'
  | 'data-widget'
  | 'data-chart'
  | 'data-table'

// Furnish mode tools (items and decoration)
export type FurnishTool = 'item'

// Site mode tools
export type SiteTool = 'property-line'

// Catalog categories for furnish mode items
export type CatalogCategory = 'electronics' | 'equipment' | 'structural' | 'outdoor' | 'mine'

const FURNISH_CATALOG_CATEGORIES: CatalogCategory[] = [
  'electronics',
  'equipment',
  'structural',
  'outdoor',
  'mine',
]

function normalizeFurnishCatalogCategory(category: unknown): CatalogCategory {
  if (
    category === 'safety' ||
    category === 'lighting' ||
    category === 'electrical' ||
    category === 'hvac'
  ) {
    return 'electronics'
  }
  if (category === 'opening') {
    return 'structural'
  }
  if (category === 'infrastructure' || category === 'nature') {
    return 'outdoor'
  }
  if (category === 'vehicle') {
    return 'outdoor'
  }

  if (
    typeof category === 'string' &&
    FURNISH_CATALOG_CATEGORIES.includes(category as CatalogCategory)
  ) {
    return category as CatalogCategory
  }

  return 'electronics'
}

export type StructureLayer = 'zones' | 'elements' | 'industrial' | 'data'
export type StairPlacementType = 'straight' | 'curved' | 'spiral'

export type FloorplanSelectionTool = 'click' | 'marquee'
export type GridSnapStep = 0.5 | 0.25 | 0.1 | 0.05 | 0.01

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

export type MovingPipeEndpoint = {
  pipe: PipeNode
  endpoint: 'start' | 'end'
}

export type MovingCableTrayEndpoint = {
  cableTray: CableTrayNode
  endpoint: 'start' | 'end'
}

export type MovingConveyorBeltEndpoint = {
  conveyorBelt: ConveyorBeltNode
  endpoint: 'start' | 'end'
}

export type MovingRoadEndpoint = {
  road: RoadNode
  endpoint: 'start' | 'end'
}

export type MovingSteelBeamEndpoint = {
  steelBeam: SteelBeamNode
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

export type MovingNode =
  | AssemblyNode
  | ItemNode
  | WindowNode
  | DoorNode
  | ElevatorNode
  | CeilingNode
  | ColumnNode
  | SlabNode
  | WallNode
  | FenceNode
  | PipeFittingNode
  | PipeNode
  | ConveyorBeltNode
  | CableTrayNode
  | RoadNode
  | RoofNode
  | RoofSegmentNode
  | SpawnNode
  | StairNode
  | StairSegmentNode
  | BuildingNode
  | BoxNode
  | CylinderNode
  | SphereNode
  | LatheNode
  | CapsuleNode
  | HalfCylinderNode
  | RoundedPanelNode
  | ExtrudeNode
  | SweepNode
  | TankNode
  | DataWidgetNode
  | LadderNode
  | SteelBeamNode
  | SteelFrameNode

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
  stairPlacementType: StairPlacementType
  setStairPlacementType: (type: StairPlacementType) => void
  structureLayer: StructureLayer
  setStructureLayer: (layer: StructureLayer) => void
  catalogCategory: CatalogCategory | null
  setCatalogCategory: (category: CatalogCategory | null) => void
  selectedItem: AssetInput | null
  setSelectedItem: (item: AssetInput | null) => void
  editingAssemblyId: AnyNodeId | null
  setEditingAssemblyId: (id: AnyNodeId | null) => void
  movingNode: MovingNode | null
  setMovingNode: (node: MovingNode | null) => void
  placementDragMode: boolean
  setPlacementDragMode: (dragMode: boolean) => void
  movingNodeOrigin: '2d' | '3d' | null
  setMovingNodeOrigin: (origin: '2d' | '3d' | null) => void
  movingWallEndpoint: MovingWallEndpoint | null
  setMovingWallEndpoint: (value: MovingWallEndpoint | null) => void
  movingFenceEndpoint: MovingFenceEndpoint | null
  setMovingFenceEndpoint: (value: MovingFenceEndpoint | null) => void
  movingPipeEndpoint: MovingPipeEndpoint | null
  setMovingPipeEndpoint: (value: MovingPipeEndpoint | null) => void
  movingCableTrayEndpoint: MovingCableTrayEndpoint | null
  setMovingCableTrayEndpoint: (value: MovingCableTrayEndpoint | null) => void
  movingConveyorBeltEndpoint: MovingConveyorBeltEndpoint | null
  setMovingConveyorBeltEndpoint: (value: MovingConveyorBeltEndpoint | null) => void
  movingRoadEndpoint: MovingRoadEndpoint | null
  setMovingRoadEndpoint: (value: MovingRoadEndpoint | null) => void
  movingSteelBeamEndpoint: MovingSteelBeamEndpoint | null
  setMovingSteelBeamEndpoint: (value: MovingSteelBeamEndpoint | null) => void
  activeHandleDrag: { nodeId: AnyNodeId; label: string } | null
  setActiveHandleDrag: (drag: { nodeId: AnyNodeId; label: string } | null) => void
  curvingWall: WallNode | null
  setCurvingWall: (wall: WallNode | null) => void
  curvingFence: FenceNode | null
  setCurvingFence: (fence: FenceNode | null) => void
  curvingPipe: PipeNode | null
  setCurvingPipe: (pipe: PipeNode | null) => void
  curvingCableTray: CableTrayNode | null
  setCurvingCableTray: (cableTray: CableTrayNode | null) => void
  curvingRoad: RoadNode | null
  setCurvingRoad: (road: RoadNode | null) => void
  curvingSteelBeam: SteelBeamNode | null
  setCurvingSteelBeam: (steelBeam: SteelBeamNode | null) => void
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
  magneticSnap: boolean
  setMagneticSnap: (enabled: boolean) => void
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
  /** Atomically enter furnish + build + item tool (optionally open Items tab). */
  enterFurnishBuildMode: (options?: { openItemsPanel?: boolean }) => void
  /** Atomically enter structure + build (optionally open Scene tab). */
  enterStructureBuildMode: (options?: { layer?: StructureLayer; openSitePanel?: boolean }) => void
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
  | 'magneticSnap'
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
  magneticSnap: true,
  showReferenceFloor: false,
  referenceFloorOffset: 1,
  referenceFloorOpacity: 0.35,
}

const GRID_SNAP_STEPS: GridSnapStep[] = [0.5, 0.25, 0.1, 0.05, 0.01]

function normalizeModeForPhase(phase: Phase, mode: Mode | undefined): Mode {
  return 'select'
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
      catalogCategory:
        mode === 'build' ? normalizeFurnishCatalogCategory(state?.catalogCategory) : null,
      viewMode,
      isFloorplanOpen,
    }
  }

  const structureLayer =
    state?.structureLayer === 'zones'
      ? 'zones'
      : state?.structureLayer === 'industrial'
        ? 'industrial'
        : state?.structureLayer === 'data'
          ? 'data'
          : 'elements'

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

  if (structureLayer === 'industrial') {
    const industrialTool = state?.tool
    return {
      phase,
      mode,
      tool:
        industrialTool === 'pipe' ||
        industrialTool === 'pipe-fitting' ||
        industrialTool === 'tank' ||
        industrialTool === 'cable-tray' ||
        industrialTool === 'steel-beam' ||
        industrialTool === 'steel-frame' ||
        industrialTool === 'shelf'
          ? industrialTool
          : 'tank',
      structureLayer,
      catalogCategory: null,
      viewMode,
      isFloorplanOpen,
    }
  }

  if (structureLayer === 'data') {
    const dataTool = state?.tool
    return {
      phase,
      mode,
      tool:
        dataTool === 'data-widget' || dataTool === 'data-chart' || dataTool === 'data-table'
          ? dataTool
          : 'data-widget',
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
    catalogCategory:
      state?.tool === 'item' ? normalizeFurnishCatalogCategory(state.catalogCategory) : null,
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
    magneticSnap: state?.magneticSnap !== false,
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
        .map((childId) => scene.nodes[childId as AnyNodeId])
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

let viewModeBeforeCapture: ViewMode | null = null

const useEditor = create<EditorState>()(
  persist(
    (set, get) => ({
      phase: DEFAULT_PERSISTED_EDITOR_UI_STATE.phase,
      setPhase: (phase) => {
        const currentPhase = get().phase
        if (currentPhase === phase) return

        set({ phase, editingAssemblyId: null })

        const { mode, structureLayer } = get()

        if (mode === 'build') {
          // Stay in build mode, select the first tool for the new phase
          if (phase === 'site') {
            set({ tool: 'property-line', catalogCategory: null })
          } else if (phase === 'structure' && structureLayer === 'zones') {
            set({ tool: 'zone', catalogCategory: null })
          } else if (phase === 'structure' && structureLayer === 'industrial') {
            set({ tool: 'tank', catalogCategory: null })
          } else if (phase === 'structure' && structureLayer === 'data') {
            set({ tool: 'data-widget', catalogCategory: null })
          } else if (phase === 'structure') {
            set({ tool: 'wall', catalogCategory: null })
          } else if (phase === 'furnish') {
            set({ tool: 'item', catalogCategory: 'electronics' })
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
        set({ mode, ...(mode === 'select' ? {} : { editingAssemblyId: null }) })

        const { phase, structureLayer, tool } = get()

        if (mode === 'build') {
          // Ensure a tool is selected in build mode
          if (!tool) {
            if (phase === 'structure' && structureLayer === 'zones') {
              set({ tool: 'zone' })
            } else if (phase === 'structure' && structureLayer === 'industrial') {
              set({ tool: 'tank' })
            } else if (phase === 'structure' && structureLayer === 'data') {
              set({ tool: 'data-widget' })
            } else if (phase === 'structure' && structureLayer === 'elements') {
              set({ tool: 'wall' })
            } else if (phase === 'furnish') {
              set({ tool: 'item', catalogCategory: 'electronics' })
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
      stairPlacementType: 'straight',
      setStairPlacementType: (type) => set({ stairPlacementType: type }),
      structureLayer: DEFAULT_PERSISTED_EDITOR_UI_STATE.structureLayer,
      setStructureLayer: (layer) => {
        set({ editingAssemblyId: null })
        const { mode } = get()

        if (mode === 'build') {
          const tool =
            layer === 'zones'
              ? 'zone'
              : layer === 'industrial'
                ? 'tank'
                : layer === 'data'
                  ? 'data-widget'
                  : 'wall'
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
      editingAssemblyId: null,
      setEditingAssemblyId: (id) => set({ editingAssemblyId: id }),
      movingNode: null as MovingNode | null,
      placementDragMode: false,
      setPlacementDragMode: (dragMode) => set({ placementDragMode: dragMode }),
      setMovingNode: (node) =>
        set(
          node === null
            ? { movingNode: null, placementDragMode: false }
            : { movingNode: node, movingNodeOrigin: null },
        ),
      movingNodeOrigin: null as '2d' | '3d' | null,
      setMovingNodeOrigin: (origin) => set({ movingNodeOrigin: origin }),
      movingWallEndpoint: null,
      setMovingWallEndpoint: (value) => set({ movingWallEndpoint: value }),
      movingFenceEndpoint: null,
      setMovingFenceEndpoint: (value) => set({ movingFenceEndpoint: value }),
      movingPipeEndpoint: null,
      setMovingPipeEndpoint: (value) => set({ movingPipeEndpoint: value }),
      movingCableTrayEndpoint: null,
      setMovingCableTrayEndpoint: (value) => set({ movingCableTrayEndpoint: value }),
      movingConveyorBeltEndpoint: null,
      setMovingConveyorBeltEndpoint: (value) => set({ movingConveyorBeltEndpoint: value }),
      movingRoadEndpoint: null,
      setMovingRoadEndpoint: (value) => set({ movingRoadEndpoint: value }),
      movingSteelBeamEndpoint: null,
      setMovingSteelBeamEndpoint: (value) => set({ movingSteelBeamEndpoint: value }),
      activeHandleDrag: null,
      setActiveHandleDrag: (drag) => set({ activeHandleDrag: drag }),
      curvingWall: null,
      setCurvingWall: (wall) => set({ curvingWall: wall }),
      curvingFence: null,
      setCurvingFence: (fence) => set({ curvingFence: fence }),
      curvingPipe: null,
      setCurvingPipe: (pipe) => set({ curvingPipe: pipe }),
      curvingCableTray: null,
      setCurvingCableTray: (cableTray) => set({ curvingCableTray: cableTray }),
      curvingRoad: null,
      setCurvingRoad: (road) => set({ curvingRoad: road }),
      curvingSteelBeam: null,
      setCurvingSteelBeam: (steelBeam) => set({ curvingSteelBeam: steelBeam }),
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
          set({
            isPreviewMode: true,
            mode: 'select',
            tool: null,
            catalogCategory: null,
            editingAssemblyId: null,
          })
          // Clear zone/item selection for clean viewer drill-down hierarchy
          useViewer.getState().setSelection({ selectedIds: [], zoneId: null })
        } else {
          set({ isPreviewMode: false })
        }
      },
      isCaptureMode: false,
      setCaptureMode: (active) =>
        set((state) => {
          if (active) {
            if (state.viewMode !== '3d') {
              viewModeBeforeCapture = state.viewMode
              return {
                isCaptureMode: true,
                viewMode: '3d',
                isFloorplanOpen: false,
              }
            }

            return { isCaptureMode: true }
          }

          const restore = viewModeBeforeCapture
          viewModeBeforeCapture = null
          if (restore && restore !== '3d') {
            return {
              isCaptureMode: false,
              viewMode: restore,
              isFloorplanOpen: true,
            }
          }

          return { isCaptureMode: false }
        }),
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
      magneticSnap: DEFAULT_PERSISTED_EDITOR_LAYOUT_STATE.magneticSnap,
      setMagneticSnap: (enabled) => set({ magneticSnap: enabled }),
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
      enterFurnishBuildMode: (options) => {
        const openItemsPanel = options?.openItemsPanel !== false
        selectDefaultBuildingAndLevel()
        set({
          phase: 'furnish',
          mode: 'build',
          tool: 'item',
          catalogCategory: normalizeFurnishCatalogCategory(get().catalogCategory),
          structureLayer: 'elements',
          ...(openItemsPanel ? { activeSidebarPanel: 'items' } : {}),
        })
      },
      enterStructureBuildMode: (options) => {
        const layer = options?.layer ?? 'elements'
        const openSitePanel = options?.openSitePanel !== false
        selectDefaultBuildingAndLevel()
        useViewer.getState().setSelection({ selectedIds: [], zoneId: null })
        set({
          phase: 'structure',
          mode: 'build',
          structureLayer: layer,
          tool:
            layer === 'zones'
              ? 'zone'
              : layer === 'industrial'
                ? 'tank'
                : layer === 'data'
                  ? 'data-widget'
                  : 'wall',
          catalogCategory: null,
          ...(openSitePanel ? { activeSidebarPanel: 'site' } : {}),
        })
      },
      setIsCaptureMode: (enabled) => get().setCaptureMode(enabled),
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
      skipHydration: true,
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
        magneticSnap: state.magneticSnap,
        showReferenceFloor: state.showReferenceFloor,
        referenceFloorOffset: state.referenceFloorOffset,
        referenceFloorOpacity: state.referenceFloorOpacity,
      }),
    },
  ),
)

export default useEditor
