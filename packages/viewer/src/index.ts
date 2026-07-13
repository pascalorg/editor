// `NodeRenderer` is the recursive dispatch component used by parent
// renderers (wall renders doors/windows, slab renders hosted items).
// Public so registry-driven kinds can compose children without reaching
// into viewer's internal paths.

export type { SurfaceRole } from '@pascal-app/core'
export { ErrorBoundary } from './components/error-boundary'
// Stage A wrap-exports for the rest of the kinds — `@pascal-app/nodes`
// registers each via `def.renderer` (and `def.system` when present)
// Generic dispatch component used by recursive renderers (e.g. level →
// children, building → children). The per-kind renderers live in
// `@pascal-app/nodes/<kind>/renderer.tsx` and are loaded by the registry
// — no per-kind re-exports needed.
export { NodeRenderer } from './components/renderers/node-renderer'
export { default as Viewer, type ViewerHandle } from './components/viewer'
export {
  type BVHEcctrlApi,
  default as BVHEcctrl,
  type MovementInput,
} from './components/viewer/bvh-ecctrl'
export {
  buildGlbInteractiveItems,
  GlbInteractive,
  type GlbInteractiveItem,
} from './components/viewer/glb-interactive'
export {
  buildGlbReferenceNodes,
  buildGlbReplaceNodes,
} from './components/viewer/glb-reference-nodes'
export {
  type GlbHover,
  type GlbIdentity,
  type GlbLevel,
  GlbScene,
  type GlbWalkthrough,
} from './components/viewer/glb-scene'
export { GlbWalkthroughController } from './components/viewer/glb-walkthrough-controller'
export type { HoverStyle, HoverStyles } from './components/viewer/post-processing'
export {
  DEFAULT_HOVER_STYLES,
  SSGI_PARAMS,
} from './components/viewer/post-processing'
export { SceneEnvironment } from './components/viewer/scene-environment'
export { WalkthroughControls } from './components/viewer/walkthrough-controls'
export { useAssetUrl } from './hooks/use-asset-url'
export { useGLTFKTX2 } from './hooks/use-gltf-ktx2'
export { useNodeEvents } from './hooks/use-node-events'
export { ASSETS_CDN_URL, resolveAssetUrl, resolveCdnUrl } from './lib/asset-url'
// CSG primitives — used by chimney's roof-trim and other kinds whose
// geometry subtracts pieces against their host. Lives in viewer
// because three-bvh-csg / three-mesh-bvh are viewer-only deps.
export {
  ADDITION,
  Brush,
  computeGeometryBoundsTree,
  csgEvaluator,
  csgGeometry,
  csgMaterials,
  INTERSECTION,
  prepareBrushForCSG,
  SUBTRACTION,
} from './lib/csg-utils'
export type { EdgeMode } from './lib/edge-style'
export {
  applyIsolation,
  clearIsolation,
  collectIsolationSubtree,
  isIsolationActive,
} from './lib/isolation'
export { GRID_LAYER, OVERLAY_LAYER, SCENE_LAYER, ZONE_LAYER } from './lib/layers'
export {
  applyMaterialPresetToMaterials,
  BLUEPRINT_PALETTE,
  baseMaterial,
  CLAY_PALETTE,
  type ColorPreset,
  clearMaterialCache,
  createDefaultMaterial,
  createMaterial,
  createMaterialFromPresetRef,
  createSurfaceRoleMaterial,
  DEFAULT_CEILING_MATERIAL,
  DEFAULT_DOOR_MATERIAL,
  DEFAULT_ROOF_MATERIAL,
  DEFAULT_SHELF_MATERIAL,
  DEFAULT_SLAB_MATERIAL,
  DEFAULT_STAIR_MATERIAL,
  DEFAULT_WALL_MATERIAL,
  DEFAULT_WINDOW_MATERIAL,
  disposeMaterial,
  glassMaterial,
  MONO_PALETTE,
  PRESET_PALETTES,
  type RenderShading,
  resolveMaterialRef,
  resolveSlotDefaultMaterial,
  resolveSurfaceColor,
  WHITE_PALETTE,
} from './lib/materials'
export { mergedOutline } from './lib/merged-outline-node'
export { unionPolygons } from './lib/polygon-union'
export {
  getSceneTheme,
  SCENE_THEME_IDS,
  SCENE_THEMES,
  type SceneTheme,
} from './lib/scene-themes'
export { useItemLightPool } from './store/use-item-light-pool'
export { default as useViewer } from './store/use-viewer'
export { CeilingSystem } from './systems/ceiling/ceiling-system'
export {
  createColumnBoxGeometry,
  createColumnCylinderGeometry,
  createColumnSphereGeometry,
  createColumnTorusGeometry,
} from './systems/column/column-geometry'
export { DoorAnimationSystem } from './systems/door/door-animation-system'
export { buildDoorPreviewMesh, DoorSystem, poseDoorMovingParts } from './systems/door/door-system'
export { ElevatorInteractionSystem } from './systems/elevator/elevator-interaction-system'
// Fence system follows the wall re-export pattern — composed into the
// registry-driven fence definition's `def.system`. Removed in Phase 6
// alongside the legacy fence mount point.
export {
  FenceSystem,
  generateFenceGeometry,
  generateFenceSlotGeometries,
} from './systems/fence/fence-system'
// Generic floor-elevation system. Lifts the rendered mesh of any kind
// whose definition declares `capabilities.floorPlaced` by the slab
// elevation under its footprint. Replaces the per-kind elevation block
// that used to live inside `ItemSystem`.
export { FloorElevationSystem } from './systems/floor-elevation/floor-elevation-system'
export { GuideSystem } from './systems/guide/guide-system'
export { InteractiveSystem } from './systems/interactive/interactive-system'
// Item systems for the registry-driven item definition. ItemSystem
// applies attachTo-driven transforms each frame; ItemLightSystem
// manages item-mounted light sources.
export { ItemSystem } from './systems/item/item-system'
export { ItemLightSystem } from './systems/item-light/item-light-system'
export { LevelSystem } from './systems/level/level-system'
export { snapLevelsToTruePositions } from './systems/level/level-utils'
export { getRoofMaterialArray } from './systems/roof/roof-materials'
// Generic roof-segment primitives. Kinds that compose CSG against
// the roof shell (chimney's self-trim, dormer's virtual-segment cut)
// read these through the public surface. No kind-specific helpers
// belong here — those live in `@pascal-app/nodes/<kind>/`.
export {
  clipGeometryBySegmentTrim,
  generateRoofSegmentGeometry,
  getRoofOuterSurfaceFrameAtPoint,
  getRoofSegmentBrushes,
  mapRoofGroupMaterialIndex,
  ROOF_MATERIAL_SLOT_COUNT,
  RoofSystem,
  remapRoofShellFaces,
  roofCsgDummyMats,
  type SurfaceFrame,
} from './systems/roof/roof-system'
export { ScanSystem } from './systems/scan/scan-system'
// Slab system follows the wall + fence re-export pattern — composed into
// the registry-driven slab definition's `def.system`. Removed in Phase 6
// alongside the legacy slab mount point.
export { generateSlabGeometry, SlabSystem } from './systems/slab/slab-system'
export {
  getStairBodyMaterials,
  getStairRailingMaterial,
  getStraightStairSegmentBodyMaterials,
  type StairBodyMaterials,
} from './systems/stair/stair-materials'
export { StairSystem } from './systems/stair/stair-system'
// Pure opening-cutout profile math shared by the wall CSG pipeline and
// roof-wall opening cuts in `@pascal-app/nodes` — keeps shaped holes
// (arch / rounded / frameless opening) identical across both hosts.
export {
  buildOpeningCutoutGeometry,
  hasFlatOpeningCutoutBottom,
} from './systems/wall/opening-cutout-geometry'
export { WallCutout } from './systems/wall/wall-cutout'
export { getVisibleWallMaterials } from './systems/wall/wall-materials'
// Wall internals re-exported so `@pascal-app/nodes`' registry-driven wall
// definition can compose them into `def.system` without duplicating the
// 800+ lines of CSG / mitering logic during Phase 3. These exports are
// removed in Phase 6 when the legacy mount points are deleted.
export { WallSystem } from './systems/wall/wall-system'
export {
  poseWindowMovingParts,
  WindowAnimationSystem,
} from './systems/window/window-animation-system'
export { buildWindowPreviewMesh, WindowSystem } from './systems/window/window-system'
export { ZoneSystem } from './systems/zone/zone-system'
