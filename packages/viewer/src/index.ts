// `NodeRenderer` is the recursive dispatch component used by parent
// renderers (wall renders doors/windows, slab renders hosted items).
// Public so registry-driven kinds can compose children without reaching
// into viewer's internal paths.
export { NodeRenderer } from './components/renderers/node-renderer'
export { default as Viewer } from './components/viewer'
export type { HoverStyle, HoverStyles } from './components/viewer/post-processing'
export {
  DEFAULT_HOVER_STYLES,
  SSGI_PARAMS,
} from './components/viewer/post-processing'
export { WalkthroughControls } from './components/viewer/walkthrough-controls'
export { useNodeEvents } from './hooks/use-node-events'
export { ASSETS_CDN_URL, resolveAssetUrl, resolveCdnUrl } from './lib/asset-url'
export { SCENE_LAYER, ZONE_LAYER } from './lib/layers'
export {
  applyMaterialPresetToMaterials,
  clearMaterialCache,
  createDefaultMaterial,
  createMaterial,
  createMaterialFromPresetRef,
  DEFAULT_CEILING_MATERIAL,
  DEFAULT_DOOR_MATERIAL,
  DEFAULT_ROOF_MATERIAL,
  DEFAULT_SLAB_MATERIAL,
  DEFAULT_STAIR_MATERIAL,
  DEFAULT_WALL_MATERIAL,
  DEFAULT_WINDOW_MATERIAL,
  disposeMaterial,
  glassMaterial,
} from './lib/materials'
export { mergedOutline } from './lib/merged-outline-node'
export { default as useViewer } from './store/use-viewer'
// Fence system follows the wall re-export pattern — composed into the
// registry-driven fence definition's `def.system`. Removed in Phase 6
// alongside the legacy fence mount point.
export { FenceSystem } from './systems/fence/fence-system'
export { InteractiveSystem } from './systems/interactive/interactive-system'
export { snapLevelsToTruePositions } from './systems/level/level-utils'
export { getRoofMaterialArray } from './systems/roof/roof-materials'
// Slab system follows the wall + fence re-export pattern — composed into
// the registry-driven slab definition's `def.system`. Removed in Phase 6
// alongside the legacy slab mount point.
export { SlabSystem } from './systems/slab/slab-system'
export { getStairBodyMaterials, getStairRailingMaterial } from './systems/stair/stair-materials'
export { WallCutout } from './systems/wall/wall-cutout'
export { getVisibleWallMaterials } from './systems/wall/wall-materials'
// Wall internals re-exported so `@pascal-app/nodes`' registry-driven wall
// definition can compose them into `def.system` without duplicating the
// 800+ lines of CSG / mitering logic during Phase 3. These exports are
// removed in Phase 6 when the legacy mount points are deleted.
export { WallSystem } from './systems/wall/wall-system'
