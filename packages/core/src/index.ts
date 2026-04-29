export type {
  BuildingEvent,
  CameraControlEvent,
  CameraControlFitSceneEvent,
  CeilingEvent,
  DoorEvent,
  EventSuffix,
  FenceEvent,
  GridEvent,
  ItemEvent,
  LevelEvent,
  NodeEvent,
  RoofEvent,
  RoofSegmentEvent,
  SiteEvent,
  SlabEvent,
  StairEvent,
  StairSegmentEvent,
  WallEvent,
  WindowEvent,
  ZoneEvent,
} from './events/bus'
export { emitter, eventSuffixes } from './events/bus'
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
export { loadAssetUrl, saveAsset } from './lib/asset-storage'
export {
  detectSpacesForLevel,
  initSpaceDetectionSync,
  type Space,
  wallTouchesOthers,
} from './lib/space-detection'
export {
  getCatalogMaterialById,
  getLibraryMaterialIdFromRef,
  getMaterialPresetByRef,
  getMaterialsForCategory,
  LIBRARY_MATERIAL_REF_PREFIX,
  MATERIAL_CATALOG,
  MATERIAL_CATEGORIES,
  type MaterialCatalogItem,
  type MaterialCategory,
  toLibraryMaterialRef,
} from './material-library'
export { baseMaterial, glassMaterial } from './materials'
export * from './schema'
export {
  getSceneHistoryPauseDepth,
  pauseSceneHistory,
  resetSceneHistoryPauseDepth,
  resumeSceneHistory,
} from './store/history-control'
export {
  type ControlValue,
  type ItemInteractiveState,
  useInteractive,
} from './store/use-interactive'
export { default as useLiveTransforms, type LiveTransform } from './store/use-live-transforms'
export { clearSceneHistory, default as useScene } from './store/use-scene'
export { CeilingSystem } from './systems/ceiling/ceiling-system'
export { DoorSystem } from './systems/door/door-system'
export { FenceSystem } from './systems/fence/fence-system'
export { ItemSystem } from './systems/item/item-system'
export { RoofSystem } from './systems/roof/roof-system'
export { getRenderableSlabPolygon, SlabSystem } from './systems/slab/slab-system'
export { StairSystem } from './systems/stair/stair-system'
export {
  getClampedWallCurveOffset,
  getMaxWallCurveOffset,
  getWallChordFrame,
  getWallCurveFrameAt,
  getWallCurveLength,
  getWallMidpointHandlePoint,
  getWallStraightSnapOffset,
  getWallSurfacePolygon,
  isCurvedWall,
  normalizeWallCurveOffset,
  sampleWallCenterline,
} from './systems/wall/wall-curve'
export {
  DEFAULT_WALL_HEIGHT,
  DEFAULT_WALL_THICKNESS,
  getWallPlanFootprint,
  getWallThickness,
} from './systems/wall/wall-footprint'
export {
  calculateLevelMiters,
  getWallMiterBoundaryPoints,
  type Point2D,
  pointToKey,
  type WallMiterBoundaryPoints,
  type WallMiterData,
} from './systems/wall/wall-mitering'
export { WallSystem } from './systems/wall/wall-system'
export { WindowSystem } from './systems/window/window-system'
export type { SceneGraph } from './utils/clone-scene-graph'
export { cloneLevelSubtree, cloneSceneGraph, forkSceneGraph } from './utils/clone-scene-graph'
export { isObject } from './utils/types'
