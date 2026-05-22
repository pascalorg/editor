export type { EditorProps } from './components/editor'
export { default as Editor } from './components/editor'
export {
  type SnapshotCameraData,
  ThumbnailGenerator,
} from './components/editor/thumbnail-generator'
// SVG path builders for arc / annular-sector / arrow-head shapes —
// inlined into `kind: 'path'` / `kind: 'polygon'` primitives by curved
// stair rendering in `nodes/src/stair/floorplan.ts`.
export {
  buildSvgAnnularSectorPath,
  buildSvgArcPath,
  buildSvgArrowHeadPoints,
  getArcPlanPoint,
} from './components/editor-2d/svg-paths'
// Phase 5 Stage D transitional exports — pure drafting / angle helpers
// consumed by kind-owned drag actions in @pascal-app/nodes. Stage F
// cleanup moves these into @pascal-app/nodes (fence/drafting.ts +
// shared/segment-angle.ts) once every Stage D port is in.
export {
  createFenceOnCurrentLevel,
  type FencePlanPoint,
  snapFenceDraftPoint,
} from './components/tools/fence/fence-drafting'
// Placement-math helpers — shared by kind-owned placement tools in
// `@pascal-app/nodes` (wall curve sagitta snap, door / window placement,
// item drop) so kinds don't reach into editor internals.
export {
  calculateCursorRotation,
  calculateItemRotation,
  getSideFromNormal,
  isValidWallSideFace,
  snapToGrid,
  snapToHalf,
  snapUpToGridStep,
  stripTransient,
} from './components/tools/item/placement-math'
export type { PlacementState } from './components/tools/item/placement-types'
// Item placement / move primitives. Re-exported here so the registry-driven
// item move-tool in `@pascal-app/nodes` can compose them — same hooks the
// legacy `MoveItemContent` + `ItemTool` use. Once item placement is fully
// owned by `nodes`, these can be inlined there and dropped from editor.
export { type DraftNodeHandle, useDraftNode } from './components/tools/item/use-draft-node'
export {
  type PlacementCoordinatorConfig,
  usePlacementCoordinator,
} from './components/tools/item/use-placement-coordinator'
export { CursorSphere } from './components/tools/shared/cursor-sphere'
// Phase 5 Stage D — PolygonEditor for slab/ceiling boundary + hole editors.
export {
  PolygonEditor,
  type PolygonEditorProps,
} from './components/tools/shared/polygon-editor'
export {
  formatAngleRadians,
  getAngleArcToSegmentReference,
  getAngleToSegmentReference,
  getSegmentAngleReferenceAtPoint,
  type SegmentAngleReference,
} from './components/tools/shared/segment-angle'
// Stair placement defaults — used by the kind-owned stair / stair-segment
// panels. Re-exported from `components/tools/stair/stair-defaults.ts`.
export {
  DEFAULT_CURVED_STAIR_INNER_RADIUS,
  DEFAULT_CURVED_STAIR_SWEEP_ANGLE,
  DEFAULT_SPIRAL_SHOW_CENTER_COLUMN,
  DEFAULT_SPIRAL_SHOW_STEP_SUPPORTS,
  DEFAULT_SPIRAL_STAIR_SWEEP_ANGLE,
  DEFAULT_SPIRAL_TOP_LANDING_DEPTH,
  DEFAULT_SPIRAL_TOP_LANDING_MODE,
  DEFAULT_STAIR_ATTACHMENT_SIDE,
  DEFAULT_STAIR_FILL_TO_FLOOR,
  DEFAULT_STAIR_HEIGHT,
  DEFAULT_STAIR_LENGTH,
  DEFAULT_STAIR_RAILING_HEIGHT,
  DEFAULT_STAIR_RAILING_MODE,
  DEFAULT_STAIR_STEP_COUNT,
  DEFAULT_STAIR_THICKNESS,
  DEFAULT_STAIR_TYPE,
  DEFAULT_STAIR_WIDTH,
} from './components/tools/stair/stair-defaults'
export {
  createWallOnCurrentLevel,
  getWallGridStep,
  isWallLongEnough,
  snapPointToGrid,
  snapScalarToGrid,
  snapWallDraftPoint,
  type WallPlanPoint,
} from './components/tools/wall/wall-drafting'
export { CameraActions as ViewerToolbarRight } from './components/ui/action-menu/camera-actions'
export { ViewToggles as ViewerToolbarLeft } from './components/ui/action-menu/view-toggles'
export { useCommandPalette } from './components/ui/command-palette'
export { ActionButton, ActionGroup } from './components/ui/controls/action-button'
export { MaterialPicker } from './components/ui/controls/material-picker'
export { MetricControl } from './components/ui/controls/metric-control'
export { PanelSection } from './components/ui/controls/panel-section'
export { SegmentedControl } from './components/ui/controls/segmented-control'
export { SliderControl } from './components/ui/controls/slider-control'
export { ToggleControl } from './components/ui/controls/toggle-control'
export { FloatingLevelSelector } from './components/ui/floating-level-selector'
export { CATALOG_ITEMS } from './components/ui/item-catalog/catalog-items'
// Item collections UI — used by the kind-owned ItemPanel in nodes/.
export { CollectionsPopover } from './components/ui/panels/collections/collections-popover'
// Phase 5 Stage E — kinds with bespoke editors (slab holes list,
// ceiling height presets, etc.) use `parametrics.customPanel` to mount
// a kind-owned panel and need PanelWrapper for the chrome.
export { PanelWrapper } from './components/ui/panels/panel-wrapper'
// Presets popover — used by kind-owned door / window panels for their
// hardware / type / opening presets.
export { PresetsPopover } from './components/ui/panels/presets/presets-popover'
export { PALETTE_COLORS } from './components/ui/primitives/color-dot'
export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './components/ui/primitives/dropdown-menu'
export { useSidebarStore } from './components/ui/primitives/sidebar'
export { Slider } from './components/ui/primitives/slider'
export { SceneLoader } from './components/ui/scene-loader'
export type { ExtraPanel } from './components/ui/sidebar/icon-rail'
export { ItemsPanel } from './components/ui/sidebar/panels/items-panel'
export {
  type ProjectVisibility,
  SettingsPanel,
  type SettingsPanelProps,
} from './components/ui/sidebar/panels/settings-panel'
export type { SitePanelProps } from './components/ui/sidebar/panels/site-panel'
export type { SidebarTab } from './components/ui/sidebar/tab-bar'
export type { PresetsAdapter, PresetsTab } from './contexts/presets-context'
export { PresetsProvider, usePresetsAdapter } from './contexts/presets-context'
export type { SaveStatus } from './hooks/use-auto-save'
// useDragAction is the React-side glue for the registry's DragAction
// primitive. Public so registry-driven kinds (Phase 5+ Stage D ports)
// can express their affordances declaratively in their own folder.
export { type UseDragActionArgs, useDragAction } from './hooks/use-drag-action'
// Phase 5 Stage D — extras for kind-owned placement tools (FenceTool etc.).
export { markToolCancelConsumed } from './hooks/use-keyboard'
export { EDITOR_LAYER } from './lib/constants'
// Helper libs used by the kind-owned roof / stair / elevator panels.
export {
  resolveCurrentBuildingId,
  resolveElevatorNodeSupportY,
  resolveElevatorSupportLevelId,
  resolveElevatorSupportY,
} from './lib/elevator-support'
// Floor-plan stair helpers — the cumulative-transform walk
// (`computeFloorplanStairSegmentTransforms`) and the rich segment-entry
// builder (`buildFloorplanStairEntry`) used by the kind-owned stair
// floor-plan emitter in `@pascal-app/nodes/src/stair/floorplan.ts`.
// Each flight's transform depends on every prior sibling's length /
// height / `attachmentSide`, so individual stair-segments can't compute
// their own polygon in isolation — the stair (parent) owns the
// computation and emits the whole stack as one registry entry.
export {
  buildFloorplanStairEntry,
  type FloorplanStairArrowEntry,
  type FloorplanStairEntry,
  type FloorplanStairSegmentEntry,
} from './lib/floorplan'
export {
  buildRoofSurfaceMaterialPatch,
  buildSingleSurfaceMaterialPatch,
  buildStairSurfaceMaterialPatch,
  buildWallSurfaceMaterialPatch,
  getActivePaintMaterialLabel,
  hasActivePaintMaterial,
} from './lib/material-paint'
export { duplicateRoofSubtree } from './lib/roof-duplication'
export type { SceneGraph } from './lib/scene'
export { applySceneGraphToEditor } from './lib/scene'
export { triggerSFX } from './lib/sfx-bus'
export { duplicateStairSubtree } from './lib/stair-duplication'
// `cn` (twMerge + clsx) — used by kind-owned panels in `@pascal-app/
// nodes` so they don't need their own copy / their own tailwind-merge
// dependency.
export { cn } from './lib/utils'
export { default as useAudio } from './store/use-audio'
export { type CommandAction, useCommandRegistry } from './store/use-command-registry'
export type {
  FloorplanSelectionTool,
  MovingFenceEndpoint,
  MovingWallEndpoint,
  SplitOrientation,
  ViewMode,
} from './store/use-editor'
export { default as useEditor } from './store/use-editor'
export {
  type PaletteView,
  type PaletteViewProps,
  usePaletteViewRegistry,
} from './store/use-palette-view-registry'
export { useUploadStore } from './store/use-upload'
