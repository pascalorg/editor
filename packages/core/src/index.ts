// Store

export type {
  BuildingEvent,
  CameraControlEvent,
  CeilingEvent,
  EventSuffix,
  GridEvent,
  ItemEvent,
  LevelEvent,
  NodeEvent,
  RoofEvent,
  SiteEvent,
  SlabEvent,
  WallEvent,
  ZoneEvent,
} from './events/bus'
// Events
export { emitter, eventSuffixes } from './events/bus'
// Hooks
export {
  sceneRegistry,
  useRegistry,
} from './hooks/scene-registry/scene-registry'
export {
  initSpatialGridSync,
  resolveLevelId,
} from './hooks/spatial-grid/spatial-grid-sync'
export { useSpatialQuery } from './hooks/spatial-grid/use-spatial-query'
export { pointInPolygon, spatialGridManager } from './hooks/spatial-grid/spatial-grid-manager'
// Schema
export * from './schema'
export { default as useScene } from './store/use-scene'
// Systems
export { CeilingSystem } from './systems/ceiling/ceiling-system'
export { ItemSystem } from './systems/item/item-system'
export { RoofSystem } from './systems/roof/roof-system'
export { SlabSystem } from './systems/slab/slab-system'
export { WallSystem } from './systems/wall/wall-system'
export { WindowSystem } from './systems/window/window-system'

export { isObject } from './utils/types'
// Asset storage
export { saveAsset, loadAssetUrl } from './lib/asset-storage'
// Space detection
export { detectSpacesForLevel, wallTouchesOthers, initSpaceDetectionSync, type Space } from './lib/space-detection'
