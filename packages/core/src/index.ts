export * from './commands/structure'
export type {
  BlockEvent,
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
  ConstructionDimensionEvent,
  DoorEvent,
  DormerEvent,
  ElevatorEvent,
  EventSuffix,
  FenceEvent,
  GridEvent,
  GuideEvent,
  GutterEvent,
  ImportedMeshEvent,
  ItemEvent,
  LeanToExtensionEvent,
  LevelEvent,
  MeasurementEvent,
  NodeEvent,
  RidgeVentEvent,
  RoofEvent,
  RoofSegmentEvent,
  RoomPresetCreateEvent,
  ScanEvent,
  SeparatorEvent,
  ShelfEvent,
  SiteEvent,
  SkylightEvent,
  SlabEvent,
  SnapshotCaptureFailedEvent,
  SnapshotCapturePose,
  SnapshotSavedEvent,
  SolarPanelEvent,
  SpawnEvent,
  StairEvent,
  StairSegmentEvent,
  StructuralGridEvent,
  ThumbnailGenerateEvent,
  WallEvent,
  WindowEvent,
  ZoneEvent,
} from './events/bus'
export { emitter, eventSuffixes } from './events/bus'
export {
  hiddenWallPointerEventsHeld,
  holdHiddenWallPointerEvents,
} from './events/hidden-wall-pointer-hold'
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
  getWallBaseElevationForNodes,
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
  markSlabChangeDependents,
  resolveBuildingForLevel,
  resolveLevelId,
} from './hooks/spatial-grid/spatial-grid-sync'
export {
  type FenceConstructionOptions,
  type FenceSupportInput,
  type FrozenFloorPlacementOptions,
  resolveFenceConstructionSupport,
  resolveFenceSupportSlabPatch,
  resolveFrozenFloorPlacementPatch,
  resolveMovedWallSupportSlabPatch,
  resolveSupportSlabPatch,
  resolveTerrainWallConstructionOptions,
  resolveWallConstruction,
  resolveWallSupportSlabPatch,
  type SupportSlabPatch,
  type SupportSlabPatchOptions,
  type WallConstructionOptions,
  type WallConstructionResolution,
} from './hooks/spatial-grid/support-host-patch'
export { useSpatialQuery } from './hooks/spatial-grid/use-spatial-query'
export {
  ARTIFACT_URL_PREFIX,
  type ArtifactStore,
  artifactHash,
  artifactUrl,
  configureArtifactStore,
  getArtifactStore,
  resolveArtifactUrl,
} from './lib/artifact-store'
export {
  type AssemblyDiagnostic,
  type AssemblyDiagnosticCode,
  type ResolvedAssembly,
  type ResolvedAssemblyLayer,
  resolveAssemblyStack,
} from './lib/assembly-stack'
export { loadAssetUrl, saveAsset } from './lib/asset-storage'
export {
  CEILING_SURFACE_ROLE,
  type CeilingSurfaceCell,
  ceilingPaintRegions,
  ceilingRegionRole,
  ceilingRegionsOwner,
  ceilingSurfaceSignature,
  computeCeilingSurfaceCells,
  parseCeilingRegionRole,
} from './lib/ceiling-surface'
export { isCutterName, resolveCutterHost } from './lib/cutter-host'
export {
  clampDoorOperationState,
  getDoorRenderOpenAmount,
  getGarageVisibleOpeningRatio,
  isOperationDoorType,
  SECTIONAL_GARAGE_RENDER_OPEN_SCALE,
} from './lib/door-operation'
export { floorConstructionLift, liftedManualSlab } from './lib/floor-construction-lift'
export { floorFootprintName } from './lib/floor-footprint-name'
export {
  automaticFloorHeight,
  floorFootprintSupportClass,
  floorPlateAtGroundContact,
  floorPlateGestureMinimum,
  floorPlateHoldsUnderside,
  footprintLift,
  groundFloorConstruction,
  resolvedFootprintPlane,
  upperFloorHeightControl,
} from './lib/floor-foundation-datum'
export { changedLevelConstructionDisplacements } from './lib/floor-foundation-stack'
export {
  isFloorAnchoredOpening,
  openingAperture,
  openingLandings,
} from './lib/floor-opening-footprints'
export {
  adjacentLevelId,
  floorOpeningTargets,
  openingsForSurface,
} from './lib/floor-opening-intent'
export { type FloorPlatePaintRefusal, floorPlatePaintRefusal } from './lib/floor-plate-paint'
export {
  type FloorStepOverride,
  floorStepOverrideFor,
  floorStepRole,
  floorStepRoleCovers,
  parseFloorStepRole,
  remapFloorStepOverrideKeys,
  resolveFloorStepFinish,
  withFloorStepOverride,
  withoutFloorStepOverrideKeys,
} from './lib/floor-step-finish'
export {
  isScriptedNode,
  type ScriptedNode,
  scriptedOrigin,
  scriptedSize,
  scriptInteractive,
  scriptSource,
} from './lib/geometry-script-node'
export {
  flushMountRotation,
  geometryRestingHeight,
  geometrySurfaceAt,
  geometryUndersideAt,
  mountsFlush,
  nearestPointIn,
  resettledPosition,
} from './lib/geometry-surfaces'
export {
  type ExposedInterval,
  exposedIntervals,
  plateFootprint,
  roomClearPolygon,
} from './lib/level-footprints'
export { getDefaultLevelName, getLevelDisplayName } from './lib/level-name'
export {
  areMeasurementPointsCoplanar,
  closestMeasurementFeatureBinding,
  MEASUREMENT_PLANAR_TOLERANCE,
  measurementAnchorFallback,
  measurementAnchorReferenceNodeIds,
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
  remapMeasurementAnchors,
  remapMeasurementReferences,
} from './lib/measurement-geometry'
export { HIDDEN_SITE_NOTE, hidesDescendants } from './lib/node-visibility'
export {
  cutterContextNodes,
  getEffectiveCutterNode,
  hostedCutterHoles,
  withHostedCutterHoles,
} from './lib/object-cuts'
export {
  getOpeningFloorDatum,
  getOpeningWallCut,
  getOpeningWallPlacement,
  openingDatumFromSupport,
  wallSupportForNodes,
} from './lib/opening-floor-datum'
export {
  classifyPlateSideAt,
  clearPlateSurfaceCaches,
  computePlateSurfacePartition,
  floorStepKeysOf,
  isFloorPlate,
  levelWallCover,
  type PlateFinish,
  type PlateLevelContext,
  type PlateSideInterval,
  type PlateSideRole,
  type PlateSurfacePartition,
  type PlateTopCell,
  parseRoomFinishRole,
  plateFinishKey,
  plateLevelContext,
  platePartitionSignature,
  plateSideRuns,
  roomFinishRole,
} from './lib/plate-surface'
export {
  area,
  containsPoint,
  difference,
  distanceToBoundary,
  intersection,
  type MultiPolygon,
  type Polygon,
  type PolygonInput,
  type Ring,
  union,
} from './lib/polygon-boolean'
export { polygonInteriorPoint } from './lib/polygon-label'
export {
  type Point2D as PolygonPoint2D,
  pointInPolygon as pointInPolygon2D,
  pointOnSegment,
  polygonContainsPolygon,
  polygonsIntersect,
  polygonsOverlap,
  segmentsIntersect,
} from './lib/polygon-relations'
export {
  type Point2D as PolygonBooleanPoint2D,
  subtractPolygonsFromPolygon,
  unionPolygons,
} from './lib/polygon-union'
export {
  compareRoofOverlapIdentity,
  getRoofPlanBounds,
  type RoofOverlapEntry,
  type RoofPlan,
  type RoofPlanBounds,
  type RoofPlanSegment,
  roofOverlapEntryOwns,
  roofPlanBoundsOverlap,
  roofPlanOverlapEntryOwns,
} from './lib/roof-overlap'
export { type RoomDrawnFloor, roomDrawnFloor } from './lib/room-drawn-floor'
export { type RoomFloorChoice, roomFloorChoices } from './lib/room-floor-choices'
export {
  checkRoomFloor,
  clampRoomFloorHandle,
  FLOOR_ELEVATION_EPSILON,
  getRoomBaseElevation,
  getRoomRelativeFloorElevation,
  MIN_GROUND_FLOOR_THICKNESS,
  MIN_SLAB_THICKNESS,
  type RoomFloorConflict,
  roomFloorElevationFromRelative,
  roundFloorElevation,
} from './lib/room-floor-feasibility'
export {
  type BoundaryNode,
  type BoundarySpan,
  type ExteriorBoundarySpan,
  type IndexedTopologyDelta,
  type LevelFootprintContext,
  type LevelTopology,
  RoomTopologyIndex,
  type TopologyRoom,
} from './lib/room-topology-index'
export { resolveSelectionProxyId, selectionProxyIdFromMetadata } from './lib/selection-proxy'
export {
  arcRuns,
  envelopeFrontEdge,
  insetPolygon,
  type KeepOut,
  sightTriangle,
  streetCorners,
} from './lib/setback-envelope'
export {
  getRenderableSlabPolygon,
  prepareSlabPolygonContext,
  type SlabEdgeWallBandSnap,
  type SlabPolygonContext,
  scopeSlabPolygonContext,
  slabPolygonContextChanges,
  slabPolygonContextForLevel,
  slabPolygonContextFromGeometry,
  snapSlabEdgeToWallBand,
} from './lib/slab-polygon'
export {
  deriveSlotId,
  isSlotMaterialName,
  SLOT_MATERIAL_PREFIX,
  slotDefaultPaintMaterial,
  slotLabelFromId,
  slotPaintMaterial,
} from './lib/slots'
export {
  createRoomTopologyIndex,
  detectSpacesForLevel,
  type ExtractedRoom,
  extractRooms,
  initSpaceDetectionSync,
  isSpaceDetectionPaused,
  pauseSpaceDetection,
  resumeSpaceDetection,
  type Space,
  type SpaceBoundaryFace,
  wallClosesRoom,
  wallTouchesOthers,
} from './lib/space-detection'
export { applyStructureReconciliation } from './lib/structure-commit'
export {
  createLevelStructurePreview,
  type LevelStructureSnapshot,
  type NodePatch,
  reconcileLevelStructure,
  type StructureEvent,
} from './lib/structure-kernel'
export {
  reconcileSceneStructure,
  type SceneStructureInput,
  type SceneStructureResult,
  type StructureIdFactory,
} from './lib/structure-reconcile'
export {
  advanceStroke,
  type BrushSettings,
  type BrushShape,
  beginStroke,
  brushHeightAt,
  DEFAULT_BRUSH_SETTINGS,
  detachStrokeAnchor,
  highestOver,
  MIN_BRUSH_RADIUS_IN_SPACINGS,
  maxCoverage,
  minBrushRadius,
  RAISE_METRES_PER_STROKE,
  sampleTarget,
  type TerrainStroke,
  type TerrainVerb,
  weightAt,
} from './lib/terrain-brush'
export {
  decodeHeightPatch,
  decodeTerrainField,
  type EncodedHeightPatch,
  encodeHeightPatch,
  encodeTerrainField,
  isDatumField,
} from './lib/terrain-codec'
export { type Contour, terrainContours } from './lib/terrain-contours'
export {
  applyHeightPatch,
  createTerrainField,
  DEFAULT_TERRAIN_SPACING,
  DEFAULT_TERRAIN_STEP,
  diffToPatches,
  flattenPatch,
  type HeightPatch,
  heightAt,
  heightAtSample,
  isFlatOver,
  normalAt,
  quantize,
  sampleRangeOver,
  slopeAt,
  surfaceHeightAt,
  type TerrainField,
} from './lib/terrain-field'
export { raycastTerrain, type TerrainHit } from './lib/terrain-raycast'
export {
  commitTerrainField,
  persistedTerrainFieldOf,
  terrainFieldForEdit,
  terrainFieldOf,
} from './lib/terrain-source'
export {
  isLevelBaseConsumer,
  isSiteDatum,
  levelBaseElevationAt,
  noteLevelBaseConsumer,
  SITE_DATUM_EPSILON,
  SITE_DATUM_Y,
  terrainSupportLift,
} from './lib/terrain-support'
export {
  deriveUnit,
  type UnitDerivation,
  unassignedZoneIds,
  unitsForZone,
  unitWarnings,
} from './lib/unit-containment'
export { buildUnitReport, type UnitReport } from './lib/unit-report'
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
  materialColorPaint,
  type ParsedMaterialRef,
  parseMaterialColor,
  parseMaterialRef,
  registerLibraryMaterials,
  SCENE_MATERIAL_REF_PREFIX,
  subscribeLibraryMaterials,
  toLibraryMaterialRef,
  toSceneMaterialRef,
  unregisterLibraryMaterials,
} from './material-library'
export * from './node-slots'
export type {
  FloorPlacedFootprint,
  FloorPlacedFootprintContext,
  FloorPlacedFootprintResolver,
  FloorPlacedFootprintsResolver,
} from './registry'
export * from './registry'
// Exported here rather than from the registry barrel: that barrel is
// reachable from server-safe graphs (schema → spatial grid → registry)
// and must stay free of React imports.
export { useRegistryVersion } from './registry/use-registry-version'
export * from './schema'
export * from './services'
export { isMovable, movePlanToward, moveToward, resolveMovable } from './services/movement'
export {
  collectionIdsOf,
  joinCollections,
  type NodeDeletionPlan,
  type NodeDeletionScene,
  planNodeDeletion,
  planSceneNodeChanges,
  previewDefaultGutterRefresh,
} from './store/actions/node-actions'
export {
  assertDerivedNodeWrites,
  type DerivedNodeChanges,
  DerivedNodeWriteError,
  type DerivedSurfaceNode,
  type DerivedWriteOperation,
  derivedDeletionIntent,
  derivedFieldViolations,
  isDerivedNode,
} from './store/derived-node-guard'
export {
  acquireSceneHistoryPause,
  activeSceneCommitNodeIds,
  beginSceneHistoryPauseSession,
  getSceneHistoryPauseDepth,
  isApplyingRemoteSceneChange,
  pauseSceneHistory,
  resetSceneHistoryPauseDepth,
  resumeSceneHistory,
  runAsSingleSceneHistoryStep,
  type SceneCommit,
  type SceneCommitListener,
  type SceneCommitOrigin,
  type SceneHistoryPauseSession,
  type SceneHistoryPauseSessionOptions,
  type SceneSnapshot,
  subscribeSceneCommits,
} from './store/history-control'
export { withSceneHistoryDraftSuspended } from './store/history-drafts'
export { getHistoryDirtyNodeIds } from './store/history-invalidation'
export {
  type ItemInteraction,
  itemInteraction,
  itemPrompt,
  operateItem,
} from './store/item-interaction'
export { materializeRegisteredNodeDefaults } from './store/registered-node-defaults'
export {
  type ControlValue,
  type DoorAnimationState,
  type DoorInteractiveState,
  type ElevatorInteractiveState,
  type ElevatorPhase,
  type InteractiveState,
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
export {
  default as useLiveTerrain,
  type LiveTerrainStroke,
} from './store/use-live-terrain'
export { default as useLiveTransforms, type LiveTransform } from './store/use-live-transforms'
export {
  type ApplySceneSnapshotOptions,
  acquireSceneReadOnlyLease,
  applySceneOperationPatch,
  applyScenePatch,
  applySceneSnapshot,
  beginSceneHistoryDraft,
  clearSceneHistory,
  default as useScene,
  runSceneHistoryDraftWrite,
  type SceneMaterialPatch,
  type SceneNodePatch,
  type SceneNodeStructuralPatch,
  type SceneOperationPatch,
  type ScenePatch,
  type ScenePluginInstallPatch,
  sceneHistoryDraftRevertUpdates,
  settleSceneHistoryDrafts,
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
export type {
  FenceFeatureData,
  FenceWithFeatures,
  ResolvedFenceFeature,
} from './systems/fence/fence-features'
export {
  canPlaceFenceFeature,
  fenceFeatureData,
  fenceFeaturePlacementIssue,
  fenceWithFeatures,
  getFenceGateLeaves,
  isFenceFeatureNode,
  projectPointToFence,
  resolveFenceFeatures,
} from './systems/fence/fence-features'
export type { FenceSpanMode } from './systems/fence/fence-spline'
export {
  getFenceControlHandle,
  getFenceSpanMode,
  getFenceSplineFrameAt,
  getFenceSplineLength,
  getTwoPointFenceCurveTangents,
  isSplineFence,
  sampleFenceSpline,
} from './systems/fence/fence-spline'
export { planOwnedFloorOpenings } from './systems/owned-floor-openings'
export { resolveRoofElevation, resolveRoofWallTopElevation } from './systems/roof/roof-elevation'
export { RoofElevationSystem } from './systems/roof/roof-elevation-system'
export {
  fitRoofFootprint,
  type RoofFootprintTarget,
  resolveRoomRoofFootprint,
  resolveRoomRoofFootprintOnLevel,
} from './systems/roof/roof-footprint'
export { resolveSlabPlacementElevation } from './systems/slab/slab-placement'
export {
  clampSlabElevationForWalls,
  computeWallSlabSupport,
  getSlabElevationUpperBound,
  resolveWallFaceBottom,
  type SlabElevationClamp,
  type WallSlabSupport,
} from './systems/slab/slab-support'
export {
  createDefaultStairSegment,
  createStairFlightFromStair,
  type StairFlightOverrides,
} from './systems/stair/stair-flight'
export {
  computeStairSegmentFloorStackTransforms,
  getStairFloorPlacedFootprints,
  getStairSegmentFloorPlacedFootprints,
} from './systems/stair/stair-floor-footprints'
export {
  computeSegmentTransforms,
  type StairFootprintAABB,
  stairDeckLevelId,
  stairFootprintAABB,
} from './systems/stair/stair-footprint'
export { createSurfaceOpeningPreviewController } from './systems/stair/stair-opening-preview'
export { syncAutoStairOpenings } from './systems/stair/stair-opening-sync'
export { StairOpeningSystem } from './systems/stair/stair-opening-system'
export { resolveStairTotalRise, syncStairRises } from './systems/stair/stair-rise'
export { stairHasNoRise } from './systems/stair/stair-rise-query'
export {
  assemblyThickness,
  BRICK_AIR_SPACE,
  BRICK_VENEER,
  CMU_8_ACTUAL,
  calculateLevelLayerMiters,
  FIBER_CEMENT,
  FURRING_1X,
  GYPSUM_FIVE_EIGHTHS,
  GYPSUM_HALF,
  GYPSUM_SHEATHING,
  getWallAssemblyPreset,
  getWallLayerPolylines,
  isLegacyWallAssembly,
  type ResolvedWallAssembly,
  resolveWallAssembly,
  resolveWallExteriorSide,
  SIDING_LAP,
  STONE_VENEER_UNVERIFIED,
  STUCCO_3_COAT,
  STUD_2X4,
  STUD_2X6,
  WALL_ASSEMBLY_PRESETS,
  WALL_FINISH_LIBRARY_REF,
  type WallAssemblyLayer,
  type WallAssemblyLayerRole,
  type WallAssemblyPreset,
  type WallLayerMiterData,
  type WallLayerPolyline,
  WSP_SHEATHING,
  wallAssemblyExteriorFinish,
  wallAssemblyFinishRef,
  wallAssemblyFraming,
  wallAssemblyFromLegacy,
  wallAssemblyPatch,
  wallAssemblyToLegacy,
  wallAssemblyUnverifiedNote,
  wallLayerBoundaryOffsets,
} from './systems/wall/wall-assembly'
export {
  constrainWallCurveOffsetToAvoidIntersections,
  getClampedWallCurveOffset,
  getMaxWallCurveOffset,
  getWallArcData,
  getWallChordFrame,
  getWallCurveFrameAt,
  getWallCurveLength,
  getWallCurveStationAtPoint,
  getWallMidpointHandlePoint,
  getWallStraightSnapOffset,
  getWallSurfacePolygon,
  isCurvedWall,
  normalizeWallCurveOffset,
  sampleWallCenterline,
} from './systems/wall/wall-curve'
export {
  buildWallFinishLayout,
  getWallLevelZones,
  getWallZoneSpans,
  parseWallPaintRole,
  resolveWallFaceChain,
  resolveWallFinish,
  type WallFaceChainFinish,
  type WallFinishHit,
  type WallFinishLayout,
  type WallFinishSpan,
  type WallPaintRole,
  type WallZoneSpan,
  wallFinishMaterialIndex,
  wallRegionRole,
  wallRoomFaceRole,
  wallRoomFinishRole,
  zoneHasWallFinish,
} from './systems/wall/wall-finish'
export {
  DEFAULT_WALL_HEIGHT,
  DEFAULT_WALL_THICKNESS,
  getWallPlanFootprint,
  getWallThickness,
} from './systems/wall/wall-footprint'
export {
  buildWallJustificationPatch,
  faceOnLine,
  getWallBodyCenterOffset,
  getWallBodyLine,
  getWallFaceAtLocalPoint,
  getWallFaceLine,
  getWallFaceOffsets,
  getWallLocalFaceZ,
  justificationForFaceOnLine,
  planWallJustification,
  reverseWallDirection,
  type WallFaceOffsets,
  type WallJustification,
} from './systems/wall/wall-frame'
export {
  getWallLayerBands,
  type WallLayerBand,
  type WallLayerBands,
} from './systems/wall/wall-layer-bands'
export { planWallMerge } from './systems/wall/wall-merge'
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
  planWallDivision,
  planWallDivisions,
  planWallRectangle,
  wallRectangleCorners,
} from './systems/wall/wall-operations'
export { roomSideFaces } from './systems/wall/wall-room-sides'
export { wallDoorStepRuns } from './systems/wall/wall-step-openings'
export {
  MIN_WALL_HEIGHT,
  resolveWallEffectiveHeight,
  resolveWallTop,
} from './systems/wall/wall-top'
export {
  planWallInsertion,
  planWallSplitAtPoint,
} from './systems/wall/wall-topology'
export type { SceneGraph } from './utils/clone-scene-graph'
export { cloneLevelSubtree, cloneSceneGraph, forkSceneGraph } from './utils/clone-scene-graph'
export { isObject } from './utils/types'
export {
  checkOpeningWithinWall,
  formatOpeningBoundsIssue,
  OPENING_BOUNDS_TOLERANCE,
  type OpeningBoundsIssue,
} from './validation/opening-bounds'
export {
  type BuildStats,
  type ParsedBuildJson,
  type SchemaIssue,
  type ValidateBuildJsonResult,
  type ValidationIssue,
  type ValidationSeverity,
  validateBuildJson,
} from './validation/validate-build-json'
