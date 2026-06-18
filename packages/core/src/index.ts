export type {
  BoxEvent,
  BuildingEvent,
  CableTrayEvent,
  CameraControlEvent,
  CameraControlFitSceneEvent,
  CapsuleEvent,
  CeilingEvent,
  ColumnEvent,
  CylinderEvent,
  DataWidgetEvent,
  DoorEvent,
  ElevatorEvent,
  EventSuffix,
  ExtrudeEvent,
  FenceEvent,
  GridEvent,
  GuideEvent,
  HalfCylinderEvent,
  ItemEvent,
  LadderEvent,
  LatheEvent,
  LevelEvent,
  NodeEvent,
  PipeFittingEvent,
  RoadEvent,
  RoofEvent,
  RoofSegmentEvent,
  RoundedPanelEvent,
  ScanEvent,
  ShelfEvent,
  SiteEvent,
  SlabEvent,
  SpawnEvent,
  SphereEvent,
  StairEvent,
  StairSegmentEvent,
  SteelBeamEvent,
  SweepEvent,
  TankEvent,
  WallEvent,
  WindowEvent,
  ZoneEvent,
} from './events/bus'
export { emitter, eventSuffixes } from './events/bus'
export {
  sceneRegistry,
  useRegistry,
} from './hooks/scene-registry/scene-registry'
export {
  type FloorPlacedElevationArgs,
  type FloorPlacedFootprint,
  type FloorPlacedFootprintContext,
  type FloorPlacedFootprintsResolver,
  getFloorPlacedElevation,
  getFloorPlacedFootprints,
  getFloorStackedPosition,
} from './hooks/spatial-grid/floor-placed-elevation'
export { pointInPolygon, spatialGridManager } from './hooks/spatial-grid/spatial-grid-manager'
export {
  initSpatialGridSync,
  resolveBuildingForLevel,
  resolveLevelId,
} from './hooks/spatial-grid/spatial-grid-sync'
export { useSpatialQuery } from './hooks/spatial-grid/use-spatial-query'
export {
  type AssemblyComposeInput,
  type AssemblyPartPlanItem,
  composeAssemblyPrimitives,
  getAssemblyGeometryBrief,
  planAssemblyParts,
} from './lib/assembly-compose'
export {
  type AssemblyConstraintValidation,
  type AssemblyObjectFamily,
  extractUserGeometryConstraints,
  type HardColorConstraint,
  type HardGeometryConstraint,
  type HardNumberConstraint,
  inferAssemblyFamily,
  materialFromColor,
  type UserGeometryConstraints,
  validateAssemblyConstraints,
} from './lib/assembly-constraints'
export { loadAssetUrl, saveAsset } from './lib/asset-storage'
export {
  applyDeviceProfileToPartInput,
  buildDraftDeviceProfile,
  createDeviceProfileResolver,
  DEVICE_PROFILE_DEFINITIONS,
  type DeviceArchetypeFamily,
  type DeviceProfileDefinition,
  type DeviceProfileExecutionValidation,
  type DeviceProfileId,
  type DeviceProfileMergeResult,
  type DeviceProfileQualityInputShape,
  type DeviceProfileQualityScore,
  type DeviceProfileResolver,
  type DeviceProfileSource,
  type DeviceProfileStatus,
  type DeviceProfileValidation,
  type DimensionDefaults,
  type DimensionRule,
  type DraftDeviceProfileResult,
  deviceProfileCapabilitySummary,
  evaluateDeviceProfileQuality,
  getDeviceProfileDefinition,
  inferDeviceProfileDefinition,
  mergeDeviceProfiles,
  normalizeDeviceProfileInput,
  type ProfilePartSpec,
  validateDeviceProfileDefinition,
  validateDeviceProfileForExecution,
  validateDeviceProfileSchema,
  validateDeviceProfiles,
} from './lib/device-profile-registry'
export {
  applyDimensionSemanticsToObjectInput,
  type DimensionSemantics,
  parseDimensionSemantics,
} from './lib/dimension-semantics'
export {
  clampDoorOperationState,
  getDoorRenderOpenAmount,
  getGarageVisibleOpeningRatio,
  isOperationDoorType,
  SECTIONAL_GARAGE_RENDER_OPEN_SCALE,
} from './lib/door-operation'
export {
  executableFamilyForLayoutFamily,
  FAMILY_DEFINITIONS,
  type FamilyDefinition,
  type FamilyId,
  familyCapabilitySummary,
  familyPartDefinitions,
  getFamilyDefinition,
  getLayoutFamilyDefinition,
  inferFamilyDefinition,
  isFamilyId,
  LAYOUT_FAMILY_DEFINITIONS,
  type LayoutFamilyDefinition,
  type LayoutFamilyGroup,
  type LayoutFamilyId,
  layoutFamilyCapabilitySummary,
  normalizeFamilyId,
  normalizeLayoutFamilyId,
} from './lib/family-registry'
export {
  createGeometryGoldenSnapshot,
  type GeometryGoldenShapeSnapshot,
  type GeometryGoldenSnapshot,
  type GeometryGoldenSnapshotOptions,
  stringifyGeometryGoldenSnapshot,
} from './lib/geometry-golden-snapshot'
export {
  composeIndustrialArchetype,
  type IndustrialArchetypeComposeInput,
  industrialArchetypeBrief,
  industrialComposeParams,
  resolveIndustrialArchetypeEntry,
} from './lib/industrial-archetype-compose'
export {
  findIndustrialArchetype,
  findIndustrialArchetypeByRecipeId,
  INDUSTRIAL_ARCHETYPE_ENTRIES,
  type IndustrialArchetypeEntry,
  type IndustrialArchetypeId,
  type IndustrialArchetypeRecipeId,
  type IndustrialVariantId,
  industrialAliasesForRecipe,
} from './lib/industrial-archetype-registry'
export { getDefaultLevelName, getLevelDisplayName } from './lib/level-name'
export {
  composeObjectPrimitives,
  type ObjectComposeCategory,
  type ObjectComposeDetail,
  type ObjectComposeInput,
} from './lib/object-compose'
export {
  angularStep,
  normalizedRadialDirection,
  radialExtrudeRotationInHorizontalPlane,
  radialExtrudeRotationInLocalPlane,
  transformedLocalAxis,
} from './lib/orientation-utils'
export {
  assessPartBlueprint,
  assessPartVisualDetails,
  type BoundingBox,
  composePartPrimitives,
  type LayoutAnchor,
  type LayoutDimensions,
  type LayoutPlan,
  type LayoutProfileInput,
  type PartBlueprintAssessment,
  type PartComposeDetail,
  type PartComposeInput,
  type PartComposeKind,
  type PartComposePartInput,
  type PartPlacement,
  type PartSpec,
  type PartVisualAssessment,
  resolveLayout,
} from './lib/part-compose'
export {
  AIRCRAFT_PART_DEFINITIONS,
  CONVEYOR_PART_DEFINITIONS,
  DESK_PART_DEFINITIONS,
  ELECTRICAL_PART_DEFINITIONS,
  GENERIC_PART_DEFINITIONS,
  getPartDefinitions,
  KIOSK_PART_DEFINITIONS,
  type NormalizedPartPlan,
  normalizeAircraftPartPlan,
  normalizeConveyorPartPlan,
  normalizeDeskPartPlan,
  normalizeElectricalPartPlan,
  normalizeGenericPartPlan,
  normalizeKioskPartPlan,
  normalizePartPlanForFamily,
  normalizePipeSystemPartPlan,
  normalizePumpPartPlan,
  normalizeVehiclePartPlan,
  type PartDefinition,
  type PartParameterDefinition,
  type PartParameterType,
  PIPE_SYSTEM_PART_DEFINITIONS,
  PUMP_PART_DEFINITIONS,
  partCapabilitySummary,
  VEHICLE_PART_DEFINITIONS,
} from './lib/part-registry'
export {
  CORE_COMPONENT_PART_CAPABILITIES,
  type CoreComponentPartCapability,
  coreComponentPartKinds,
  GENERIC_PART_CAPABILITIES,
  type GenericPartCapability,
  type PartCapabilityCategory,
  partCapabilitiesPrompt,
} from './lib/part-taxonomy'
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
  type PrimitiveAnchor,
  type PrimitiveAxis,
  type PrimitiveEditableDimension,
  type PrimitiveEditableHints,
  type PrimitiveGeometryBrief,
  type PrimitiveMaterialInput,
  type PrimitiveShapeInput,
  type PrimitiveShapeKind,
  type ResolvedPrimitiveTransform,
  type ResolveTransformsOptions,
  resolvePrimitiveWorldTransforms,
  type Vec3,
} from './lib/primitive-compose'
export {
  buildPrimitiveGeometryFacts,
  getPrimitiveShapeHalfExtents,
  type PrimitiveGeometryFacts,
  type PrimitiveShapeFact,
} from './lib/primitive-facts'
export {
  type ComposeRecipeInput,
  composeRecipePrimitives,
  findPrimitiveRecipe,
  getPrimitiveRecipeGeometryBrief,
  listPrimitiveRecipes,
  type PrimitiveRecipeDefinition,
  type PrimitiveRecipeId,
  type PrimitiveRecipeParams,
} from './lib/primitive-recipes'
export {
  getPrimitiveDefinition,
  lowerDerivedPrimitiveShape,
  normalizePrimitiveKindFromRegistry,
  PRIMITIVE_DEFINITIONS,
  type PrimitiveDefinition,
  type PrimitiveParameterDefinition,
  type PrimitiveParameterType,
  primitiveCapabilitySummary,
} from './lib/primitive-registry'
export {
  applyPrimitiveRevision,
  type PrimitiveRevisionEdge,
  type PrimitiveRevisionInput,
  type PrimitiveRevisionOperation,
  type PrimitiveRevisionResult,
  type PrimitiveShapeSelector,
  selectPrimitiveShapeIndexes,
} from './lib/primitive-revision'
export {
  type PrimitiveSemanticValidationOptions,
  type PrimitiveSemanticValidationResult,
  validatePrimitiveSemantics,
} from './lib/primitive-semantic-validation'
export {
  assessPrimitiveVisualQuality,
  type PrimitiveVisualQualityFamily,
  type PrimitiveVisualQualityOptions,
  type PrimitiveVisualQualityResult,
} from './lib/primitive-visual-quality'
export {
  INDUSTRIAL_RECIPE_DIMENSIONS,
  type RecipeDimensionSize,
  type RecipeDimensions,
  resolveRecipeDimensions,
  resolveRecipeSizeKey,
} from './lib/recipe-dimensions'
export {
  composeRobotArmPrimitives,
  type RobotArmComposeInput,
  type RobotArmPose,
  type RobotArmStyle,
} from './lib/robot-arm-compose'
export { getRenderableSlabPolygon } from './lib/slab-polygon'
export {
  type AutoSlabSyncPlan,
  detectSpacesForLevel,
  initSpaceDetectionSync,
  isSpaceDetectionPaused,
  pauseSpaceDetection,
  planAutoSlabsForLevel,
  resumeSpaceDetection,
  type Space,
  wallTouchesOthers,
} from './lib/space-detection'
export {
  formatStaticLiveDataValue,
  getStaticLiveDataValue,
  isLiveDataBindingConfig,
  type LiveDataBindingConfig,
  type LiveDataBindingEffect,
  renderLiveDataTemplate,
  resolveBindingColor,
  resolveBindingPositionYOffset,
  resolveBindingPreview,
  resolveBindingRotationYOffset,
  STATIC_LIVE_DATA,
  STATIC_LIVE_DATA_OPTIONS,
  type StaticLiveDataEntry,
  type StaticLiveDataKey,
  type StaticLiveDataValue,
} from './live-data/static-live-data'
export {
  getCatalogMaterialById,
  getLibraryMaterialIdFromRef,
  getMaterialPresetByRef,
  getMaterialSolidColorByRef,
  getMaterialsForCategory,
  LIBRARY_MATERIAL_REF_PREFIX,
  MATERIAL_CATALOG,
  MATERIAL_CATEGORIES,
  type MaterialCatalogItem,
  type MaterialCategory,
  toLibraryMaterialRef,
} from './material-library'
export * from './registry'
export * from './schema'
export * from './services'
export {
  getSceneHistoryPauseDepth,
  pauseSceneHistory,
  resetSceneHistoryPauseDepth,
  resumeSceneHistory,
} from './store/history-control'
export { default as useAlignmentGuides } from './store/use-alignment-guides'
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
  clampPipeRotateDegrees,
  getPipeEndpoint3D,
  getPipeMidpoint3D,
  getPipeRotateRadians,
  isPipeNearlyVertical,
  type PipeCenterlineLike,
  type PipeCenterlinePoint3D,
  samplePipeCenterline3D,
} from './systems/pipe/pipe-centerline'
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
  getPerpendicularWallMoveAxis,
  planWallMoveJunctions,
  type WallMoveAxis,
  type WallMoveBridgePlan,
  type WallMoveJunctionPlan,
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
