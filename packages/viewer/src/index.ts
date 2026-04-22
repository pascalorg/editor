import './lib/suppress-three-clock-warning'

export { ItemRepairEnergyWave } from './components/renderers/item/item-repair-energy-wave'
export { default as Viewer } from './components/viewer'
export { SSGI_PARAMS } from './components/viewer/post-processing'
export { WalkthroughControls } from './components/viewer/walkthrough-controls'
export {
  useViewerRuntimeState,
  type ViewerRuntimeItemDeleteActivation,
  type ViewerRuntimeItemMovePreview,
  type ViewerRuntimePostWarmupScope,
  type ViewerRuntimeRepairShieldActivation,
  type ViewerRuntimeState,
  ViewerRuntimeStateProvider,
} from './contexts/viewer-runtime-state'
export { ASSETS_CDN_URL, resolveAssetUrl, resolveCdnUrl } from './lib/asset-url'
export {
  applyCarriedBubbleUniforms,
  createCarriedBubbleMaterial,
  DEFAULT_CARRIED_BUBBLE_SETTINGS,
  type CarriedBubbleSettings,
  getCarriedBubbleBox,
  getCarriedBubbleUniforms,
  useCarriedBubbleNoiseTexture,
} from './lib/carried-bubble'
export {
  applyEnergyWaveShieldUniforms,
  createEnergyWaveShieldMaterial,
  DEFAULT_ENERGY_WAVE_SHIELD_SETTINGS,
  ENERGY_WAVE_FADE_HEIGHT_METERS,
  ENERGY_WAVE_FULL_EFFECT_HEIGHT_METERS,
  type EnergyWaveShieldSettings,
} from './lib/energy-wave-shield'
export { ITEM_DELETE_FADE_OUT_MS } from './lib/item-delete-visual'
export { SCENE_LAYER, VFX_LAYER, ZONE_LAYER } from './lib/layers'
export {
  clearMaterialCache,
  createDefaultMaterial,
  createMaterial,
  DEFAULT_CEILING_MATERIAL,
  DEFAULT_DOOR_MATERIAL,
  DEFAULT_ROOF_MATERIAL,
  DEFAULT_SLAB_MATERIAL,
  DEFAULT_WALL_MATERIAL,
  DEFAULT_WINDOW_MATERIAL,
  disposeMaterial,
} from './lib/materials'
export { mergedOutline } from './lib/merged-outline-node'
export {
  applyScifiShieldUniforms,
  createScifiShieldBackdropMaterial,
  createScifiShieldMaterial,
  createScifiShieldOccluderMaterial,
  DEFAULT_SCIFI_SHIELD_SETTINGS,
  ITEM_REPAIR_SHIELD_SETTINGS,
  type ScifiShieldSettings,
  useScifiShieldNoiseTexture,
} from './lib/scifi-shield'
export { default as useViewer } from './store/use-viewer'
export { InteractiveSystem } from './systems/interactive/interactive-system'
export { snapLevelsToTruePositions } from './systems/level/level-utils'
