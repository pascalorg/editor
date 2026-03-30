// Store

export type {
  BuildingEvent,
  CameraControlEvent,
  CeilingEvent,
  DoorEvent,
  EventSuffix,
  GridEvent,
  ItemEvent,
  LevelEvent,
  NodeEvent,
  RoofEvent,
  RoofSegmentEvent,
  SiteEvent,
  SlabEvent,
  WallEvent,
  WindowEvent,
  ZoneEvent,
} from './events/bus'
// Events
export { emitter, eventSuffixes } from './events/bus'
// Hooks
export {
  sceneRegistry,
  useRegistry,
} from './hooks/scene-registry/scene-registry'
export { pointInPolygon, spatialGridManager } from './hooks/spatial-grid/spatial-grid-manager'
export {
  initSpatialGridSync,
  resolveLevelId,
} from './hooks/spatial-grid/spatial-grid-sync'
export { useSpatialQuery } from './hooks/spatial-grid/use-spatial-query'
// Asset storage
export { loadAssetUrl, saveAsset } from './lib/asset-storage'
// Space detection
export {
  detectSpacesForLevel,
  initSpaceDetectionSync,
  type Space,
  wallTouchesOthers,
} from './lib/space-detection'
// Schema
export * from './schema'
export {
  type ControlValue,
  type ItemInteractiveState,
  useInteractive,
} from './store/use-interactive'
export { clearSceneHistory, default as useScene } from './store/use-scene'
// Systems
export { CeilingSystem } from './systems/ceiling/ceiling-system'
export { DoorSystem } from './systems/door/door-system'
export { ItemSystem } from './systems/item/item-system'
export { RoofSystem } from './systems/roof/roof-system'
export { SlabSystem } from './systems/slab/slab-system'
export {
  DEFAULT_WALL_HEIGHT,
  DEFAULT_WALL_THICKNESS,
  getWallPlanFootprint,
  getWallThickness,
} from './systems/wall/wall-footprint'
export {
  calculateLevelMiters,
  type Point2D,
  pointToKey,
  type WallMiterData,
} from './systems/wall/wall-mitering'
export { WallSystem } from './systems/wall/wall-system'
export { WindowSystem } from './systems/window/window-system'
export { cloneSceneGraph } from './utils/clone-scene-graph'
export { isObject } from './utils/types'
