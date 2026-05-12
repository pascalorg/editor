export type {
  BuildingEvent,
  CameraControlEvent,
  CameraControlFitSceneEvent,
  CeilingEvent,
  ColumnEvent,
  DoorEvent,
  ElevatorEvent,
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
  SpawnEvent,
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
  clampDoorOperationState,
  getDoorRenderOpenAmount,
  getGarageVisibleOpeningRatio,
  isOperationDoorType,
  SECTIONAL_GARAGE_RENDER_OPEN_SCALE,
} from './lib/door-operation'
export { getRenderableSlabPolygon } from './lib/slab-polygon'
export {
  detectSpacesForLevel,
  initSpaceDetectionSync,
  planAutoSlabsForLevel,
  type AutoSlabSyncPlan,
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
export * from './schema'
export {
  getSceneHistoryPauseDepth,
  pauseSceneHistory,
  resetSceneHistoryPauseDepth,
  resumeSceneHistory,
} from './store/history-control'
export {
  type ControlValue,
  type DoorAnimationState,
  type DoorInteractiveState,
  type ElevatorInteractiveState,
  type ElevatorPhase,
  type ItemInteractiveState,
  useInteractive,
  type WindowAnimationState,
  type WindowInteractiveState,
} from './store/use-interactive'
export {
  default as useLiveNodeOverrides,
  type LiveNodeOverrides,
} from './store/use-live-node-overrides'
export { default as useLiveTransforms, type LiveTransform } from './store/use-live-transforms'
export { clearSceneHistory, default as useScene } from './store/use-scene'
export { resolveElevatorDispatchTarget } from './systems/elevator/elevator-dispatch'
export {
  getElevatorCabCenterZ,
  getElevatorCabDepth,
  getElevatorCabWidth,
  getElevatorDoorLeafSides,
  getElevatorDoorLeafWidth,
  getElevatorDoorLeafX,
  getElevatorShaftDepth,
  getElevatorShaftWallThickness,
  getElevatorShaftWidth,
  getResolvedElevatorDoorPanelStyle,
  getResolvedElevatorDoorStyle,
  getResolvedElevatorShaftStyle,
  type ElevatorDoorSide,
} from './systems/elevator/elevator-geometry'
export { syncAutoElevatorOpenings } from './systems/elevator/elevator-opening-sync'
export { ElevatorOpeningSystem } from './systems/elevator/elevator-opening-system'
export {
  createElevatorInteractiveState,
  openElevatorDoor,
  openElevatorDoorState,
  queueElevatorRequest,
  requestElevatorLevel,
  stepElevatorRuntimeState,
  stepElevatorRuntimes,
} from './systems/elevator/elevator-runtime'
export { ElevatorRuntimeSystem } from './systems/elevator/elevator-runtime-system'
export {
  DEFAULT_ELEVATOR_LEVEL_HEIGHT,
  type ElevatorLevelEntry,
  getElevatorLevelHeight,
  resolveElevatorBuildingLevels,
  resolveElevatorLevels,
  resolveElevatorServiceLevelIds,
  resolveElevatorServiceLevels,
} from './systems/elevator/elevator-service'
export { syncAutoStairOpenings } from './systems/stair/stair-opening-sync'
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
  getAdjacentWallIds,
  getWallMiterBoundaryPoints,
  type Point2D,
  pointToKey,
  type WallMiterBoundaryPoints,
  type WallMiterData,
} from './systems/wall/wall-mitering'
export {
  constrainWallMoveDeltaToAxis,
  getPerpendicularWallMoveAxis,
  planWallMoveJunctions,
  type WallMoveBridgePlan,
  type WallMoveAxis,
  type WallMoveJunctionPlan,
  type WallPlanPoint,
} from './systems/wall/wall-move'
export type { SceneGraph } from './utils/clone-scene-graph'
export { cloneLevelSubtree, cloneSceneGraph, forkSceneGraph } from './utils/clone-scene-graph'
export { isObject } from './utils/types'
