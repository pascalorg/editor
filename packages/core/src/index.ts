export type {
  BoxVentEvent,
  BuildingEvent,
  CameraControlEvent,
  CameraControlFitSceneEvent,
  CeilingEvent,
  ChimneyEvent,
  ColumnEvent,
  DoorEvent,
  DormerEvent,
  ElevatorEvent,
  EventSuffix,
  FenceEvent,
  GridEvent,
  GuideEvent,
  GutterEvent,
  ItemEvent,
  LevelEvent,
  NodeEvent,
  RidgeVentEvent,
  RoofEvent,
  RoofSegmentEvent,
  RoomPresetCreateEvent,
  ScanEvent,
  ShelfEvent,
  SiteEvent,
  SkylightEvent,
  SlabEvent,
  SolarPanelEvent,
  SpawnEvent,
  StairEvent,
  StairSegmentEvent,
  WallEvent,
  WindowEvent,
  ZoneEvent,
} from './events/bus'
export { emitter, eventSuffixes } from './events/bus'
export { type ItemClipEntry, itemClipRegistry } from './hooks/scene-registry/item-clip-registry'
export {
  sceneRegistry,
  useRegistry,
} from './hooks/scene-registry/scene-registry'
export {
  type FloorPlacedElevationArgs,
  getFloorPlacedElevation,
  getFloorPlacedFootprints,
  getFloorStackedPosition,
} from './hooks/spatial-grid/floor-placed-elevation'
export { pointInPolygon, spatialGridManager } from './hooks/spatial-grid/spatial-grid-manager'
export {
  findLevelAncestorId,
  initSpatialGridSync,
  resolveBuildingForLevel,
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
export { getDefaultLevelName, getLevelDisplayName } from './lib/level-name'
export {
  type Point2D as PolygonPoint2D,
  pointInPolygon as pointInPolygon2D,
  pointOnSegment,
  polygonContainsPolygon,
  polygonsIntersect,
  polygonsOverlap,
  segmentsIntersect,
} from './lib/polygon-relations'
export { getRenderableSlabPolygon } from './lib/slab-polygon'
export {
  deriveSlotId,
  isSlotMaterialName,
  SLOT_MATERIAL_PREFIX,
  slotLabelFromId,
} from './lib/slots'
export {
  type AutoCeilingPlanningContext,
  type AutoCeilingSyncPlan,
  type AutoSlabSyncPlan,
  detectSpacesForLevel,
  initSpaceDetectionSync,
  isSpaceDetectionPaused,
  pauseSpaceDetection,
  planAutoCeilingsForLevel,
  planAutoSlabsForLevel,
  projectAutoSlabsForPlan,
  resumeSpaceDetection,
  type Space,
  wallClosesRoom,
  wallTouchesOthers,
} from './lib/space-detection'
export {
  closestOnSegment,
  collectLevelWallSegments,
  nearestWallSegment,
  WALL_SNAP_DISTANCE_M,
  type WallSegment,
  type WallSegmentClosest,
} from './lib/wall-distance'
export {
  getCatalogMaterialById,
  getLibraryMaterialIdFromRef,
  getMaterialPresetByRef,
  getMaterialsForCategory,
  getSceneMaterialIdFromRef,
  LIBRARY_MATERIAL_REF_PREFIX,
  MATERIAL_CATALOG,
  MATERIAL_CATEGORIES,
  MATERIAL_SURFACES,
  type MaterialCatalogItem,
  type MaterialCategory,
  type MaterialRef,
  type MaterialSurface,
  type ParsedMaterialRef,
  parseMaterialRef,
  SCENE_MATERIAL_REF_PREFIX,
  toLibraryMaterialRef,
  toSceneMaterialRef,
} from './material-library'
export type {
  FloorPlacedFootprint,
  FloorPlacedFootprintContext,
  FloorPlacedFootprintResolver,
  FloorPlacedFootprintsResolver,
} from './registry'
export * from './registry'
export * from './schema'
export * from './services'
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
  type SkylightAnimationState,
  type SkylightInteractiveState,
  useInteractive,
  type WindowAnimationState,
  type WindowInteractiveState,
} from './store/use-interactive'
export {
  default as useLiveNodeOverrides,
  getEffectiveNode,
  type LiveNodeOverrides,
} from './store/use-live-node-overrides'
export { default as useLiveTransforms, type LiveTransform } from './store/use-live-transforms'
export { clearSceneHistory, default as useScene } from './store/use-scene'
export { resolveElevatorDispatchTarget } from './systems/elevator/elevator-dispatch'
export {
  type ElevatorDoorSide,
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
export {
  getFenceCenterlineFrameAt,
  getFenceCenterlineLength,
  sampleFenceCenterline,
} from './systems/fence/fence-centerline'
export {
  getFenceControlHandle,
  getFenceSplineFrameAt,
  getFenceSplineLength,
  getTwoPointFenceCurveTangents,
  isSplineFence,
  sampleFenceSpline,
} from './systems/fence/fence-spline'
export { type StairFootprintAABB, stairFootprintAABB } from './systems/stair/stair-footprint'
export { createSurfaceOpeningPreviewController } from './systems/stair/stair-opening-preview'
export { syncAutoStairOpenings } from './systems/stair/stair-opening-sync'
export { StairOpeningSystem } from './systems/stair/stair-opening-system'
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
  getLinkedWallUpdates,
  getPerpendicularWallMoveAxis,
  getPlannedLinkedWallUpdates,
  planWallMoveJunctions,
  type WallMoveAxis,
  type WallMoveBridgePlan,
  type WallMoveJunctionPlan,
  type WallMoveLinkedWallTargetPlan,
  type WallPlanPoint,
} from './systems/wall/wall-move'
export type { SceneGraph } from './utils/clone-scene-graph'
export { cloneLevelSubtree, cloneSceneGraph, forkSceneGraph } from './utils/clone-scene-graph'
export { isObject } from './utils/types'
export {
  type BuildStats,
  type ParsedBuildJson,
  type SchemaIssue,
  type ValidateBuildJsonResult,
  type ValidationIssue,
  type ValidationSeverity,
  validateBuildJson,
} from './validation/validate-build-json'
