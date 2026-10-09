'use client'

import type { AssetInput } from '@pascal-app/core'
import {
  type AnyNode,
  type AnyNodeId,
  type BrushSettings,
  type BuildingNode,
  type CameraPose,
  type ChimneyMaterialRole,
  DEFAULT_BRUSH_SETTINGS,
  type DormerSurfaceMaterialRole,
  type LevelNode,
  nodeRegistry,
  type RoofSurfaceMaterialRole,
  type Space,
  type StairSurfaceMaterialRole,
  type TerrainVerb,
  useScene,
  type WallSurfaceSide,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  CONTINUATION_PROFILES,
  type ContinuationContext,
  type ContinuationMode,
  continuationContextOf,
  nextContinuation,
} from '../lib/continuation'
import {
  type ActivePaintMaterial,
  type PaintableMaterialTarget,
  resolveActivePaintMaterialFromSelection,
  resolvePaintTargetFromSelection,
  type SingleSurfaceMaterialRole,
} from '../lib/material-paint'
import {
  type CreatableMeasurementKind,
  DEFAULT_CREATABLE_MEASUREMENT_KIND,
  normalizeCreatableMeasurementKind,
} from '../lib/measurement-kind'
import type { ModelExport } from '../lib/model-export'
import {
  endPaintSession,
  isPaintErasing,
  type PaintMode,
  paintRegionModeActive,
  usePaintRegionMode,
} from '../lib/paint-region-mode'
import {
  cyclePaintScope as cyclePaintScopeValue,
  type PaintHoverInfo,
  type PaintScope,
} from '../lib/paint-scope'
import { type RoomKey, sameRoom } from '../lib/room-selection'
import {
  cycleSnappingModeIn,
  defaultSnappingModeFor,
  resolveSnapFlags,
  type SnapContext,
  type SnappingMode,
  snapContextOf,
  snappingModesFor,
} from '../lib/snapping-mode'
import { cameraPoseStore } from './camera-pose-store'
import { publishNavigationSyncPoseToStore } from './navigation-sync-pose-store'
import useInteractionScope from './use-interaction-scope'
import {
  clampViewPaneRatio,
  DEFAULT_VIEW_LAYOUT,
  isViewVisible,
  normalizeViewLayout,
  paneOfView,
  storedViewLayout,
  swapped,
  VIEW_3D,
  type ViewLayout,
  type ViewPaneIndex,
  viewLayoutFromLegacy,
  withoutView,
  withPaneView,
  withSplitToggled,
  withView,
} from './view-layout'

const DEFAULT_ACTIVE_SIDEBAR_PANEL = 'build'

export type WorkspaceMode = 'edit' | 'studio' | 'sheets'

// Snapshot capture is invoked from two surfaces with different policies.
// `standard` mirrors the existing user-driven UX — pick region / viewport /
// area, save the blob as a project thumbnail. `preset` is the constrained
// variant for the unified preset capture flow (community save-as-preset
// modal): the overlay locks to a square crop, the renderer clears alpha
// (transparent background), and the rendered set is locked to `isolated`
// — `ThumbnailGenerator` consults `captureMode.mode === 'preset'` and
// applies those constraints. Keeping it a discriminated union lets us
// add future modes without surfacing the choice to end users.
// How the captured pixels are cropped: full-frame 16:9, raw canvas viewport,
// or user-dragged area. Hosts (e.g. the studio capture bar) can preselect it
// when entering capture mode.
export type SnapshotCropMode = 'standard' | 'viewport' | 'area'
/** Aspect presets available to `standard` crops. */
export type SnapshotStandardAspect = '16:9' | '9:16' | '4:3' | '3:4' | '1:1'

export type CaptureMode =
  | { mode: 'idle' }
  | {
      mode: 'standard'
      crop?: SnapshotCropMode
      standardAspect?: SnapshotStandardAspect
      /** The host needs this exact output shape (e.g. the publish cover) —
       *  hide the crop/aspect switcher instead of merely preselecting it. */
      lockCrop?: boolean
    }
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

/**
 * How the first-person camera moves. `walk` is the grounded street-view
 * controller (gravity, collision, door interaction); `drone` is a free camera
 * with no gravity or collision, offered by the snapshot capture overlay so a
 * shot can be framed from anywhere in the scene.
 */
export type FirstPersonMovementMode = 'walk' | 'drone'

/** Degrees. Range of the capture-mode field-of-view control. */
export const CAPTURE_FOV_MIN = 15
export const CAPTURE_FOV_MAX = 110

function clampCaptureFov(fov: number): number {
  return Math.min(Math.max(Math.round(fov), CAPTURE_FOV_MIN), CAPTURE_FOV_MAX)
}

/**
 * `site` is the outside (property line, terrain, the site panel); `building` is
 * everything on the active level — walls, openings, stairs, items, rooms.
 */
export type Phase = 'site' | 'building'

/**
 * `terrain-sculpt` is a mode, not a build tool, and that is the whole answer to
 * "how does terrain editing avoid conflicting with everything else".
 *
 * A build tool places a node and hands the pointer back. Sculpting is a
 * sustained brush over the *ground* — the one surface every other tool uses as
 * its reference plane — so while it is armed, clicks must not select a wall,
 * drag a window, or arm a ghost. Modeling it as a mode gets that for free: it is
 * mutually exclusive with `build`/`select`/`delete` by construction, every
 * selection manager already early-returns unless `mode === 'select'`, and it
 * holds a `sculpting` interaction scope for its whole lifetime so conflicting
 * controls stay stepped back. `material-paint` is the existing precedent for
 * exactly this shape.
 */
export type Mode = 'select' | 'edit' | 'delete' | 'build' | 'material-paint' | 'terrain-sculpt'

// Building tools
type BuiltInStructureTool =
  | 'wall'
  | 'fence'
  | 'room'
  | 'custom-room'
  | 'slab'
  | 'ceiling'
  | 'roof'
  | 'column'
  | 'structural-grid'
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
  | 'pipe-trap'

/** Registry node kinds are valid build tools without central union edits. */
export type StructureTool = BuiltInStructureTool | (string & {})

// Item tools (items and decoration)
export type FurnishTool = 'item' | 'cabinet'

// Site mode tools
export type SiteTool = 'property-line'

// Catalog categories for the item tool
export type CatalogCategory =
  | 'furniture'
  | 'appliance'
  | 'bathroom'
  | 'kitchen'
  | 'outdoor'
  | 'window'
  | 'door'

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

// Combined tool type. Known literals keep autocomplete; the `(string & {})`
// arm lets plugin-contributed tool ids (e.g. `'trees:tree'`) typecheck without
// the host enumerating every plugin kind. The runtime dispatch is already
// registry-first — `tool-manager` resolves `nodeRegistry.get(tool)?.tool` — so
// an unknown-to-the-host tool string flows straight through to the plugin's
// placement component.
export type KnownTool = SiteTool | StructureTool | FurnishTool
export type Tool = KnownTool | (string & {})

export type ToolMode =
  | { mode: 'select' }
  | { mode: 'edit' }
  | { mode: 'delete' }
  | { mode: 'build'; tool: StructureTool }
  | { mode: 'material-paint' }
  | { mode: 'terrain-sculpt' }

/**
 * Starting parameters seeded into a draw tool before it mints a node.
 * A loose param bag — the tool's create path validates it through the
 * kind's schema (`FenceNode.parse({ ...defaults, start, end })`), which
 * is the real type gate, so unknown keys are simply ignored.
 */
export type ToolDefaults = Record<string, unknown>

export type MaterialTargetRole =
  | WallSurfaceSide
  | StairSurfaceMaterialRole
  | RoofSurfaceMaterialRole
  | ChimneyMaterialRole
  | DormerSurfaceMaterialRole
  | SingleSurfaceMaterialRole
  | string

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
  room: RoomKey | null
  hoveredRoom: RoomKey | null
  selectRoom: (room: RoomKey) => void
  clearRoom: () => void
  setHoveredRoom: (room: RoomKey | null) => void
  phase: Phase
  setPhase: (phase: Phase) => void
  toolMode: ToolMode
  armToolMode: (next: ToolMode) => void
  /**
   * The paint tool: enter paint mode in `subMode`, else the last painting
   * sub-mode (never erase), picking `material` when given.
   */
  armMaterialPaint: (material?: ActivePaintMaterial, subMode?: PaintMode) => void
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
  lastMeasurementKind: CreatableMeasurementKind
  setLastMeasurementKind: (kind: CreatableMeasurementKind) => void
  catalogCategory: CatalogCategory | null
  setCatalogCategory: (category: CatalogCategory | null) => void
  selectedItem: AssetInput | null
  setSelectedItem: (item: AssetInput) => void
  /**
   * True while a move was engaged by a press-drag gizmo (the on-canvas move
   * cross) rather than a click-to-place flow. The placement coordinator reads
   * this to commit on pointer-release instead of waiting for a click.
   */
  placementDragMode: boolean
  setPlacementDragMode: (dragMode: boolean) => void
  roofHostDragArmedId: AnyNodeId | null
  setRoofHostDragArmedId: (nodeId: AnyNodeId | null) => void
  setMovingNode: (node: AnyNode | null) => void
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
  /**
   * World axis the R/T keyboard rotation turns around, for kinds with
   * full 3D orientation (duct fittings). Alt cycles it Y → X → Z; the
   * kind's tool / keyboard actions read it, and the floating action
   * menu surfaces it in a pill above the selected node.
   */
  rotationAxis: 'x' | 'y' | 'z'
  cycleRotationAxis: () => 'x' | 'y' | 'z'
  selectedMaterialTarget: SelectedMaterialTarget | null
  setSelectedMaterialTarget: (target: SelectedMaterialTarget | null) => void
  activePaintMaterial: ActivePaintMaterial | null
  setActivePaintMaterial: (material: ActivePaintMaterial | null) => void
  activePaintTarget: PaintableMaterialTarget
  setActivePaintTarget: (target: PaintableMaterialTarget) => void
  /** Mirror of the paint sub-mode being `erase`, for plugins that read the editor store. */
  paintEraser: boolean
  // Live vertex count of an in-progress polygon draft (slab / ceiling), so the
  // contextual HUD can gate hints on it (e.g. "Finish" only once ≥ 3 points).
  // 0 when not drafting. Not persisted.
  draftVertexCount: number
  setDraftVertexCount: (count: number) => void
  // Painter application scope — how far one paint click spreads (this surface /
  // whole item / all matching / room). One global mode, target-aware in the HUD
  // (see `lib/paint-scope.ts`), defaulting to the narrowest `'single'`. Not
  // persisted: a "paint everything" scope should reset each session.
  paintScope: PaintScope
  setPaintScope: (scope: PaintScope) => void
  // Cycle the scope within the hovered node's available set and return the new
  // value. Bound to Shift while in paint mode.
  cyclePaintScope: () => PaintScope
  primeMaterialPaintFromSelection: () => MaterialPaintSelectionSnapshot
  /**
   * Terrain sculpt state. Lives here rather than in the tool component so the
   * bottom-bar HUD, the keyboard shortcuts, and the brush all read one source —
   * the same reason the paint mode's material/scope/eraser live here.
   */
  terrainVerb: TerrainVerb
  setTerrainVerb: (verb: TerrainVerb) => void
  terrainBrush: BrushSettings
  setTerrainBrush: (settings: Partial<BrushSettings>) => void
  /**
   * Absolute height in metres the `flatten` verb aims at. Sampled by clicking
   * the ground with the eyedropper, or typed. `null` means "sample on first
   * click", which is what makes flatten usable without ever opening a number
   * field.
   */
  terrainFlattenTarget: number | null
  setTerrainFlattenTarget: (metres: number | null) => void
  /**
   * True while the next click should sample a flatten target instead of
   * sculpting. One-shot: sampling clears it.
   */
  terrainSampling: boolean
  setTerrainSampling: (sampling: boolean) => void
  // What the cursor is over in paint mode: the scopes it offers + labels for the
  // HUD chip. `null` when not over a paintable surface (drives the "hover a
  // surface" hint). Set by the selection-manager paint hover; not persisted.
  paintHover: PaintHoverInfo | null
  setPaintHover: (info: PaintHoverInfo | null) => void
  // Embedder capability: true when a host (e.g. community) can locate a selected
  // node in its catalog browser. Gates the node action menu's "Find" button; the
  // editor itself emits `selection:find-node` and lets the host fulfil it. Not
  // persisted — it's a per-mount capability the host registers.
  canFindNode: boolean
  setCanFindNode: (canFind: boolean) => void
  selectedReferenceId: string | null
  setSelectedReferenceId: (id: string | null) => void
  // Guide id with an in-flight reference-scale measurement (line drawing or
  // length dialog). Owned by the floorplan panel; mirrored here so the
  // reference panel can flip its Set Scale button into a Cancel.
  referenceScaleActiveGuideId: string | null
  setReferenceScaleActiveGuideId: (id: string | null) => void
  guideUi: Record<string, GuideUiState>
  setGuideLocked: (guideId: string, locked: boolean) => void
  setGuideScaleReferenceVisible: (guideId: string, visible: boolean) => void
  clearGuideUi: (guideId: string) => void
  // Space detection for cutaway mode
  spaces: Record<string, Space>
  setSpaces: (spaces: Record<string, Space>) => void
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
  // What a scene capture shows: null is the whole building (every level, the
  // default on entering capture); a level id shows that level and the ones
  // below it, like editing. Picking a level moves the viewer's active level;
  // leaving capture puts back the level the editor was on.
  captureLevelId: LevelNode['id'] | null
  setCaptureLevel: (levelId: LevelNode['id'] | null) => void
  // The stage's panes, per workspace (see `view-layout.ts`). Read what is on
  // screen through `activeViewLayout` / `isViewVisible`, never the raw record.
  viewLayouts: Record<string, ViewLayout>
  /** Show a view: focus it if visible, else in the focused pane, or `beside` it. */
  showView: (viewId: string, options?: { beside?: boolean }) => void
  setPaneView: (pane: ViewPaneIndex, viewId: string) => void
  /** Take a view off the stage: a split keeps the other pane, a single pane returns to 3D. */
  closeView: (viewId: string) => void
  /** Replace the current workspace's layout (following a collaborator, tests). */
  setViewLayout: (layout: ViewLayout) => void
  toggleSplit: () => void
  swapPanes: () => void
  setViewPaneRatio: (ratio: number) => void
  focusViewPane: (pane: ViewPaneIndex) => void
  /** Per-browser pins of the view bar, over each view's `defaultPinned`. */
  pinnedViews: Record<string, boolean>
  setViewPinned: (viewId: string, pinned: boolean) => void
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
  // Cycles the grid step through GRID_SNAP_STEPS (0.5 → 0.25 → 0.1 → 0.05 →
  // 0.5) and returns the new value. Bound to the measurement-step shortcut.
  cycleGridSnapStep: () => GridSnapStep
  // Magnetic snapping while drafting — snaps wall endpoints onto existing
  // wall corners / wall bodies (the "magnetic" beacon). Independent of grid
  // snap. On by default; toggled from the Display menu.
  magneticSnap: boolean
  setMagneticSnap: (enabled: boolean) => void
  // Per-context, user-cyclable snapping mode (see `lib/snapping-mode.ts`). Each
  // activity (wall / item / polygon) keeps its own mode + default, because they
  // want different snapping — drawing a wall wants grid + angle, nudging an item
  // wants free movement that only catches alignment lines. Resolved to the live
  // context via `getActiveSnappingMode()`; maps onto `gridSnapStep`/`magneticSnap`
  // via `resolveSnapFlags`. Persisted per context.
  snappingModeByContext: Record<SnapContext, SnappingMode>
  setSnappingMode: (context: SnapContext, mode: SnappingMode) => void
  // Cycle the *active* context's mode within its own set; returns the new value.
  cycleSnappingMode: () => SnappingMode
  continuationByContext: Record<ContinuationContext, ContinuationMode>
  setContinuation: (context: ContinuationContext, mode: ContinuationMode) => void
  cycleContinuation: (context: ContinuationContext) => ContinuationMode
  getContinuation: (context: ContinuationContext) => ContinuationMode
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
  // Development-only debug overlay: draw each wall's opening-snap hit area
  // (the capsule of points within the snap radius of its centerline). Lets us
  // see why a door/window snaps where it does.
  show2dVoronoi: boolean
  setShow2dVoronoi: (enabled: boolean) => void
  // First-person walkthrough mode (street view)
  isFirstPersonMode: boolean
  setFirstPersonMode: (enabled: boolean) => void
  // Which first-person controller runs while `isFirstPersonMode` is on. Reset to
  // `walk` whenever first person is left, so the grounded controller stays the
  // default entry point; only the capture overlay arms `drone`.
  firstPersonMovementMode: FirstPersonMovementMode
  setFirstPersonMovementMode: (mode: FirstPersonMovementMode) => void
  // Perspective field of view (degrees) the snapshot capture overlay is driving,
  // and the value its reset affordance returns to. Both are `null` unless the
  // capture camera rig has armed them — i.e. unless capture mode is open on a
  // perspective camera. The rig owns the lifecycle; the overlay only writes
  // `captureFov` through `setCaptureFov`.
  captureFov: number | null
  captureFovBaseline: number | null
  setCaptureFov: (fov: number) => void
  armCaptureFov: (fov: number | null) => void
  // The shutter has fired and the snapshot is being rendered/saved: walk /
  // drone freeze look + movement so a late WASD tap or mouse twitch can't
  // shift the frame out from under the shot. Set by the capture overlay for
  // the whole capturing→saved window.
  captureShutterHold: boolean
  setCaptureShutterHold: (hold: boolean) => void
  // Workspace mode: 'edit' is the full editing surface; 'studio' is the
  // render/snapshot surface (clean canvas, no editing chrome or selection).
  // Each workspace keeps its own view layout.
  workspaceMode: WorkspaceMode
  setWorkspaceMode: (mode: WorkspaceMode) => void
  activeSidebarPanel: string
  setActiveSidebarPanel: (id: string) => void
  // Mobile-only: pixel height of the secondary panel sheet while open (0 when closed).
  // Read by the mobile layout so the viewer container can shrink to preview edits.
  mobilePanelSheetHeight: number
  setMobilePanelSheetHeight: (px: number) => void
  modelExport: ModelExport | null
  setModelExport: (modelExport: ModelExport | null) => void
}

export type PersistedEditorUiState = Pick<
  EditorState,
  'phase' | 'toolMode' | 'mode' | 'tool' | 'catalogCategory' | 'viewLayouts'
>

/** What blobs written before view layouts stored instead. */
type LegacyViewModeState = {
  viewMode?: unknown
  isFloorplanOpen?: unknown
  floorplanPaneRatio?: unknown
}

type PersistedEditorLayoutState = Pick<
  EditorState,
  | 'activeSidebarPanel'
  | 'pinnedViews'
  | 'floorplanSelectionTool'
  | 'gridSnapStep'
  | 'magneticSnap'
  | 'lastMeasurementKind'
  | 'snappingModeByContext'
  | 'continuationByContext'
  | 'showReferenceFloor'
  | 'referenceFloorOffset'
  | 'referenceFloorOpacity'
>
type PersistedEditorState = PersistedEditorUiState & PersistedEditorLayoutState

export const DEFAULT_PERSISTED_EDITOR_UI_STATE: PersistedEditorUiState = {
  phase: 'site',
  toolMode: { mode: 'select' },
  mode: 'select',
  tool: null,
  catalogCategory: null,
  viewLayouts: {},
}

export const DEFAULT_PERSISTED_EDITOR_LAYOUT_STATE: PersistedEditorLayoutState = {
  activeSidebarPanel: DEFAULT_ACTIVE_SIDEBAR_PANEL,
  pinnedViews: {},
  floorplanSelectionTool: 'click',
  gridSnapStep: 0.5,
  magneticSnap: true,
  lastMeasurementKind: DEFAULT_CREATABLE_MEASUREMENT_KIND,
  snappingModeByContext: {
    wall: defaultSnappingModeFor('wall'),
    item: defaultSnappingModeFor('item'),
    polygon: defaultSnappingModeFor('polygon'),
    rotation: defaultSnappingModeFor('rotation'),
  },
  continuationByContext: {
    wall: CONTINUATION_PROFILES.wall.default,
    fence: CONTINUATION_PROFILES.fence.default,
    point: CONTINUATION_PROFILES.point.default,
    cabinet: CONTINUATION_PROFILES.cabinet.default,
    canopy: CONTINUATION_PROFILES.canopy.default,
  },
  showReferenceFloor: false,
  referenceFloorOffset: 1,
  referenceFloorOpacity: 0.35,
}

const GRID_SNAP_STEPS: GridSnapStep[] = [0.5, 0.25, 0.1, 0.05]

type SelectDefaultBuildingAndLevelOptions = {
  forceGroundLevel?: boolean
}

function defaultBuildTool(phase: Phase): StructureTool {
  return phase === 'site' ? 'property-line' : 'wall'
}

function materializeToolMode(mode: Mode, tool: unknown, phase: Phase): ToolMode {
  if (mode === 'build') {
    return {
      mode,
      tool:
        typeof tool === 'string' && tool.length > 0
          ? (tool as StructureTool)
          : defaultBuildTool(phase),
    }
  }

  return { mode } as ToolMode
}

function readPersistedToolMode(state: Partial<PersistedEditorUiState> | null | undefined): {
  mode: Mode | undefined
  tool: unknown
} {
  const candidate = state?.toolMode as Partial<ToolMode> | undefined
  if (
    candidate?.mode === 'select' ||
    candidate?.mode === 'edit' ||
    candidate?.mode === 'delete' ||
    candidate?.mode === 'build' ||
    candidate?.mode === 'material-paint' ||
    candidate?.mode === 'terrain-sculpt'
  ) {
    return {
      mode: candidate.mode,
      tool: candidate.mode === 'build' ? (candidate as { tool?: unknown }).tool : null,
    }
  }

  return { mode: state?.mode, tool: state?.tool }
}

function withMaterializedToolMode(
  state: Omit<PersistedEditorUiState, 'toolMode'>,
): PersistedEditorUiState {
  return {
    ...state,
    toolMode: materializeToolMode(state.mode, state.tool, state.phase),
  }
}

function normalizeModeForPhase(phase: Phase, mode: Mode | undefined): Mode {
  // Site has its own property-line build tool and terrain brush. The remaining
  // modes have nothing to act on at site scope, so they restore as select.
  if (phase === 'site') {
    return mode === 'build' || mode === 'terrain-sculpt' ? mode : 'select'
  }

  return mode === 'build' || mode === 'delete' || mode === 'material-paint' ? mode : 'select'
}

function normalizeViewLayouts(
  state: (Partial<PersistedEditorUiState> & LegacyViewModeState) | null | undefined,
): Record<string, ViewLayout> {
  const stored = state?.viewLayouts
  if (stored && typeof stored === 'object') {
    return Object.fromEntries(
      Object.entries(stored).map(([workspace, layout]) => [workspace, normalizeViewLayout(layout)]),
    )
  }
  if (state?.viewMode === undefined && state?.isFloorplanOpen === undefined) return {}
  return { edit: viewLayoutFromLegacy(state) }
}

function normalizePinnedViews(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
    ),
  )
}

export function normalizePersistedEditorUiState(
  state: (Partial<PersistedEditorUiState> & LegacyViewModeState) | null | undefined,
): PersistedEditorUiState {
  // Before Structure and Furnish merged, `phase` stored either of them.
  const storedPhase: unknown = state?.phase
  const phase: Phase =
    storedPhase === 'building' || storedPhase === 'structure' || storedPhase === 'furnish'
      ? 'building'
      : 'site'
  const persistedToolMode = readPersistedToolMode(state)
  let mode = normalizeModeForPhase(phase, persistedToolMode.mode)

  const viewLayouts = normalizeViewLayouts(state)

  // Both are persisted independently, and rehydrate goes through no setter, so
  // this is the third place the sculpt/3D pair has to be reconciled. The view
  // wins here for the same reason it does in `commitViewLayout`: a brush armed
  // over a hidden canvas is a mode the user cannot use, and reviving one on load
  // is worse than reviving it mid-session — nothing on screen explains it.
  const editLayout = viewLayouts.edit ?? DEFAULT_VIEW_LAYOUT
  if (mode === 'terrain-sculpt' && paneOfView(editLayout, VIEW_3D) === null) mode = 'select'

  if (phase === 'site') {
    return withMaterializedToolMode({
      phase,
      mode,
      tool: mode === 'build' ? 'property-line' : null,
      catalogCategory: null,
      viewLayouts,
    })
  }

  if (mode !== 'build') {
    return withMaterializedToolMode({
      phase,
      mode,
      tool: null,
      catalogCategory: null,
      viewLayouts,
    })
  }

  const tool =
    persistedToolMode.tool && persistedToolMode.tool !== 'property-line'
      ? (persistedToolMode.tool as Tool)
      : 'wall'

  return withMaterializedToolMode({
    phase,
    mode,
    tool,
    catalogCategory: tool === 'item' ? (state?.catalogCategory ?? null) : null,
    viewLayouts,
  })
}

/**
 * The UI state a project opens with.
 *
 * Every persisted preference comes back except the armed tool: a project always
 * opens in select mode. The tool is session state, not a preference — re-arming
 * the one the last session happened to leave behind turns the first canvas click
 * of the new one into a wall (or a dropped item) instead of a selection, with
 * nothing on screen to explain why. `partialize` no longer writes it; a blob
 * written before that still carries it, so the rule is enforced on read.
 */
export function editorUiStateOnOpen(
  state: (Partial<PersistedEditorUiState> & LegacyViewModeState) | null | undefined,
): PersistedEditorUiState {
  return {
    ...normalizePersistedEditorUiState(state),
    toolMode: DEFAULT_PERSISTED_EDITOR_UI_STATE.toolMode,
    mode: DEFAULT_PERSISTED_EDITOR_UI_STATE.mode,
    tool: DEFAULT_PERSISTED_EDITOR_UI_STATE.tool,
    catalogCategory: DEFAULT_PERSISTED_EDITOR_UI_STATE.catalogCategory,
  }
}

// Validate a persisted per-context mode against that context's allowed set
// (so e.g. a stale `angles` for items resets), falling back to its default.
function migrateSnappingMode(value: unknown, context: SnapContext): SnappingMode {
  return snappingModesFor(context).includes(value as SnappingMode)
    ? (value as SnappingMode)
    : defaultSnappingModeFor(context)
}

type LegacyContinuationState = {
  continuationByContext?: Partial<Record<ContinuationContext, unknown>>
  wallChainMode?: unknown
  fenceChainMode?: unknown
}

function migrateContinuationMode(
  value: unknown,
  context: ContinuationContext,
): ContinuationMode | null {
  const profile = CONTINUATION_PROFILES[context]
  return profile.options.includes(value as ContinuationMode) ? (value as ContinuationMode) : null
}

function normalizeContinuationByContext(
  state: LegacyContinuationState | null | undefined,
): Record<ContinuationContext, ContinuationMode> {
  return {
    wall:
      migrateContinuationMode(state?.continuationByContext?.wall, 'wall') ??
      migrateContinuationMode(state?.wallChainMode, 'wall') ??
      CONTINUATION_PROFILES.wall.default,
    fence:
      migrateContinuationMode(state?.continuationByContext?.fence, 'fence') ??
      migrateContinuationMode(state?.fenceChainMode, 'fence') ??
      CONTINUATION_PROFILES.fence.default,
    point:
      migrateContinuationMode(state?.continuationByContext?.point, 'point') ??
      CONTINUATION_PROFILES.point.default,
    cabinet:
      migrateContinuationMode(state?.continuationByContext?.cabinet, 'cabinet') ??
      CONTINUATION_PROFILES.cabinet.default,
    canopy:
      migrateContinuationMode(state?.continuationByContext?.canopy, 'canopy') ??
      CONTINUATION_PROFILES.canopy.default,
  }
}

export function normalizePersistedEditorLayoutState(
  state:
    | (Omit<Partial<PersistedEditorLayoutState>, 'snappingModeByContext'> &
        LegacyContinuationState & {
          snappingModeByContext?: Partial<Record<SnapContext, unknown>>
        })
    | null
    | undefined,
): PersistedEditorLayoutState {
  return {
    activeSidebarPanel:
      typeof state?.activeSidebarPanel === 'string' && state.activeSidebarPanel.trim()
        ? state.activeSidebarPanel
        : DEFAULT_ACTIVE_SIDEBAR_PANEL,
    pinnedViews: normalizePinnedViews(state?.pinnedViews),
    floorplanSelectionTool: state?.floorplanSelectionTool === 'marquee' ? 'marquee' : 'click',
    gridSnapStep: GRID_SNAP_STEPS.includes(state?.gridSnapStep as GridSnapStep)
      ? (state?.gridSnapStep as GridSnapStep)
      : DEFAULT_PERSISTED_EDITOR_LAYOUT_STATE.gridSnapStep,
    // Default on: only an explicit persisted `false` disables it.
    magneticSnap: state?.magneticSnap !== false,
    lastMeasurementKind: normalizeCreatableMeasurementKind(state?.lastMeasurementKind),
    snappingModeByContext: {
      wall: migrateSnappingMode(state?.snappingModeByContext?.wall, 'wall'),
      item: migrateSnappingMode(state?.snappingModeByContext?.item, 'item'),
      polygon: migrateSnappingMode(state?.snappingModeByContext?.polygon, 'polygon'),
      rotation: migrateSnappingMode(state?.snappingModeByContext?.rotation, 'rotation'),
    },
    continuationByContext: normalizeContinuationByContext(state),
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
    normalizedState.catalogCategory !== DEFAULT_PERSISTED_EDITOR_UI_STATE.catalogCategory ||
    Object.keys(normalizedState.viewLayouts).length > 0
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

// The editor's active level when capture began (undefined: not in capture).
let levelBeforeCapture: LevelNode['id'] | null | undefined
// The editor's viewer selection while Preview borrows the shared viewer store.
let viewerBeforePreview: {
  selection: ReturnType<typeof useViewer.getState>['selection']
  focusedUnitId: ReturnType<typeof useViewer.getState>['focusedUnitId']
  room: RoomKey | null
  toolMode: ToolMode
  cameraPose: CameraPose | null
  cameraMode: ReturnType<typeof useViewer.getState>['cameraMode']
  levelMode: ReturnType<typeof useViewer.getState>['levelMode']
  wallMode: ReturnType<typeof useViewer.getState>['wallMode']
  hideLevelsAboveSelection: boolean
  showZones: boolean
} | null = null
let previewCameraRestore: CameraPose | null = null

// Preview replaces the canvas; the returning controls consume this after mounting.
export function takePreviewCameraRestore(): CameraPose | null {
  const pose = previewCameraRestore
  previewCameraRestore = null
  return pose
}

/**
 * Hold the interaction scope that belongs to a sustained brush mode.
 *
 * Paint and sculpt are the two modes whose scope lifetime is the *mode*, not a
 * pointer gesture. Both must be released whenever the mode changes for any
 * reason. A stuck `sculpting` scope would leave selection disabled across the
 * whole editor, so the ToolMode transition owns this side effect.
 *
 * The eyedropper arm rides along for the same reason: it is one-shot state whose
 * UI is unmounted the moment sculpt mode ends, so it has to be cleared on every
 * exit path and not just the one through `setMode`.
 *
 * View-swapping actions are the dangerous class: they unmount `ToolManager`
 * (via `noEditing`), so the sculpt tool that would otherwise release the scope
 * on unmount is gone, and a leaked scope is unrecoverable without a reload.
 */
function syncBrushModeScope(mode: Mode): void {
  const scope = useInteractionScope.getState()
  if (mode === 'material-paint') scope.begin({ kind: 'painting' })
  else if (mode === 'terrain-sculpt') scope.begin({ kind: 'sculpting' })
  // `isBrushMode` is the same set as the two branches above — kept as one
  // predicate so an added brush mode cannot be handled here and missed there.
  else {
    scope.endIf((s) => s.kind === 'painting' || s.kind === 'sculpting')
    if (useEditor.getState().terrainSampling) useEditor.getState().setTerrainSampling(false)
  }
  // Erasing and a refused-gesture notice end with the paint session, whatever left it.
  if (mode !== 'material-paint') endPaintSession()
}

/**
 * The modes whose click acts on what is selected. In every other mode a click
 * draws, places, paints, sculpts or deletes, so the ToolMode transition into
 * one ends the selection — room, nodes and reference — and its panel and
 * overlay go with it. A flow that needs a target inside such a mode hands it to
 * the tool itself (paint primes its target from the selection before it goes).
 */
function keepsSelection(mode: Mode): boolean {
  return mode === 'select' || mode === 'edit'
}

/**
 * Whether `mode` is one of the two sustained brush modes.
 *
 * Named because callers *outside* this store need the same test: a scope is
 * single-owner, so anything that calls `begin()` while a brush mode holds its
 * scope silently evicts it — the brush stays armed and painting while the rest of
 * the editor believes a drag is running. Almost every producer is unreachable
 * under a brush mode because it needs a selection and entering the mode clears
 * one, but the clipboard paths read the clipboard instead (see
 * `pasteSelectionAndPickUp`), so they have to ask.
 */
export function isBrushMode(mode: Mode): boolean {
  return mode === 'material-paint' || mode === 'terrain-sculpt'
}

const useEditor = create<EditorState>()(
  persist(
    (set, get) => ({
      room: null,
      hoveredRoom: null,
      selectRoom: (room) =>
        set({ room, hoveredRoom: null, selectedReferenceId: null, selectedMaterialTarget: null }),
      clearRoom: () => set({ room: null, hoveredRoom: null }),
      setHoveredRoom: (room) => {
        if (!sameRoom(get().hoveredRoom, room)) set({ hoveredRoom: room })
      },
      phase: DEFAULT_PERSISTED_EDITOR_UI_STATE.phase,
      setPhase: (phase) => {
        const currentPhase = get().phase
        if (currentPhase === phase) return
        const wasBuilding = get().toolMode.mode === 'build'
        set({
          phase,
          // Site has no rooms.
          ...(phase === 'site' ? { room: null } : {}),
          hoveredRoom: null,
          catalogCategory: null,
        })
        get().armToolMode(
          wasBuilding ? { mode: 'build', tool: defaultBuildTool(phase) } : { mode: 'select' },
        )

        if (phase === 'site') selectSiteFloorplanContext()
        else selectDefaultBuildingAndLevel()
      },
      toolMode: DEFAULT_PERSISTED_EDITOR_UI_STATE.toolMode,
      armToolMode: (requested) => {
        const current = get()
        let phase = current.phase
        const next = materializeToolMode(
          requested.mode,
          requested.mode === 'build' ? requested.tool : null,
          phase,
        )

        if (next.mode === 'terrain-sculpt') {
          phase = 'site'
        } else if (next.mode === 'build' && next.tool === 'property-line') {
          phase = 'site'
        }

        const phaseChanged = phase !== current.phase
        const nextTool = next.mode === 'build' ? next.tool : null
        const endsSelection =
          !keepsSelection(next.mode) && (next.mode !== current.mode || nextTool !== current.tool)
        if (next.mode === 'material-paint') get().primeMaterialPaintFromSelection()
        set({
          toolMode: next,
          mode: next.mode,
          tool: nextTool,
          ...(endsSelection ? { room: null, hoveredRoom: null, selectedReferenceId: null } : {}),
          ...(phaseChanged ? { phase } : {}),
        })
        // The brush works on the 3D canvas, so arming it opens 3D beside the plan.
        if (next.mode === 'terrain-sculpt' && !isViewVisible(get(), VIEW_3D)) {
          get().showView(VIEW_3D, { beside: true })
        }

        if (phaseChanged) {
          if (phase === 'site') selectSiteFloorplanContext()
          else selectDefaultBuildingAndLevel()
        }
        if (endsSelection) useViewer.getState().setSelection({ selectedIds: [], zoneId: null })
        syncBrushModeScope(next.mode)
      },
      armMaterialPaint: (material, subMode) => {
        get().armToolMode({ mode: 'material-paint' })
        const paintMode = usePaintRegionMode.getState()
        paintMode.setMode(subMode ?? paintMode.drawMode)
        if (material) get().setActivePaintMaterial(material)
      },
      mode: DEFAULT_PERSISTED_EDITOR_UI_STATE.mode,
      setMode: (mode) => {
        if (mode === 'build') {
          const { phase, toolMode } = get()
          get().armToolMode({
            mode,
            tool: toolMode.mode === 'build' ? toolMode.tool : defaultBuildTool(phase),
          })
          return
        }
        get().armToolMode({ mode } as ToolMode)
      },
      tool: DEFAULT_PERSISTED_EDITOR_UI_STATE.tool,
      setTool: (tool) => {
        if (tool) {
          get().armToolMode({ mode: 'build', tool })
          return
        }
        if (get().toolMode.mode === 'build' || get().mode === 'build') {
          get().armToolMode({ mode: 'select' })
          return
        }
        get().armToolMode(materializeToolMode(get().mode, null, get().phase))
      },
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
      lastMeasurementKind: DEFAULT_PERSISTED_EDITOR_LAYOUT_STATE.lastMeasurementKind,
      setLastMeasurementKind: (kind) => set({ lastMeasurementKind: kind }),
      catalogCategory: DEFAULT_PERSISTED_EDITOR_UI_STATE.catalogCategory,
      setCatalogCategory: (category) => set({ catalogCategory: category }),
      selectedItem: null,
      setSelectedItem: (item) => set({ selectedItem: item }),
      placementDragMode: false,
      setPlacementDragMode: (dragMode) => set({ placementDragMode: dragMode }),
      roofHostDragArmedId: null,
      setRoofHostDragArmedId: (nodeId) => set({ roofHostDragArmedId: nodeId }),
      // The node being placed/moved now lives inside the interaction scope
      // (`useMovingNode` / `getMovingNode`), not a `useEditor` flag. This setter
      // remains the single entry point: it drives the scope and still touches
      // `movingNodeOrigin` / `placementDragMode` so cross-store subscribers that
      // watch this store (community placement) keep firing on move start/end.
      setMovingNode: (node) => {
        const scope = useInteractionScope.getState()
        if (node === null) {
          scope.endIf((s) => s.kind === 'placing' || s.kind === 'moving')
          // Preserve `movingNodeOrigin` across the clear so the non-owning
          // side's effect cleanup — which fires after `setMovingNode(null)`
          // propagates — can still read who finalised. The next non-null
          // `setMovingNode` resets it. Always clear the press-drag flag.
          set({ placementDragMode: false })
          return
        }
        const targetNode = node
        const isNew = Boolean((targetNode as { metadata?: { isNew?: boolean } }).metadata?.isNew)
        if (isNew) {
          scope.begin({
            kind: 'placing',
            node: targetNode,
            nodeId: targetNode.id,
            nodeType: targetNode.type,
            view: '3d',
            pressDrag: get().placementDragMode,
            driver: 'move-tool',
          })
        } else {
          scope.begin({
            kind: 'moving',
            node: targetNode,
            nodeId: targetNode.id,
            nodeType: targetNode.type,
            view: '3d',
          })
        }
        set({ movingNodeOrigin: null })
      },
      movingNodeOrigin: null as '2d' | '3d' | null,
      setMovingNodeOrigin: (origin) => set({ movingNodeOrigin: origin }),
      rotationAxis: 'y',
      cycleRotationAxis: () => {
        const order = ['y', 'x', 'z'] as const
        const next = order[(order.indexOf(get().rotationAxis as 'y' | 'x' | 'z') + 1) % 3]!
        set({ rotationAxis: next })
        return next
      },
      selectedMaterialTarget: null,
      setSelectedMaterialTarget: (target) => set({ selectedMaterialTarget: target }),
      paintEraser: usePaintRegionMode.getState().mode === 'erase',
      activePaintMaterial: null,
      // Picking a material implies paint, not erase — leave the eraser so the
      // next click applies the chosen material.
      setActivePaintMaterial: (material) => {
        set({ activePaintMaterial: material })
        if (material && isPaintErasing()) {
          usePaintRegionMode.getState().setMode(usePaintRegionMode.getState().drawMode)
        }
      },
      activePaintTarget: 'wall',
      setActivePaintTarget: (target) =>
        set((state) =>
          state.activePaintTarget === target ? state : { activePaintTarget: target },
        ),
      draftVertexCount: 0,
      setDraftVertexCount: (count) =>
        set((state) => (state.draftVertexCount === count ? state : { draftVertexCount: count })),
      paintScope: 'single',
      setPaintScope: (scope) => set({ paintScope: scope }),
      cyclePaintScope: () => {
        // Cycle within the hovered node's available scopes (what the click will
        // actually hit). With nothing paintable hovered there's only `single`.
        const scopes = get().paintHover?.scopes ?? (['single'] as PaintScope[])
        const next = cyclePaintScopeValue(get().paintScope, scopes)
        set({ paintScope: next })
        return next
      },
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
          materials: useScene.getState().materials,
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
      paintHover: null,
      setPaintHover: (info) => set({ paintHover: info }),
      terrainVerb: 'flatten',
      setTerrainVerb: (verb) =>
        set({
          terrainVerb: verb,
          // Switching away from flatten drops the sampling arm — an eyedropper
          // that survives into the raise brush would swallow its first click.
          terrainSampling: verb === 'flatten' ? get().terrainSampling : false,
        }),
      terrainBrush: DEFAULT_BRUSH_SETTINGS,
      setTerrainBrush: (settings) => set({ terrainBrush: { ...get().terrainBrush, ...settings } }),
      terrainFlattenTarget: null,
      setTerrainFlattenTarget: (metres) =>
        set({ terrainFlattenTarget: metres, terrainSampling: false }),
      terrainSampling: false,
      setTerrainSampling: (sampling) => set({ terrainSampling: sampling }),
      canFindNode: false,
      setCanFindNode: (canFind) => set({ canFindNode: canFind }),
      selectedReferenceId: null,
      setSelectedReferenceId: (id) =>
        set({ selectedReferenceId: id, ...(id ? { room: null, hoveredRoom: null } : {}) }),
      referenceScaleActiveGuideId: null,
      setReferenceScaleActiveGuideId: (id) => set({ referenceScaleActiveGuideId: id }),
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
        if (preview === get().isPreviewMode) return
        if (preview) {
          const viewer = useViewer.getState()
          viewerBeforePreview = {
            selection: viewer.selection,
            focusedUnitId: viewer.focusedUnitId,
            room: get().room,
            toolMode: get().toolMode,
            cameraPose: cameraPoseStore.getState().pose,
            cameraMode: viewer.cameraMode,
            levelMode: viewer.levelMode,
            wallMode: viewer.wallMode,
            hideLevelsAboveSelection: viewer.hideLevelsAboveSelection,
            showZones: viewer.showZones,
          }
          previewCameraRestore = null
          set({ isPreviewMode: true, catalogCategory: null })
          get().armToolMode({ mode: 'select' })
          // Preview starts on the editor's floor with nothing else picked; what
          // the visitor selects there is its own and is dropped on the way out.
          viewer.setSelection({ selectedIds: [], zoneId: null })
          viewer.setFocusedUnit(null)
          viewer.setHoveredId(null)
        } else {
          if (get().isFirstPersonMode) get().setFirstPersonMode(false)
          useViewer.getState().setWalkthroughMode(false)
          set({ isPreviewMode: false })
          const before = viewerBeforePreview
          viewerBeforePreview = null
          if (!before) return
          const viewer = useViewer.getState()
          const nodes = useScene.getState().nodes
          const exists = (id: string | null) => id !== null && !!nodes[id as AnyNodeId]
          get().armToolMode(before.toolMode)
          set({
            room:
              before.room && exists(before.room.zoneId) && exists(before.room.levelId)
                ? before.room
                : null,
            hoveredRoom: null,
          })
          viewer.setSelection({
            buildingId: exists(before.selection.buildingId) ? before.selection.buildingId : null,
            levelId: exists(before.selection.levelId) ? before.selection.levelId : null,
            zoneId: exists(before.selection.zoneId) ? before.selection.zoneId : null,
            selectedIds: before.selection.selectedIds.filter(exists),
          })
          viewer.setFocusedUnit(exists(before.focusedUnitId) ? before.focusedUnitId : null)
          viewer.setHoveredId(null)
          viewer.setCameraMode(before.cameraMode)
          viewer.setLevelMode(before.levelMode)
          viewer.setWallMode(before.wallMode)
          useViewer.setState({
            hideLevelsAboveSelection: before.hideLevelsAboveSelection,
            showZones: before.showZones,
          })
          previewCameraRestore = before.cameraPose
        }
      },
      captureMode: { mode: 'idle' } as CaptureMode,
      isCaptureMode: false,
      setCaptureMode: (next) => {
        const resolved: CaptureMode =
          typeof next === 'boolean' ? { mode: next ? 'standard' : 'idle' } : next
        const entering = resolved.mode !== 'idle'
        const wasCapturing = get().isCaptureMode
        if (entering && !wasCapturing) {
          levelBeforeCapture = useViewer.getState().selection.levelId
          set({ captureLevelId: null })
        }
        // Walk / drone framing is a capture-only camera, so leaving capture always
        // lands back on orbit. Capture frames in 3D alone (`activeViewLayout`)
        // without touching the stored layout, so leaving it needs no restore.
        if (!entering && get().isFirstPersonMode) {
          get().setFirstPersonMode(false)
        }
        set(
          entering
            ? { captureMode: resolved, isCaptureMode: true }
            : { captureMode: resolved, isCaptureMode: false, captureLevelId: null },
        )
        if (!entering && wasCapturing) {
          const level = levelBeforeCapture
          levelBeforeCapture = undefined
          const viewer = useViewer.getState()
          const exists = level === null || useScene.getState().nodes[level as AnyNodeId]
          if (level !== undefined && exists && viewer.selection.levelId !== level)
            viewer.setSelection({ levelId: level })
        }
      },
      captureLevelId: null,
      setCaptureLevel: (levelId) => {
        if (!get().isCaptureMode) return
        set({ captureLevelId: levelId })
        const viewer = useViewer.getState()
        if (levelId && viewer.selection.levelId !== levelId) viewer.setSelection({ levelId })
      },
      viewLayouts: DEFAULT_PERSISTED_EDITOR_UI_STATE.viewLayouts,
      showView: (viewId, options) =>
        commitViewLayout(withView(storedViewLayout(get()), viewId, options)),
      setPaneView: (pane, viewId) =>
        commitViewLayout(withPaneView(storedViewLayout(get()), pane, viewId)),
      closeView: (viewId) => commitViewLayout(withoutView(storedViewLayout(get()), viewId)),
      setViewLayout: (layout) => commitViewLayout(normalizeViewLayout(layout)),
      toggleSplit: () => commitViewLayout(withSplitToggled(storedViewLayout(get()))),
      swapPanes: () => commitViewLayout(swapped(storedViewLayout(get()))),
      setViewPaneRatio: (ratio) =>
        commitViewLayout({ ...storedViewLayout(get()), ratio: clampViewPaneRatio(ratio) }),
      focusViewPane: (pane) => {
        const layout = storedViewLayout(get())
        if (layout.focus !== pane && (pane === 0 || layout.split)) {
          commitViewLayout({ ...layout, focus: pane })
        }
      },
      pinnedViews: DEFAULT_PERSISTED_EDITOR_LAYOUT_STATE.pinnedViews,
      setViewPinned: (viewId, pinned) =>
        set((state) => ({ pinnedViews: { ...state.pinnedViews, [viewId]: pinned } })),
      isFloorplanHovered: false,
      setFloorplanHovered: (hovered) => set({ isFloorplanHovered: hovered }),
      isRiserOpen: false,
      setRiserOpen: (open) => set({ isRiserOpen: open }),
      toggleRiserOpen: () => set((state) => ({ isRiserOpen: !state.isRiserOpen })),
      navigationSyncPose: null,
      publishNavigationSyncPose: (pose) => {
        const navigationSyncPose = {
          ...pose,
          revision: (get().navigationSyncPose?.revision ?? 0) + 1,
        }
        publishNavigationSyncPoseToStore(navigationSyncPose)
        set({ navigationSyncPose })
      },
      floorplanSelectionTool: 'click' as FloorplanSelectionTool,
      setFloorplanSelectionTool: (tool) => set({ floorplanSelectionTool: tool }),
      gridSnapStep: DEFAULT_PERSISTED_EDITOR_LAYOUT_STATE.gridSnapStep,
      setGridSnapStep: (step) => set({ gridSnapStep: step }),
      cycleGridSnapStep: () => {
        const current = get().gridSnapStep
        const index = GRID_SNAP_STEPS.indexOf(current)
        const next = GRID_SNAP_STEPS[(index + 1) % GRID_SNAP_STEPS.length] ?? GRID_SNAP_STEPS[0]!
        set({ gridSnapStep: next })
        return next
      },
      magneticSnap: DEFAULT_PERSISTED_EDITOR_LAYOUT_STATE.magneticSnap,
      setMagneticSnap: (enabled) => set({ magneticSnap: enabled }),
      snappingModeByContext: DEFAULT_PERSISTED_EDITOR_LAYOUT_STATE.snappingModeByContext,
      setSnappingMode: (context, mode) =>
        set((state) => ({
          snappingModeByContext: { ...state.snappingModeByContext, [context]: mode },
        })),
      cycleSnappingMode: () => {
        const context = getActiveSnapContext() ?? 'item'
        const current = get().snappingModeByContext[context]
        const next = cycleSnappingModeIn(context, current)
        set((state) => ({
          snappingModeByContext: { ...state.snappingModeByContext, [context]: next },
        }))
        return next
      },
      continuationByContext: DEFAULT_PERSISTED_EDITOR_LAYOUT_STATE.continuationByContext,
      setContinuation: (context, mode) => {
        const next =
          migrateContinuationMode(mode, context) ?? CONTINUATION_PROFILES[context].default
        set((state) => ({
          continuationByContext: { ...state.continuationByContext, [context]: next },
        }))
      },
      cycleContinuation: (context) => {
        const next = nextContinuation(context, get().getContinuation(context))
        set((state) => ({
          continuationByContext: { ...state.continuationByContext, [context]: next },
        }))
        return next
      },
      getContinuation: (context) => {
        const current = get().continuationByContext[context]
        return migrateContinuationMode(current, context) ?? CONTINUATION_PROFILES[context].default
      },
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
      show2dVoronoi: false,
      setShow2dVoronoi: (enabled) => set({ show2dVoronoi: enabled }),
      isFirstPersonMode: false,
      // First person shows 3D alone (`activeViewLayout`); the stored layout
      // comes back on exit untouched.
      setFirstPersonMode: (enabled) => {
        if (enabled) {
          set({ isFirstPersonMode: true, catalogCategory: null })
          get().armToolMode({ mode: 'select' })
        } else {
          set({ isFirstPersonMode: false, firstPersonMovementMode: 'walk' })
        }
      },
      firstPersonMovementMode: 'walk' as FirstPersonMovementMode,
      setFirstPersonMovementMode: (mode) => set({ firstPersonMovementMode: mode }),
      captureFov: null,
      captureFovBaseline: null,
      setCaptureFov: (fov) =>
        set({
          captureFov: clampCaptureFov(fov),
        }),
      armCaptureFov: (fov) => {
        const captureFov = fov === null ? null : clampCaptureFov(fov)
        set({ captureFov, captureFovBaseline: captureFov })
      },
      captureShutterHold: false,
      setCaptureShutterHold: (hold) => set({ captureShutterHold: hold }),
      workspaceMode: 'edit' as WorkspaceMode,
      setWorkspaceMode: (mode) => {
        if (get().workspaceMode === mode) return
        // Every non-'edit' workspace (studio's clean canvas, sheets' paper
        // space) enters the same way: drop the editing chrome. The view layout
        // needs no stash — each workspace keeps its own.
        if (mode !== 'edit') {
          set({ workspaceMode: mode, catalogCategory: null })
          get().armToolMode({ mode: 'select' })
          // Clear selection so no edit affordances bleed into the clean canvas.
          useViewer.getState().setSelection({ selectedIds: [], zoneId: null })
        } else {
          set({ workspaceMode: 'edit' })
        }
        yieldBrushToHiddenCanvas()
      },
      activeSidebarPanel: DEFAULT_ACTIVE_SIDEBAR_PANEL,
      setActiveSidebarPanel: (id) => set({ activeSidebarPanel: id }),
      mobilePanelSheetHeight: 0,
      setMobilePanelSheetHeight: (px) => set({ mobilePanelSheetHeight: Math.max(0, px) }),
      modelExport: null,
      setModelExport: (modelExport) => set({ modelExport }),
    }),
    {
      name: 'pascal-editor-ui-preferences',
      merge: (persistedState, currentState) => {
        const uiState = editorUiStateOnOpen(persistedState as Partial<PersistedEditorState>)
        const layoutState = normalizePersistedEditorLayoutState(
          persistedState as Partial<PersistedEditorState>,
        )

        return {
          ...currentState,
          ...uiState,
          ...layoutState,
        }
      },
      // `merge` rewrites `mode` wholesale, while the interaction scope a brush
      // mode holds is not persisted — it lives in a separate store. A paint or
      // sculpt brush armed before rehydrate would otherwise keep its scope after
      // the merge resets the mode, leaving selection suppressed for the rest of
      // the session with no mode on screen to explain it.
      onRehydrateStorage: () => (state) => {
        if (state) syncBrushModeScope(state.mode)
      },
      // The armed tool (`toolMode` / `mode` / `tool`, and the catalog category
      // that only exists while a build tool is armed) is deliberately absent:
      // a project always opens in select mode, so persisting it could only ever
      // arm a tool nobody asked for on the next load.
      partialize: (state) => ({
        phase: state.phase,
        viewLayouts: state.viewLayouts,
        activeSidebarPanel: state.activeSidebarPanel,
        pinnedViews: state.pinnedViews,
        floorplanSelectionTool: state.floorplanSelectionTool,
        gridSnapStep: state.gridSnapStep,
        magneticSnap: state.magneticSnap,
        lastMeasurementKind: state.lastMeasurementKind,
        snappingModeByContext: state.snappingModeByContext,
        continuationByContext: state.continuationByContext,
        showReferenceFloor: state.showReferenceFloor,
        referenceFloorOffset: state.referenceFloorOffset,
        referenceFloorOpacity: state.referenceFloorOpacity,
      }),
      skipHydration: true,
    },
  ),
)

/**
 * The one writer of the stored layout. The view wins over the mode: hiding the
 * 3D pane leaves the terrain brush unreachable, and a held `sculpting` scope
 * would keep selection suppressed in a plan the user is trying to work in — a
 * mode you cannot use and cannot see how to leave.
 */
function commitViewLayout(layout: ViewLayout): void {
  useEditor.setState((state) => ({
    viewLayouts: { ...state.viewLayouts, [state.workspaceMode]: layout },
  }))
  yieldBrushToHiddenCanvas()
}

function yieldBrushToHiddenCanvas(): void {
  const state = useEditor.getState()
  if (state.mode === 'terrain-sculpt' && !isViewVisible(state, VIEW_3D)) state.setMode('select')
}

export function armToolMode(next: ToolMode): void {
  useEditor.getState().armToolMode(next)
}

export function armMaterialPaint(material?: ActivePaintMaterial, subMode?: PaintMode): void {
  useEditor.getState().armMaterialPaint(material, subMode)
}

/**
 * Effective magnetic-snap state: the legacy `magneticSnap` flag AND the active
 * context's snapping mode. With exclusive modes, magnetic (alignment axes + wall
 * corner-join) is on only in `'lines'`. Read from the smallest magnetic choke
 * points so the mode is honoured without retuning any snap math.
 */
export function isMagneticSnapActive(): boolean {
  const state = useEditor.getState()
  return state.magneticSnap && resolveSnapFlags(getActiveSnappingMode()).magnetic
}

/**
 * Effective angle-lock state: the active context's snapping mode. With exclusive
 * modes the 15°/45° lock is on only in `'angles'`. Read from the smallest
 * angle-lock choke points (wall / fence draft call sites).
 */
export function isAngleSnapActive(): boolean {
  return resolveSnapFlags(getActiveSnappingMode()).angles
}

/**
 * Effective grid-lattice state: the active context's snapping mode. With
 * exclusive modes the grid quantize is on only in `'grid'`.
 */
export function isGridSnapActive(): boolean {
  return resolveSnapFlags(getActiveSnappingMode()).grid
}

/**
 * Whether alignment "lines" should be DISPLAYED for the active context.
 *
 * True whenever a snappable context is active — in EVERY snapping mode,
 * including `'off'`. The guides are passive reference feedback; this is
 * decoupled from the magnetic *pull*: a producer publishes guides whenever this
 * is true, but only applies the alignment delta when `isMagneticSnapActive()`
 * (i.e. `'lines'`). So the user always sees the same alignment lines while
 * snapping to grid / angles / off, and only snaps to them in `'lines'` mode.
 */
export function isAlignmentGuideActive(): boolean {
  return getActiveSnapContext() !== null
}

/**
 * The snapping context for what the user is currently doing (wall / item /
 * polygon), or null when nothing snappable is active. Derived from the
 * authoritative interaction scope, falling back to the armed build tool (the
 * `drafting` scope isn't wired). The single source every snap reader + the HUD
 * resolve their mode through.
 */
export function getActiveSnapContext(): SnapContext | null {
  const editor = useEditor.getState()
  return snapContextOf({
    scope: useInteractionScope.getState().scope,
    mode: editor.mode,
    tool: editor.tool,
    profileOf: (typeOrTool) => nodeRegistry.get(typeOrTool)?.snapProfile,
    profileOfNode: (nodeId) => {
      const node = useScene.getState().nodes[nodeId as AnyNodeId]
      return node ? nodeRegistry.get(node.type)?.snapProfile : undefined
    },
    draftDirectionalOf: (typeOrTool) => nodeRegistry.get(typeOrTool)?.snapDraftDirectional ?? true,
    paintRegion: paintRegionModeActive(editor.mode),
  })
}

export function getActiveContinuationContext(): ContinuationContext | null {
  const scope = useInteractionScope.getState().scope
  if (scope.kind === 'drafting') return continuationContextOf(scope.tool)
  if (scope.kind === 'placing') return continuationContextOf(scope.nodeType)
  if (scope.kind !== 'idle') return null

  const editor = useEditor.getState()
  if (editor.mode !== 'build' || !editor.tool) return null
  return continuationContextOf(editor.tool)
}

export function getContinuation(context: ContinuationContext): ContinuationMode {
  return useEditor.getState().getContinuation(context)
}

/**
 * The effective snapping mode for the active context. Falls back to `'off'` when
 * no snappable context is active (select / idle, no armed tool) so grid /
 * magnetic / angle readers — including the snap-grid overlay — stay inert
 * outside an interaction. Per-context defaults (item is `'grid'`) only take
 * effect once a tool is armed or an interaction begins; otherwise the item
 * default would light up the snap grid at idle.
 */
export function getActiveSnappingMode(): SnappingMode {
  const context = getActiveSnapContext()
  if (!context) return 'off'
  return useEditor.getState().snappingModeByContext[context]
}

usePaintRegionMode.subscribe((state) => {
  const paintEraser = state.mode === 'erase'
  if (useEditor.getState().paintEraser !== paintEraser) useEditor.setState({ paintEraser })
})

export default useEditor
