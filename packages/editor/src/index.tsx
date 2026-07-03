// Re-exports of the scene / viewer hooks so consumers composing their
// own shells on top of `@pascal-app/editor` (community-app, embedders)
// don't have to learn three separate package imports. The canonical
// definitions still live in `@pascal-app/core` / `@pascal-app/viewer`.
export { useScene } from '@pascal-app/core'
export { useViewer } from '@pascal-app/viewer'
export type { EditorProps } from './components/editor'
export { default as Editor } from './components/editor'
// Headless component aliases: the implementation files keep their
// internal names (`ParametricInspector`, `FloatingActionMenu`) because
// they're referenced throughout the editor's own internals; the public
// surface uses the shorter, shell-friendly names from the unified
// preset-system spec.
export { BakeExporter } from './components/editor/bake-exporter'
export { FloatingActionMenu as FloatingMenu } from './components/editor/floating-action-menu'
// Embed surface — the editor's real in-canvas affordances, so a host can mount
// authentic selection handles, interactive build tools, and the mover on top
// of a bare `<Viewer>` without the full `<Editor>` shell.
//  - `NodeArrowHandles` renders the selected node's registry resize/rotate/move
//    handles.
//  - `MoveTool` runs the kind-owned mover once a translate handle arms
//    `useEditor.movingNode`.
//  - `ToolManager` mounts the active registry build tool (wall / door / window /
//    …) for interactive placement when `useEditor` is in build mode with a
//    tool, plus the snap/alignment guide layers. Mount it only while a tool is
//    active to avoid its select-mode boundary editors.
//  - `Grid` is the interactive drafting plane: it raycasts the pointer and
//    emits the `grid:move` / `grid:click` events the build tools consume (the
//    wall tool is driven entirely by them; door/window use them for free-follow
//    alongside the viewer's `wall:*` mesh events). Without it the tools mount
//    but their cursor never tracks the pointer. Mount it while a tool is active.
// All read `useViewer` selection + `useEditor` state, and cooperate with host
// camera controls via the `useViewer.inputDragging` / `useEditor.movingNode`
// flags. Tools place onto `useViewer.selection.levelId`, so the host must set a
// building + level selection first.
export { Grid } from './components/editor/grid'
export {
  DimensionPill,
  type DimensionPillPart,
  formatMeasurement,
  MeasurementPill,
} from './components/editor/measurement-pill'
// In-world arrow handle primitives (chevron geometry, invisible hit area,
// shared material, palette + scale constants). Re-exported so kind-owned
// 3D selection affordances in `@pascal-app/nodes` (duct side-move / height /
// extend arrows) reuse the same UI family as the wall / fence side handles.
export {
  ARROW_COLOR,
  ARROW_HOVER_COLOR,
  ARROW_SCALE,
  createArrowHandleGeometry,
  createArrowHitAreaGeometry,
  HandleArrow,
  type HandleArrowInputShape,
  type HandleArrowPlacement,
  type HandleArrowProps,
  InvisibleHandleHitArea,
  NO_RAYCAST,
  NodeArrowHandles,
  swallowNextClick,
  useArrowMaterial,
  useInvisibleHitAreaMaterial,
} from './components/editor/node-arrow-handles'
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
  createSplineFenceOnCurrentLevel,
  type FencePlanPoint,
  snapFenceDraftPoint,
} from './components/tools/fence/fence-drafting'
export { MoveTool } from './components/tools/item/move-tool'
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
export { DragBoundingBox } from './components/tools/shared/drag-bounding-box'
export { getFloorStackPreviewPosition } from './components/tools/shared/floor-stack-preview'
export { useFreshPlacementVisibility } from './components/tools/shared/fresh-placement-visibility'
// Phase 5 Stage D — PolygonEditor for slab/ceiling boundary + hole editors.
export {
  PolygonEditor,
  type PolygonEditorPlanPointSnapContext,
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
export { ToolManager } from './components/tools/tool-manager'
export {
  createWallOnCurrentLevel,
  getSegmentGridStep,
  isSegmentLongEnough,
  snapPointToGrid,
  snapScalarToGrid,
  snapWallDraftPoint,
  snapWallDraftPointDetailed,
  WALL_CONNECT_SNAP_RADIUS,
  WALL_GRID_STEP,
  WALL_JOIN_SNAP_RADIUS,
  type WallDraftSnapKind,
  type WallDraftSnapResult,
  type WallPlanPoint,
  type WallSnapRadii,
} from './components/tools/wall/wall-drafting'
// `ToolbarLeft` / `ToolbarRight` are the headless-spec aliases for the
// existing `ViewerToolbarLeft` / `ViewerToolbarRight` exports — the
// underlying components are the same; the alias just matches the names
// used in `pascalorg/private-editor:plans/community-preset-system.md`
// so consumer code stays close to the spec vocabulary.
export {
  CameraActions as ToolbarRight,
  CameraActions as ViewerToolbarRight,
} from './components/ui/action-menu/camera-actions'
export {
  ViewToggles as ToolbarLeft,
  ViewToggles as ViewerToolbarLeft,
} from './components/ui/action-menu/view-toggles'
export { useCommandPalette } from './components/ui/command-palette'
export { ActionButton, ActionGroup } from './components/ui/controls/action-button'
export { MaterialPaintPanel } from './components/ui/controls/material-paint-panel'
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
export { ParametricInspector as Inspector } from './components/ui/panels/parametric-inspector'
export { PALETTE_COLORS } from './components/ui/primitives/color-dot'
export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './components/ui/primitives/dropdown-menu'
export { useSidebarStore } from './components/ui/primitives/sidebar'
export { Slider } from './components/ui/primitives/slider'
export { SceneLoader } from './components/ui/scene-loader'
export type { ExtraPanel } from './components/ui/sidebar/icon-rail'
export { ItemsPanel } from './components/ui/sidebar/panels/items-panel'
export type { FunctionTreeNode } from './components/ui/sidebar/panels/items-panel/function-tree-panel'
export {
  type ProjectVisibility,
  SettingsPanel,
  type SettingsPanelProps,
} from './components/ui/sidebar/panels/settings-panel'
export type { SitePanelProps } from './components/ui/sidebar/panels/site-panel'
export type { SidebarTab } from './components/ui/sidebar/tab-bar'
export {
  resolveAssetSnapTarget,
  resolveNodeSnapTarget,
  type SnapTarget,
  SnapTargetBadge,
  SnapTargetIcon,
} from './components/ui/snap-target-badge'
export type { SaveStatus } from './hooks/use-auto-save'
// useDragAction is the React-side glue for the registry's DragAction
// primitive. Public so registry-driven kinds (Phase 5+ Stage D ports)
// can express their affordances declaratively in their own folder.
export { type UseDragActionArgs, useDragAction } from './hooks/use-drag-action'
// Phase 5 Stage D — extras for kind-owned placement tools (FenceTool etc.).
export { markToolCancelConsumed } from './hooks/use-keyboard'
export { type Selection, useSelection } from './hooks/use-selection'
export {
  clearPlacementSurface,
  getPlacementSurface,
  type PlacementSurface,
  publishPlacementSurface,
} from './lib/active-placement-surface'
export {
  CEILING_ALIGNMENT_THRESHOLD_M,
  type CeilingPlanSnapInput,
  type CeilingPlanSnapResult,
  clearCeilingSnapFeedback,
  resolveCeilingPlanPointSnap,
} from './lib/ceiling-plan-snap'
export { EDITOR_LAYER } from './lib/constants'
// Helper libs used by the kind-owned roof / stair / elevator panels.
export {
  CONTINUATION_PROFILES,
  type ContinuationContext,
  type ContinuationMode,
  continuationContextOf,
  nextContinuation,
} from './lib/continuation'
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
  alignFloorplanDraftPoint,
  applyFloorplanAlignment,
  buildFloorplanStairEntry,
  FLOORPLAN_ALIGNMENT_THRESHOLD_M,
  FLOORPLAN_DRAFT_ALIGN_ID,
  type FloorplanAlignmentResult,
  type FloorplanStairArrowEntry,
  type FloorplanStairEntry,
  type FloorplanStairSegmentEntry,
  getFloorplanWallThickness,
} from './lib/floorplan'
export { commitFreshPlacementSubtree } from './lib/fresh-planar-placement'
export { exportSceneToGlb } from './lib/glb-export'
export {
  boundaryReshapeScope,
  curveReshapeScope,
  endpointReshapeScope,
  holeEditScope,
  movingNodeOf,
} from './lib/interaction/scope'
export {
  buildResetSurfaceMaterialUpdates,
  buildRoofSurfaceMaterialPatch,
  buildSingleSurfaceMaterialPatch,
  buildStairSurfaceMaterialPatch,
  getActivePaintMaterialLabel,
  hasActivePaintMaterial,
} from './lib/material-paint'
export {
  formatLinearMeasurement,
  getLinearUnitLabel,
  type LinearUnit,
  linearControlValueToMeters,
  linearUnitToMeters,
  metersToLinearUnit,
} from './lib/measurements'
export { consumePlacementDragRelease } from './lib/placement-drag-release'
export {
  addFreshPlacementMetadata,
  getPlacementMetadataRecord,
  isFreshPlacementMetadata,
  stripPlacementMetadataFlags,
} from './lib/placement-metadata'
export {
  type PlanarCursorPlacementMode,
  type PlanarPoint,
  resolvePlanarCursorPosition,
} from './lib/planar-cursor-placement'
export { clearRoofDuplicateMetadata, duplicateRoofSubtree } from './lib/roof-duplication'
// Roof wall-face hit resolution + overlap guard — shared by the
// kind-owned door / window tools in `@pascal-app/nodes` and the item
// placement coordinator's roof-wall strategy.
export { hasRoofFaceChildOverlap, type RoofWallHit, resolveRoofWallHit } from './lib/roof-wall-hit'
export type { SceneGraph } from './lib/scene'
export { applySceneGraphToEditor } from './lib/scene'
export { triggerSFX } from './lib/sfx-bus'
export {
  clearSlabSnapFeedback,
  resolveSlabPlanPointSnap,
  SLAB_ALIGNMENT_THRESHOLD_M,
  type SlabPlanSnapInput,
  type SlabPlanSnapResult,
} from './lib/slab-plan-snap'
export { duplicateStairSubtree } from './lib/stair-duplication'
export {
  getBuildingLevelsForLevel,
  getStairLevelOptions,
  resolveStairDestinationLevel,
  resolveStairFromLevelId,
  resolveStairPlacementLevelId,
  resolveStairToLevelId,
} from './lib/stair-levels'
export {
  clearSurfacePlanSnapFeedback,
  resolveSurfacePlanPointSnap,
  SURFACE_ALIGNMENT_THRESHOLD_M,
  type SurfacePlanSnapInput,
  type SurfacePlanSnapResult,
} from './lib/surface-plan-snap'
// `cn` (twMerge + clsx) — used by kind-owned panels in `@pascal-app/
// nodes` so they don't need their own copy / their own tailwind-merge
// dependency.
export { cn } from './lib/utils'
export {
  getActiveBuildingPose,
  projectAlignmentGuidesWorldToActiveBuildingLocal,
  resolveAlignmentForActiveBuilding,
  resolveAlignmentForFloorplanView,
  snapBuildingLocalToWorldGrid,
  snapWorldXZForActiveBuilding,
} from './lib/world-grid-snap'
export { default as useAlignmentGuides } from './store/use-alignment-guides'
export { default as useAudio } from './store/use-audio'
export { type CommandAction, useCommandRegistry } from './store/use-command-registry'
export type {
  CaptureMode,
  FloorplanSelectionTool,
  SnapshotCropMode,
  SnapshotStandardAspect,
  SplitOrientation,
  Tool,
  ToolDefaults,
  ViewMode,
  WorkspaceMode,
} from './store/use-editor'
export {
  default as useEditor,
  getActiveContinuationContext,
  getContinuation,
  isAlignmentGuideActive,
  isAngleSnapActive,
  isGridSnapActive,
  isMagneticSnapActive,
} from './store/use-editor'
export { default as useFacingPose, type FacingPose } from './store/use-facing-pose'
export { default as useFenceCurveDraft } from './store/use-fence-curve-draft'
export {
  default as useInteractionScope,
  getEditingHole,
  getIsCurveReshape,
  getMovingNode,
  useActiveHandleDrag,
  useEditingHole,
  useEndpointReshape,
  useIsCurveReshape,
  useMovingNode,
  useReshapingNode,
} from './store/use-interaction-scope'
export {
  default as useOpeningGuides,
  type OpeningGuide3D,
  type OpeningGuideVec3,
} from './store/use-opening-guides'
export {
  type PaletteView,
  type PaletteViewProps,
  usePaletteViewRegistry,
} from './store/use-palette-view-registry'
export { default as usePlacementPreview } from './store/use-placement-preview'
export { default as useSegmentDraftChain } from './store/use-segment-draft-chain'
export { useUploadStore } from './store/use-upload'
export { useWallMoveGhosts, type WallMoveGhostBridge } from './store/use-wall-move-ghosts'
export {
  default as useWallSnapIndicator,
  type WallSnapKind,
  type WallSnapPoint,
} from './store/use-wall-snap-indicator'
