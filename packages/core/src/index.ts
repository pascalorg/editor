export type {
  BoxVentEvent,
  BuildingEvent,
  CabinetEvent,
  CabinetModuleEvent,
  CameraControlEvent,
  CameraControlFitSceneEvent,
  CameraPose,
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
  MeasurementEvent,
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
  GROUND_SUPPORT_ID,
  getFloorPlacedElevation,
  getFloorPlacedFootprints,
  getFloorStackedPosition,
} from './hooks/spatial-grid/floor-placed-elevation'
export {
  getWallEffectiveHeightForNodes,
  type PointedSupportSurface,
  pointInPolygon,
  SUPPORT_ELEVATION_EPSILON,
  spatialGridManager,
  type WallSlabSupportSegment,
} from './hooks/spatial-grid/spatial-grid-manager'
export {
  findLevelAncestorId,
  initSpatialGridSync,
  resolveBuildingForLevel,
  resolveLevelId,
} from './hooks/spatial-grid/spatial-grid-sync'
export {
  type FenceSupportInput,
  resolveFenceSupportSlabPatch,
  resolveSupportSlabPatch,
  resolveWallSupportSlabPatch,
  type SupportSlabPatch,
  type SupportSlabPatchOptions,
} from './hooks/spatial-grid/support-host-patch'
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
  areMeasurementPointsCoplanar,
  closestMeasurementFeatureBinding,
  MEASUREMENT_PLANAR_TOLERANCE,
  measurementAnchorFallback,
  measurementAngle,
  measurementArea,
  measurementAreaVector,
  measurementCentroid,
  measurementDistance,
  measurementFeatureLength,
  measurementNormal,
  measurementPerimeter,
  measurementPrismVolume,
  measurementReferenceNodeIds,
  remapMeasurementReferences,
} from './lib/measurement-geometry'
export {
  type Point2D as PolygonPoint2D,
  pointInPolygon as pointInPolygon2D,
  pointOnSegment,
  polygonContainsPolygon,
  polygonsIntersect,
  polygonsOverlap,
  segmentsIntersect,
} from './lib/polygon-relations'
export { resolveSelectionProxyId, selectionProxyIdFromMetadata } from './lib/selection-proxy'
export {
  getRenderableSlabPolygon,
  type SlabEdgeWallBandSnap,
  type SlabPolygonContext,
  slabPolygonContextFromGeometry,
  snapSlabEdgeToWallBand,
} from './lib/slab-polygon'
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
  type AutoZoneSyncPlan,
  detectSpacesForLevel,
  initSpaceDetectionSync,
  isSpaceDetectionPaused,
  pauseSpaceDetection,
  planAutoCeilingsForLevel,
  planAutoSlabsForLevel,
  planAutoZonesForLevel,
  resolveAutoZonePolygon,
  resumeSpaceDetection,
  type Space,
  type SpaceBoundaryFace,
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
  deriveZoneQuantityReport,
  type ZoneQuantityReport,
  type ZoneQuantityValue,
} from './lib/zone-quantities'
export {
  getCatalogMaterialById,
  getDynamicLibraryMaterials,
  getLibraryMaterialIdFromRef,
  getLibraryMaterialsVersion,
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
  type MaterialSource,
  type MaterialSurface,
  type ParsedMaterialRef,
  parseMaterialRef,
  registerLibraryMaterials,
  SCENE_MATERIAL_REF_PREFIX,
  subscribeLibraryMaterials,
  toLibraryMaterialRef,
  toSceneMaterialRef,
  unregisterLibraryMaterials,
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
export { isMovable, movePlanToward, moveToward, resolveMovable } from './services/movement'
export {
  getSceneHistoryPauseDepth,
  pauseSceneHistory,
  resetSceneHistoryPauseDepth,
  resumeSceneHistory,
  runAsSingleSceneHistoryStep,
  type SceneCommit,
  type SceneCommitListener,
  type SceneCommitOrigin,
  type SceneSnapshot,
  subscribeSceneCommits,
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
export {
  type ApplySceneSnapshotOptions,
  acquireSceneReadOnlyLease,
  applyScenePatch,
  applySceneSnapshot,
  clearSceneHistory,
  default as useScene,
  type SceneMaterialPatch,
  type SceneNodePatch,
  type ScenePatch,
} from './store/use-scene'
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
  type ElevatorLevelEntry,
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
export {
  clampSlabElevationForWalls,
  getSlabElevationUpperBound,
  type SlabElevationClamp,
} from './systems/slab/slab-support'
export { type StairFootprintAABB, stairFootprintAABB } from './systems/stair/stair-footprint'
export { createSurfaceOpeningPreviewController } from './systems/stair/stair-opening-preview'
export { syncAutoStairOpenings } from './systems/stair/stair-opening-sync'
export { StairOpeningSystem } from './systems/stair/stair-opening-system'
export { resolveStairTotalRise } from './systems/stair/stair-rise'
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
export {
  MIN_WALL_HEIGHT,
  resolveWallEffectiveHeight,
  resolveWallTop,
} from './systems/wall/wall-top'
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
