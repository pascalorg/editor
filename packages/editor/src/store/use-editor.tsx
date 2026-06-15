'use client'

import type { AssetInput } from '@pascal-app/core'
import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  type CeilingNode,
  type ChimneyMaterialRole,
  type ChimneyNode,
  type ColumnNode,
  type DoorNode,
  type DormerNode,
  type DormerSurfaceMaterialRole,
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
export type WorkspaceMode = 'edit' | 'studio'

// Snapshot capture is invoked from two surfaces with different policies.
// `standard` mirrors the existing user-driven UX — pick region / viewport /
// area, save the blob as a project thumbnail. `preset` is the constrained
// variant for the unified preset capture flow (community save-as-preset
// modal): the overlay locks to a square crop, the renderer clears alpha
// (transparent background), and the rendered set is locked to `isolated`
// — `ThumbnailGenerator` consults `captureMode.mode === 'preset'` and
// applies those constraints. Keeping it a discriminated union lets us
// add future modes without surfacing the choice to end users.
export type CaptureMode =
  | { mode: 'idle' }
  | { mode: 'standard' }
  | {
      mode: 'preset'
      isolated: AnyNodeId[]
      framingBounds?: {
        min: [number, number]
        max: [number, number]
        center: [number, number]
        size: [number, number]
      }
    }

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
  | 'shelf'
  | 'box-vent'
  | 'ridge-vent'
  | 'turbine-vent'
  | 'cupola'
  | 'eyebrow-vent'
  | 'chimney'
  | 'solar-panel'
  | 'skylight'
  | 'dormer'
  | 'gutter'
  | 'downspout'
  | 'duct-segment'
  | 'duct-fitting'
  | 'duct-terminal'
  | 'hvac-equipment'
  | 'lineset'
  | 'liquid-line'
  | 'pipe-segment'
  | 'pipe-fitting'

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

export type NavigationSyncSource = '2d' | '3d'

export type NavigationSyncPose = {
  source: NavigationSyncSource
  revision: number
  target: [number, number, number]
  azimuth: number
  viewWidth: number
}

export type NavigationSyncPoseInput = Omit<NavigationSyncPose, 'revision'>

// Combined tool type
export type Tool = SiteTool | StructureTool | FurnishTool

/**
 * Starting parameters seeded into a draw tool before it mints a node.
 * A loose param bag — the tool's create path validates it through the
 * kind's schema (`FenceNode.parse({ ...defaults, start, end })`), which
 * is the real type gate, so unknown keys are simply ignored.
 */
export type ToolDefaults = Record<string, unknown>

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
  | ChimneyMaterialRole
  | DormerSurfaceMaterialRole
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

export type SurfaceHoleTarget = { nodeId: string; holeIndex: number }

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
  /**
   * Per-tool starting parameters for the next node a draw tool mints.
   * Transient (not persisted): host apps seed an entry just before
   * activating the tool (placing a drawn preset, or a future dimension
   * picker), the tool's create path merges it, and the tool clears its
   * own entry on deactivation so a later manual draw isn't poisoned.
   */
  toolDefaults: Partial<Record<Tool, ToolDefaults>>
  setToolDefaults: (tool: Tool, defaults: ToolDefaults | null) => void
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
    | ChimneyNode
    | ColumnNode
    | DormerNode
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
  /**
   * True while a move was engaged by a press-drag gizmo (the on-canvas move
   * cross) rather than a click-to-place flow. The placement coordinator reads
   * this to commit on pointer-release instead of waiting for a click.
   */
  placementDragMode: boolean
  setPlacementDragMode: (dragMode: boolean) => void
  setMovingNode: (
    node:
      | ItemNode
      | WindowNode
      | DoorNode
      | ElevatorNode
      | CeilingNode
      | ChimneyNode
      | ColumnNode
      | DormerNode
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
  /**
   * Which view (2D floor plan or 3D viewer) most recently completed
   * the active move — set by the committing or cancelling side just
   * before clearing `movingNode`. Lets the *other* side's effect
   * cleanup skip its own restore-from-snapshot when the drag was
   * already finalised elsewhere (split view mounts both the 2D
   * overlay and the 3D move tool for the same `movingNode`).
   *
   * Reset to null when the next non-null `setMovingNode` starts a
   * fresh drag (so stale values from the previous drag don't poison
   * cleanups). Preserved across `setMovingNode(null)` so the
   * non-owning side's cleanup — which fires after the clear
   * propagates — can still read who finalised. Null while a drag
   * is in progress means "no side has claimed it yet" — both
   * cleanups then restore to their pre-drag snapshot, which is the
   * same baseline, so the result is idempotent.
   */
  movingNodeOrigin: '2d' | '3d' | null
  setMovingNodeOrigin: (origin: '2d' | '3d' | null) => void
  movingWallEndpoint: MovingWallEndpoint | null
  setMovingWallEndpoint: (value: MovingWallEndpoint | null) => void
  movingFenceEndpoint: MovingFenceEndpoint | null
  setMovingFenceEndpoint: (value: MovingFenceEndpoint | null) => void
  /**
   * Generic per-kind handle drag state. Set by a node's resize handle
   * (height arrow, width arrow, rise / sweep / inner-radius for curved
   * stairs, …) at drag-start and cleared on drag-end. `label`
   * identifies which dimension the handle controls — measurement
   * overlays read it to render the right caption; the camera controls
   * use the truthy value to suppress one-finger pan-rotate. Replaces
   * the previous per-kind `resizing*` fields so adding a new resize
   * handle doesn't require a new store field.
   */
  activeHandleDrag: { nodeId: AnyNodeId; label: string } | null
  setActiveHandleDrag: (drag: { nodeId: AnyNodeId; label: string } | null) => void
  /**
   * World axis the R/T keyboard rotation turns around, for kinds with
   * full 3D orientation (duct fittings). Alt cycles it Y → X → Z; the
   * kind's tool / keyboard actions read it, and the floating action
   * menu surfaces it in a pill above the selected node.
   */
  rotationAxis: 'x' | 'y' | 'z'
  cycleRotationAxis: () => 'x' | 'y' | 'z'
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
  // When true, clicking a surface in paint mode clears it back to its
  // default material instead of applying `activePaintMaterial`.
  paintEraser: boolean
  setPaintEraser: (eraser: boolean) => void
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
  editingHole: SurfaceHoleTarget | null
  setEditingHole: (hole: SurfaceHoleTarget | null) => void
  hoveredHole: SurfaceHoleTarget | null
  setHoveredHole: (hole: SurfaceHoleTarget | null) => void
  // Preview mode (viewer-like experience inside the editor)
  isPreviewMode: boolean
  setPreviewMode: (preview: boolean) => void
  // Capture mode (snapshot toolbar — hides panels for clean framing).
  // `captureMode` is the canonical discriminated-union state; the boolean
  // `isCaptureMode` is kept synced as a derived convenience for the many
  // existing read sites that just gate chrome visibility on "is capture
  // active". New write sites should pass a `CaptureMode` shape; passing a
  // boolean is accepted as a back-compat shim (`true` → `'standard'`,
  // `false` → `'idle'`).
  captureMode: CaptureMode
  isCaptureMode: boolean
  setCaptureMode: (next: boolean | CaptureMode) => void
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
  // Toggleable DWV riser-diagram (plumbing isometric) overlay.
  isRiserOpen: boolean
  setRiserOpen: (open: boolean) => void
  toggleRiserOpen: () => void
  navigationSyncPose: NavigationSyncPose | null
  publishNavigationSyncPose: (pose: NavigationSyncPoseInput) => void
  floorplanSelectionTool: FloorplanSelectionTool
  setFloorplanSelectionTool: (tool: FloorplanSelectionTool) => void
  gridSnapStep: GridSnapStep
  setGridSnapStep: (step: GridSnapStep) => void
  // Magnetic snapping while drafting — snaps wall endpoints onto existing
  // wall corners / wall bodies (the "magnetic" beacon). Independent of grid
  // snap. On by default; toggled from the Display menu.
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
  // Workspace mode: 'edit' is the full editing surface; 'studio' is the
  // render/snapshot surface (clean canvas, no editing chrome or selection).
  // Entering studio forces a 3D-only view and restores the prior view on exit.
  workspaceMode: WorkspaceMode
  _viewModeBeforeStudio: ViewMode | null
  setWorkspaceMode: (mode: WorkspaceMode) => void
  activeSidebarPanel: string
  setActiveSidebarPanel: (id: string) => void
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

const GRID_SNAP_STEPS: GridSnapStep[] = [0.5, 0.25, 0.1, 0.05]

type SelectDefaultBuildingAndLevelOptions = {
  forceGroundLevel?: boolean
}

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
    // Default on: only an explicit persisted `false` disables it.
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

function getDefaultLevelId(
  buildingNode: BuildingNode,
  nodes: Record<string, AnyNode>,
): LevelNode['id'] | null {
  const levels = buildingNode.children
    .map((childId) => nodes[childId as AnyNodeId])
    .filter((node): node is LevelNode => node?.type === 'level')

  if (levels.length === 0) {
    return null
  }

  const groundLevel = levels.find((level) => level.level === 0)
  if (groundLevel) {
    return groundLevel.id
  }

  const firstLevel = levels[0]
  if (!firstLevel) {
    return null
  }

  let lowestLevel = firstLevel
  for (const level of levels.slice(1)) {
    if (level.level < lowestLevel.level) {
      lowestLevel = level
    }
  }

  return lowestLevel.id
}

/**
 * Selects the first building and level 0 in the scene.
 * Safe to call any time — no-ops if already selected or scene is empty.
 */
export function selectDefaultBuildingAndLevel(options: SelectDefaultBuildingAndLevelOptions = {}) {
  const viewer = useViewer.getState()
  const scene = useScene.getState()

  const selectedBuilding = viewer.selection.buildingId
    ? scene.nodes[viewer.selection.buildingId]
    : null
  let buildingNode =
    selectedBuilding?.type === 'building' ? (selectedBuilding as BuildingNode) : null

  // If no building selected, find the first one from site's children
  if (!buildingNode) {
    const siteNode = scene.rootNodeIds[0] ? scene.nodes[scene.rootNodeIds[0]] : null
    if (siteNode?.type === 'site') {
      buildingNode =
        siteNode.children
          .map((childId) => scene.nodes[childId as AnyNodeId])
          .find((node): node is BuildingNode => node?.type === 'building') ?? null
    }
  }

  if (!buildingNode) {
    return
  }

  const selectedLevel = viewer.selection.levelId ? scene.nodes[viewer.selection.levelId] : null
  const selectedLevelBelongsToBuilding =
    selectedLevel?.type === 'level' && selectedLevel.parentId === buildingNode.id
  const shouldSelectDefaultLevel = options.forceGroundLevel || !selectedLevelBelongsToBuilding
  const defaultLevelId = shouldSelectDefaultLevel
    ? getDefaultLevelId(buildingNode, scene.nodes as Record<string, AnyNode>)
    : null

  const selectionUpdate: Parameters<typeof viewer.setSelection>[0] = {}
  if (viewer.selection.buildingId !== buildingNode.id) {
    selectionUpdate.buildingId = buildingNode.id
  }
  if (defaultLevelId) {
    selectionUpdate.levelId = defaultLevelId
  }

  if (Object.keys(selectionUpdate).length > 0) {
    viewer.setSelection(selectionUpdate)
  }
}

export function selectSiteFloorplanContext() {
  selectDefaultBuildingAndLevel({ forceGroundLevel: true })
  useViewer.getState().setSelection({
    selectedIds: [],
    zoneId: null,
  })
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

        switch (phase) {
          case 'site':
            selectSiteFloorplanContext()
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
      toolDefaults: {},
      setToolDefaults: (tool, defaults) =>
        set((state) => {
          const next = { ...state.toolDefaults }
          if (defaults === null) {
            delete next[tool]
          } else {
            next[tool] = defaults
          }
          return { toolDefaults: next }
        }),
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
      placementDragMode: false,
      setPlacementDragMode: (dragMode) => set({ placementDragMode: dragMode }),
      setMovingNode: (node) =>
        set(
          node === null
            ? // Preserve `movingNodeOrigin` across the clear so the
              // non-owning side's effect cleanup — which fires after
              // `setMovingNode(null)` propagates — can still read who
              // finalised. The next non-null `setMovingNode` resets it.
              // Always clear the press-drag flag when a move ends.
              { movingNode: null, placementDragMode: false }
            : { movingNode: node, movingNodeOrigin: null },
        ),
      movingNodeOrigin: null as '2d' | '3d' | null,
      setMovingNodeOrigin: (origin) => set({ movingNodeOrigin: origin }),
      movingWallEndpoint: null,
      setMovingWallEndpoint: (value) => set({ movingWallEndpoint: value }),
      movingFenceEndpoint: null,
      setMovingFenceEndpoint: (value) => set({ movingFenceEndpoint: value }),
      activeHandleDrag: null,
      setActiveHandleDrag: (drag) => set({ activeHandleDrag: drag }),
      rotationAxis: 'y',
      cycleRotationAxis: () => {
        const order = ['y', 'x', 'z'] as const
        const next = order[(order.indexOf(get().rotationAxis as 'y' | 'x' | 'z') + 1) % 3]!
        set({ rotationAxis: next })
        return next
      },
      curvingWall: null,
      setCurvingWall: (wall) => set({ curvingWall: wall }),
      curvingFence: null,
      setCurvingFence: (fence) => set({ curvingFence: fence }),
      selectedMaterialTarget: null,
      setSelectedMaterialTarget: (target) => set({ selectedMaterialTarget: target }),
      activePaintMaterial: null,
      // Picking a material implies paint, not erase — clear the eraser so the
      // next click applies the chosen material.
      setActivePaintMaterial: (material) =>
        set({ activePaintMaterial: material, paintEraser: false }),
      activePaintTarget: 'wall',
      setActivePaintTarget: (target) =>
        set((state) =>
          state.activePaintTarget === target ? state : { activePaintTarget: target },
        ),
      paintEraser: false,
      setPaintEraser: (eraser) => set({ paintEraser: eraser }),
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
      hoveredHole: null,
      setHoveredHole: (hole) =>
        set((state) =>
          state.hoveredHole?.nodeId === hole?.nodeId &&
          state.hoveredHole?.holeIndex === hole?.holeIndex
            ? state
            : { hoveredHole: hole },
        ),
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
      captureMode: { mode: 'idle' } as CaptureMode,
      isCaptureMode: false,
      setCaptureMode: (next) => {
        const resolved: CaptureMode =
          typeof next === 'boolean' ? { mode: next ? 'standard' : 'idle' } : next
        set({ captureMode: resolved, isCaptureMode: resolved.mode !== 'idle' })
      },
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
      isRiserOpen: false,
      setRiserOpen: (open) => set({ isRiserOpen: open }),
      toggleRiserOpen: () => set((state) => ({ isRiserOpen: !state.isRiserOpen })),
      navigationSyncPose: null,
      publishNavigationSyncPose: (pose) =>
        set((state) => ({
          navigationSyncPose: {
            ...pose,
            revision: (state.navigationSyncPose?.revision ?? 0) + 1,
          },
        })),
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
      workspaceMode: 'edit' as WorkspaceMode,
      _viewModeBeforeStudio: null as ViewMode | null,
      setWorkspaceMode: (mode) => {
        if (get().workspaceMode === mode) return
        if (mode === 'studio') {
          const currentViewMode = get().viewMode
          set({
            workspaceMode: 'studio',
            _viewModeBeforeStudio: currentViewMode,
            viewMode: '3d',
            isFloorplanOpen: false,
            mode: 'select',
            tool: null,
            catalogCategory: null,
          })
          // Clear selection so no edit affordances bleed into the clean canvas.
          useViewer.getState().setSelection({ selectedIds: [], zoneId: null })
        } else {
          const prevMode = get()._viewModeBeforeStudio
          set({
            workspaceMode: 'edit',
            _viewModeBeforeStudio: null,
            ...(prevMode ? { viewMode: prevMode, isFloorplanOpen: prevMode !== '3d' } : {}),
          })
        }
      },
      activeSidebarPanel: DEFAULT_ACTIVE_SIDEBAR_PANEL,
      setActiveSidebarPanel: (id) => set({ activeSidebarPanel: id }),
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
        magneticSnap: state.magneticSnap,
        showReferenceFloor: state.showReferenceFloor,
        referenceFloorOffset: state.referenceFloorOffset,
        referenceFloorOpacity: state.referenceFloorOpacity,
      }),
    },
  ),
)

export default useEditor
