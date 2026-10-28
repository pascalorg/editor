export type {
  PointAskPin,
  PointAskStatus,
  PointAskSubmit,
  PointAskSubmitResult,
  PointCamera,
  PointContext,
  PointImage,
  PointTarget,
} from './agent-operations/point-context'
export * from './commands/structure'
export type {
  BlockEvent,
  BoxVentEvent,
  BuildingEvent,
  CabinetEvent,
  CabinetModuleEvent,
  CameraControlEvent,
  CameraControlFitSceneEvent,
  CameraControlFrameEvent,
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
  SnapshotCapturedEvent,
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
export { isCaptureSessionOn, subscribeCaptureSessions } from './events/capture-sessions'
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
export * from './i18n'
export { createAngleAccumulator } from './lib/angle-accumulator'
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
  BEAM_MATERIAL_LABELS,
  BEAM_MATERIAL_LIBRARY_REFS,
  BEAM_TOP_REFERENCE_LABELS,
  BEAM_TOP_REFERENCES,
  type BeamInput,
  type BeamPlan,
  type BeamTopReference,
  beamBottomElevation,
  beamCeilingPlane,
  beamOutline,
  beamPlan,
  beamSizeLabel,
  beamSizePreset,
  beamSizePresetPatch,
  beamsOverPoint,
  beamTopElevation,
  beamTopReferenceOf,
  beamTopReferencePatch,
  createBeam,
  inchFractionLabel,
  type LevelFloorAt,
  levelFloorAt,
  matchBeamSizePreset,
  postStationsAlong,
} from './lib/beam'
export {
  belowGradeFloorY,
  belowGradeFootprints,
  coveredBelowGradeFootprints,
  GROUND_PIT_FLOOR_DROP,
  GROUND_PIT_PLATE_CLEARANCE,
  groundPitFloorY,
} from './lib/below-grade-footprints'
export {
  CEILING_BUILD_UP_PRESETS,
  type CeilingBuildUpPreset,
  ceilingBuildUpThickness,
  ceilingCapLift,
  DEFAULT_FLOOR_BUILD_UP,
  DEFAULT_RAISED_FLOOR_BUILD_UP,
  DRYWALL_THICKNESSES,
  FLOOR_BUILD_UP_PRESETS,
  FLOORING_THICKNESS,
  type FloorBuildUpPreset,
  FRAMING_SPACINGS,
  floorBuildUpMatches,
  floorBuildUpOf,
  floorBuildUpPatch,
  floorBuildUpThickness,
  floorLayerDepths,
  floorStructureDepth,
  I_JOIST_DEPTH,
  LUMBER_DEPTH,
  PANEL_THICKNESSES,
  PLASTER_THICKNESS,
  ROOF_BUILD_UP_PRESETS,
  ROOFING_THICKNESS,
  type RoofBuildUpPreset,
  roofBuildUpDepths,
  roofBuildUpOfDeck,
  roofBuildUpPatch,
  roofStructureDepth,
  SUBFLOOR_THICKNESSES,
  UNDERLAYMENT_THICKNESS,
  WOOD_PLANK_THICKNESS,
} from './lib/build-up'
export {
  footprintOutline,
  levelFootprintLoops,
  levelFrame,
  siteFrame,
  turnPlanPoint,
  yawOf,
} from './lib/building-footprint'
export {
  BUILDING_FOUNDATION_DIMENSIONS,
  BUILDING_FOUNDATION_LIMITS,
  type BuildingFoundation,
  type BuildingFoundationDimension,
  type BuildingFoundationRecord,
  type BuildingFoundationSupport,
  type BuildingFoundationType,
  buildingFoundationDefaults,
  buildingFoundationOf,
  buildingFoundationRecordOf,
  buildingStoreyCount,
  FOUNDATION_SILL_IN,
  ffMinimumIn,
  isBuildingFoundationOn,
  resolveBuildingFoundation,
  SLAB_EDGE_TAPER_IN,
  slabEdgeTaper,
} from './lib/building-foundation'
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
export { cornerPair, fusesAtCorner } from './lib/corner-pair'
export {
  type CornerBlock,
  type CornerBlockReason,
  type CornerSnap,
  evaluateCorner,
} from './lib/corner-snap'
export { criticallyDamped } from './lib/critically-damped'
export { isCutterName, resolveCutterHost } from './lib/cutter-host'
export {
  DECK_BOARD_DIRECTIONS,
  DECK_BOARD_GAPS,
  DECK_BOARD_JOINT_GAP,
  DECK_BOARD_MAX_LENGTH,
  DECK_BOARD_SIZES,
  DECK_BOARD_STOCK,
  DEFAULT_DECK_BOARDS,
  type DeckBoardAxes,
  type DeckBoardDirection,
  type DeckBoardJoists,
  type DeckBoardRun,
  type DeckBoardSettings,
  type DeckBoardSize,
  type DeckBoardStock,
  deckBoardRun,
  deckBoardSettings,
  deckBoardThickness,
  deckJoistSpacingLimit,
  deckSlabBoards,
  layoutDeckBoards,
} from './lib/deck-boards'
export {
  DECK_BEAM_INSET,
  DECK_BOARD_OVERHANG,
  DECK_DROPPED_BEAM,
  DECK_JOIST_SPANS,
  DECK_MIN_POST_HEIGHT,
  DECK_POST,
  DECK_POST_END_INSET,
  DECK_POST_SPACING,
  type DeckAxes,
  type DeckBeamKind,
  type DeckBeamPiece,
  type DeckFramingInput,
  type DeckFramingPlan,
  type DeckHanger,
  type DeckJoistPiece,
  type DeckJoistSpan,
  type DeckLumber,
  type DeckPiece,
  type DeckPieceRole,
  type DeckPostPiece,
  type DeckWall,
  deckAxes,
  deckLedgerEdge,
  isDeckSlab,
  planDeckFraming,
} from './lib/deck-framing'
export { deepestDrawnY, lowestGroundY } from './lib/deepest-drawn'
export {
  type BasementReport,
  type DesignedFoundationReport,
  type FoundationOutline,
  type FoundationRimStep,
  foundationOutlines,
  SLAB_ROOM_CURB,
} from './lib/designed-foundation'
export {
  clampDoorOperationState,
  getDoorRenderOpenAmount,
  getGarageVisibleOpeningRatio,
  isOperationDoorType,
  SECTIONAL_GARAGE_RENDER_OPEN_SCALE,
} from './lib/door-operation'
export {
  type FinishScriptHost,
  type FinishScriptInputs,
  type FinishScriptRefresh,
  type FinishScriptTarget,
  finishScriptWrites,
  refreshFinishScripts,
  type StaleFinishScript,
  staleFinishScripts,
} from './lib/finish-script'
export { floorConstructionLift, liftedManualSlab } from './lib/floor-construction-lift'
export {
  type FloorFootprintNaming,
  floorFootprintName,
  floorFootprintNaming,
} from './lib/floor-footprint-name'
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
export {
  type FloorPlatePaintRefusal,
  floorPlatePaintRefusal,
  floorScriptPaintRefusal,
  slabSurfaceScriptPaintRefusal,
} from './lib/floor-plate-paint'
export {
  FLOOR_SCRIPT_LIFT,
  type FloorScriptInputs,
  floorScriptInputs,
  floorScriptInputsKey,
  floorScriptRecord,
  floorScriptSurface,
  slabScriptSurface,
  slabSurfaceScriptInputs,
} from './lib/floor-script'
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
  FOOTING_MINIMUM,
  type FootingDesign,
  type FootingPlan,
  footingDesign,
  footingLevelOf,
  footingMembers,
  footingOutline,
  footingPlan,
} from './lib/footing'
export {
  FOUNDATION_CONSTRUCTIONS,
  type FoundationConstruction,
  type FoundationConstructionId,
  type FoundationReading,
  type FoundationRegionId,
  foundationReadingOf,
  foundationRegionOf,
} from './lib/foundation-construction'
export {
  FOUNDATION_GRADING,
  finishedGradeAt,
  type GradingPad,
  gradedTerrainFieldOf,
  gradeTerrainField,
  isExcavation,
} from './lib/foundation-grading'
export { FOUNDATION_STANDARD } from './lib/foundation-standard'
export {
  buildingFoundationMembers,
  buildingFoundationNodes,
  type FoundationBadge,
  type FoundationPlanShape,
  type FoundationView,
  foundationBadge,
  foundationPlan,
  foundationViewHiddenIds,
  foundationViewOf,
  traceFoundationOutlines,
} from './lib/foundation-view'
export {
  createFramingPost,
  DEFAULT_FRAMING_POST_SIZE,
  FRAMING_POST_BASE_LABELS,
  FRAMING_POST_MATERIAL_REF,
  FRAMING_POST_MAX_HEIGHT,
  FRAMING_POST_MIN_HEIGHT,
  FRAMING_POST_SIZES,
  type FramingPostInput,
  type FramingPostSize,
  type FramingPostTop,
  framingPostBasePatch,
  framingPostFields,
  framingPostHeightLimit,
  framingPostSize,
  framingPostTopAt,
  isFramingPost,
} from './lib/framing-post'
export {
  designedFoundationReport,
  type FoundationMember,
  foundationGradingPads,
  foundationRimBottom,
  foundationRimBottoms,
  foundationRimSteps,
  foundationSharedStemTops,
  genericFoundation,
  isHouseOutline,
} from './lib/generic-foundation'
export {
  ceilingSeatY,
  isScriptedNode,
  matchScriptSlotsToLibrary,
  type ScriptedNode,
  scriptedObjectMeta,
  scriptedOrigin,
  scriptedSize,
  scriptImages,
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
export { type LevelGradeStanding, levelGradeStanding } from './lib/grade-standing'
export { type GroundLevel, groundLevelOf, levelUnderNamedGround } from './lib/ground-level'
export {
  GROUND_FLOOR_ABOVE_GRADE,
  GROUND_SEAT_TOLERANCE,
  type GroundSeat,
  type GroundSeatRule,
  gradeUnderLevel,
  groundSeat,
} from './lib/ground-seat'
export {
  buildingGroundBox,
  type GroundBox,
  levelGroundBox,
  levelStackGroundBox,
  terrainBetweenEyeAndBox,
} from './lib/ground-window'
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
export { newZone } from './lib/new-zone'
export { HIDDEN_SITE_NOTE, hidesDescendants } from './lib/node-visibility'
export {
  cutterContextNodes,
  getEffectiveCutterNode,
  hostedCutterHoles,
  withHostedCutterHoles,
} from './lib/object-cuts'
export {
  DEFAULT_OPENING_CASING_WIDTH,
  OPENING_CASING_PROUD,
  type OpeningCasingBoard,
  type OpeningCasingFace,
  type OpeningCasingHost,
  openingCasingBoards,
  openingCasingFaces,
  openingCasingWidth,
  openingHostFacing,
  resolveOpeningCasingHost,
} from './lib/opening-casing'
export {
  getOpeningFloorDatum,
  getOpeningWallCut,
  getOpeningWallPlacement,
  openingDatumFromSupport,
  wallSupportForNodes,
} from './lib/opening-floor-datum'
export {
  isAutoFrameDepth,
  OPENING_FRAME_LIP,
  resolveHostedOpeningFrameDepth,
  resolveOpeningFrameDepth,
} from './lib/opening-frame-depth'
export {
  DECK_FLOOR_DROP,
  DECKING_THICKNESS,
  isOutdoorRoom,
  isOutdoorRoomType,
  nextOutdoorRoomName,
  OUTDOOR_ROOM_DEFAULTS,
  OUTDOOR_ROOM_TYPES,
  type OutdoorRoomDefaults,
  type OutdoorRoomType,
  PORCH_FLOOR_DROP,
} from './lib/outdoor-room'
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
  hasPointAskHandler,
  type PointAskHandler,
  registerPointAskHandler,
  submitPointAsk,
  useHasPointAskHandler,
} from './lib/point-ask'
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
  DEFAULT_PORCH_FRAMING,
  PORCH_POST_SETBACK,
  PORCH_POST_SPACING,
  type PorchBeamPlan,
  type PorchFramingPlan,
  type PorchFramingSettings,
  type PorchPostPlan,
  planPorchFraming,
  porchFramingSettings,
} from './lib/porch-framing'
export { type PorchPartMetadata, porchPartOf } from './lib/porch-framing-sync'
export {
  type EavePoint,
  eaveContains,
  FASCIA_DROP,
  FASCIA_STOCK,
  FASCIA_THICKNESS,
  type FasciaStock,
  fasciaStockFor,
  LEVEL_CUT_RUN,
  type RoofEaveInput,
  type RoofEaveProfile,
  roofEaveProfile,
  roofSegmentEaveInput,
  roofSegmentEaveProfile,
  SOFFIT_THICKNESS,
} from './lib/roof-eave'
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
export type { OpenWallEnd } from './lib/room-graph'
export { isAllocatedRoomName } from './lib/room-name'
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
  castYardDimensionsOriented,
  classifyEdges,
  type EdgeRole,
  edgeHeadingDeg,
  edgeLength,
  envelopeFrontEdge,
  insetPolygon,
  type KeepOut,
  mostNorthFacingEdge,
  outwardNormal,
  rayToPolygon,
  resolveFrontEdge,
  type SetbackInputs,
  setbackEnvelope,
  setbackForRole,
  sightTriangle,
  streetCorners,
  type YardDimension,
  type YardSide,
} from './lib/setback-envelope'
export { FLAT_GROUND_Y, groundHeightAt } from './lib/site-ground-height'
export {
  type BuildableArea,
  type BuildingPlacement,
  buildingFootprintRings,
  buildingStreet,
  describeSiteBrief,
  lotOverhang,
  measureFootprint,
  type PlaceBuildingInput,
  type PlacementRefusal,
  type PlanBounds,
  type PlanSide,
  placeBuildingPose,
  resolveSiteBuilding,
  roundedSiteBrief,
  type SiteBrief,
  type SiteFootprint,
  siteBrief,
  siteFrontEdge,
  siteSetbackEnvelope,
  type YardKey,
} from './lib/site-placement'
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
  doorSillFloorOf,
  isGarageName,
  roomFoundationOf,
  slabRoomElevation,
} from './lib/slab-room'
export {
  deriveSlotId,
  isSlotMaterialName,
  SLOT_MATERIAL_PREFIX,
  slotDefaultPaintMaterial,
  slotLabelFromId,
  slotPaintMaterial,
} from './lib/slots'
export { createSnapEaser, prefersReducedMotion } from './lib/snap-ease'
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
  type WallFacePaintRefusal,
  type WallFaceRect,
  type WallFaceScriptInputs,
  wallFaceBaseOffset,
  wallFaceScriptInputs,
  wallFaceScriptInputsKey,
  wallFaceScriptPaintRefusal,
  wallFaceScriptPlacement,
  wallFaceScriptRecord,
  wallFaceScriptSkirtingGap,
} from './lib/wall-face-script'
export { ZONE_COLOR_PALETTE, zoneColorForSeed } from './lib/zone-colors'
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
  getMaterialSwatch,
  getMaterialsForCategory,
  getSceneMaterialIdFromRef,
  isCommunityMaterialId,
  LIBRARY_MATERIAL_REF_PREFIX,
  MATERIAL_CATALOG,
  MATERIAL_CATEGORIES,
  MATERIAL_SURFACES,
  type MaterialCatalogItem,
  type MaterialCategory,
  type MaterialRef,
  type MaterialSource,
  type MaterialSurface,
  type MaterialSwatch,
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
export { matchPascalMaterial, type PascalMaterialHints } from './procedural-items/library-colors'
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
export * from './schema/nodes/stair-defaults'
export * from './services'
export { isMovable, movePlanToward, moveToward, resolveMovable } from './services/movement'
export * from './services/project-file-sink'
export {
  collectionIdsOf,
  getPendingNodeUpdateCount,
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
  filterDerivedNodeWrites,
  isDerivedNode,
} from './store/derived-node-guard'
export {
  acquireSceneCommitAuthor,
  acquireSceneHistoryPause,
  activeSceneCommitNodeIds,
  beginSceneHistoryPauseSession,
  getSceneHistoryPauseDepth,
  isApplyingRemoteSceneChange,
  isRestoringSceneHistory,
  pauseSceneHistory,
  resetSceneHistoryPauseDepth,
  resumeSceneHistory,
  runAsSceneCommitAuthor,
  runAsSingleSceneHistoryStep,
  type SceneCommit,
  type SceneCommitAuthor,
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
  readSceneNodeField,
  SCENE_IMAGE_FIELD,
  withoutSceneNodeAnnotations,
  withSceneNodeBuildImages,
  writeSceneNodeField,
} from './store/scene-annotations'
export {
  beginScenePreview,
  endScenePreview,
  isScenePreviewing,
  type ScenePreview,
  subscribeScenePreview,
} from './store/scene-preview'
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
  getSceneDocument,
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
export { authorStairOpeningPatches, planOwnedFloorOpenings } from './systems/owned-floor-openings'
export { resolveRoofElevation, resolveRoofWallTopElevation } from './systems/roof/roof-elevation'
export { RoofElevationSystem } from './systems/roof/roof-elevation-system'
export {
  fitRoofFootprint,
  outdoorRoomRoofOutline,
  type RoofFootprintTarget,
  type RoofOutlineEdge,
  resolveOutdoorRoomRoofFootprintOnLevel,
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
export { stairBaseElevation } from './systems/stair/stair-base-elevation'
export {
  measureStairHeadroom,
  resolveStairWalkingSurfaces,
  type StairBodySurface,
  type StairWalkingSurface,
  stairClearanceOpening,
} from './systems/stair/stair-clearance'
export {
  resolveArcStairConstruction,
  resolveStairConstruction,
  resolveStraightStairConstruction,
  type StairArcConstructionPiece,
  type StairConstructionPiece,
  stairArcSliceCount,
  stairConstructionError,
  stairSegmentConstructionError,
} from './systems/stair/stair-construction'
export {
  measureStairDetail,
  STAIR_DETAIL_SURFACE_BUDGET,
  stairSegmentDetailError,
} from './systems/stair/stair-detail-budget'
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
  rotateXZ,
  type StairFootprintAABB,
  stairDeckLevelId,
  stairFootprintAABB,
} from './systems/stair/stair-footprint'
export {
  resolveStairArcDimensions,
  resolveStairArcLayout,
  type StairArcStep,
} from './systems/stair/stair-layout'
export { createSurfaceOpeningPreviewController } from './systems/stair/stair-opening-preview'
export {
  changedStairOpeningOwners,
  syncAutoStairOpenings,
} from './systems/stair/stair-opening-sync'
export { StairOpeningSystem } from './systems/stair/stair-opening-system'
export {
  planStairPreset,
  proposeStairLayouts,
  type StairLayoutPreset,
  type StairPresetOptions,
} from './systems/stair/stair-presets'
export {
  resolveStairHandrailPaths,
  resolveStairRailPaths,
  resolveStairWalkInside,
  type StairRailPath,
} from './systems/stair/stair-rail-path'
export { resolveStairTotalRise, syncStairRises } from './systems/stair/stair-rise'
export { planStairFlightHeightEdit, planStairRiseEdit } from './systems/stair/stair-rise-edit'
export {
  stairClimbsToNoStorey,
  stairHasNoRise,
  stairReachesStoreyAbove,
} from './systems/stair/stair-rise-query'
export {
  createSizedStairFlight,
  DEFAULT_STAIR_DESIGN_TARGETS,
  measureStair,
  planStairCreation,
  planStairSizing,
  planStairSizingEdit,
  type StairDiagnostic,
} from './systems/stair/stair-sizing'
export {
  autoStairStringerCount,
  DEFAULT_STAIR_NOSING,
  formatStairInches,
  inferStairStructure,
  type ResolvedStairConstruction,
  type ResolvedStairStructure,
  resolveStairStringerLayout,
  resolveStairStructure,
  STAIR_CODE,
  STAIR_HOUSING_DEPTH,
  STAIR_LANDING_JOIST,
  STAIR_LANDING_JOIST_SPACING,
  STAIR_LANDING_POST,
  STAIR_RISER_THICKNESS,
  STAIR_STEEL_STRINGER,
  STAIR_STRINGER_STOCK,
  STAIR_TREAD_STOCK,
  type StairFrameBox,
  type StairStringerBand,
  type StairStringerCut,
  type StairStringerFlight,
  type StairStringerLayout,
  type StairStringerSlice,
  type StairStructureHost,
  type StairStructureIssue,
  stairIsExterior,
  stairLandingFrame,
  stairStringerCut,
  stairStringerEdges,
  stairStringerFlight,
  stairStringerSlices,
  stairStructureConstruction,
  stairStructureConstructionOf,
  stairStructureDiagnostics,
} from './systems/stair/stair-structure'
export { planStairSweepEdit } from './systems/stair/stair-sweep-edit'
export {
  resolveStairWalkingPaths,
  type StairWalkingPoint,
} from './systems/stair/stair-walking-line'
export {
  resolveStairWinder,
  resolveStairWinderFootprint,
  resolveWinderStairConstruction,
  type StairWinderConstructionPiece,
  type StairWinderLayout,
  type StairWinderPoint,
} from './systems/stair/stair-winder'
export {
  assemblyLayerSlotKey,
  assemblyThickness,
  BRICK_AIR_SPACE,
  BRICK_VENEER,
  CMU_8_ACTUAL,
  calculateLevelLayerMiters,
  type ExposedStructure,
  FIBER_CEMENT,
  FURRING_1X,
  GYPSUM_FIVE_EIGHTHS,
  GYPSUM_HALF,
  GYPSUM_SHEATHING,
  getWallAssemblyPreset,
  getWallLayerPolylines,
  isExteriorWallAssembly,
  isLegacyWallAssembly,
  isWallCladdingProduct,
  LGS_STUD_350,
  LGS_STUD_550,
  LGS_STUD_800,
  parseWallTypes,
  projectWallTypes,
  type ResolvedWallAssembly,
  resolveWallAssembly,
  resolveWallExteriorSide,
  SIDING_LAP,
  STONE_VENEER_UNVERIFIED,
  STUCCO_3_COAT,
  STUD_2X4,
  STUD_2X6,
  STUD_2X8,
  STUD_SPACING_16,
  STUD_SPACING_24,
  WALL_ASSEMBLY_PRESETS,
  WALL_FINISH_LIBRARY_REF,
  WALL_TYPE_CORES,
  type WallAssemblyLayer,
  type WallAssemblyLayerRole,
  type WallAssemblyPreset,
  type WallLayerMiterData,
  type WallLayerPolyline,
  type WallTypeCore,
  WSP_SHEATHING,
  wallAssemblyCladding,
  wallAssemblyExposedStructure,
  wallAssemblyExteriorFinish,
  wallAssemblyFaceFinish,
  wallAssemblyFinishRef,
  wallAssemblyFinishSlots,
  wallAssemblyFraming,
  wallAssemblyFromLegacy,
  wallAssemblyPatch,
  wallAssemblyToLegacy,
  wallAssemblyUnverifiedNote,
  wallCladdingProducts,
  wallLayerBoundaryOffsets,
  wallPaintProducts,
  wallTypeAssembly,
  wallTypeCoreOf,
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
  planAttachedWallUpdates,
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
export { plannedWallIds, planWallPaint } from './systems/wall/wall-paint-plan'
export { roomSideFaces } from './systems/wall/wall-room-sides'
export { wallDoorStepRuns } from './systems/wall/wall-step-openings'
export {
  MIN_WALL_HEIGHT,
  resolveWallEffectiveHeight,
  resolveWallTop,
  wallFollowsStorey,
} from './systems/wall/wall-top'
export {
  type DrawnWallTypes,
  findOpenWallEnds,
  planJoinOpenWallEnd,
  planSeparatorInsertion,
  planWallEndRejoins,
  planWallInsertion,
  planWallSplitAtPoint,
  type WallInsertionPlan,
  type WallJoinResult,
  type WallTopologyChanges,
} from './systems/wall/wall-topology'
export { wallTrimPatch } from './systems/wall/wall-trim'
export type { SceneGraph } from './utils/clone-scene-graph'
export { cloneLevelSubtree, cloneSceneGraph, forkSceneGraph } from './utils/clone-scene-graph'
export { areSemanticValuesEqual } from './utils/semantic-equal'
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
