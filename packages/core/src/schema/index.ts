// Base

export { ProceduralItemNode } from '../procedural-items/node'
export {
  SOLAR_PANEL_PRESET_LABELS,
  SOLAR_PANEL_PRESETS,
  type SolarPanelPresetDims,
  SolarPanelPresetKey,
} from '../solar-panel-presets'
// Assembly layers (F2)
export { Assembly, AssemblyLayer, AssemblyLayerId, LayerRole } from './assembly'
// Asset URL allowlist
export {
  __resetAllowedOriginsCacheForTests,
  ALLOWED_ORIGINS_ENV,
  ALLOWED_SCHEMES,
  type AllowedOriginIssue,
  AssetUrl,
  allowedOriginsFrom,
  parseAllowedOrigins,
} from './asset-url'
export { BaseNode, generateId, Material, nodeType, objectId } from './base'
// Roof-plane and ceiling layer build-ups
export {
  CeilingBuildUp,
  CeilingFraming,
  InsulationKind,
  InsulationLayer,
  InteriorFinishKind,
  InteriorFinishLayer,
  NominalLumber,
  PanelKind,
  PanelLayer,
  RoofBuildUp,
  RoofingKind,
  RoofingLayer,
  RoofStructure,
  UnderlaymentKind,
  UnderlaymentLayer,
} from './build-up'
// Camera
export { CameraSchema } from './camera'
// Collections
export {
  COLLECTION_TEMPLATE_IDS,
  COLLECTION_TEMPLATES,
  type CollectionTemplateId,
} from './collection-templates'
export { type Collection, type CollectionId, generateCollectionId } from './collections'
// Compiled per-kind parsers (opt-in)
export {
  compiledNodeParsersEnabled,
  enableCompiledNodeParsers,
  parseNode,
} from './compiled-node-parsers'
// Cut intents (F5b)
export { CutIntent, CutShape } from './cut'
export {
  GeometryArtifactMetadata,
  GeometryReuseFields,
  GeometrySourceMeta,
} from './geometry-metadata'
export {
  type CompiledGeometryScript,
  GEOMETRY_MANIFEST_MAX_BYTES,
  GEOMETRY_SCRIPT_MAX_BYTES,
  GEOMETRY_SCRIPT_MIME_TYPES,
  GeometryArtifactManifest,
  GeometryScriptLanguage,
  GeometryScriptMount,
  GeometryScriptParamSpec,
  GeometryScriptParamValue,
  GeometryScriptSource,
  isGeometryScriptMimeType,
  LightGlow,
  LightSpot,
} from './geometry-source'
export type {
  MaterialMapProperties,
  MaterialMaps,
  MaterialPresetPayload,
  MaterialTarget as MaterialTargetValue,
  TextureWrapMode as TextureWrapModeValue,
} from './material'
// Material
export {
  DEFAULT_MATERIALS,
  MaterialMapPropertiesSchema,
  MaterialMapsSchema,
  MaterialPreset,
  MaterialPresetPayloadSchema,
  MaterialProperties,
  MaterialSchema,
  MaterialTarget,
  resolveMaterial,
  TextureWrapMode,
} from './material'
export {
  type AutoDownspoutPlacement,
  type AutomaticDownspoutInput,
  planAutomaticDownspouts,
  resolveAutomaticDownspoutLength,
} from './nodes/automatic-downspout'
export {
  BEAM_SIZE_PRESETS,
  BeamMaterial,
  BeamNode,
  BeamPlacement,
  type BeamSizePreset,
  type BeamSizePresetId,
  DEFAULT_BEAM_SIZE_PRESET_ID,
} from './nodes/beam'
export {
  BlockEdge,
  BlockFace,
  type BlockFaceFrame,
  BlockNode,
  BlockTopology,
  type BlockTopologyIssue,
  BlockVertex,
  blockUndirectedEdgeKey,
  createBoxBlockTopology,
  getBlockFaceCentroid,
  getBlockFaceFrame,
  getBlockFaceNormal,
  inspectBlockTopology,
} from './nodes/block'
export { BoxVentMaterialRole, BoxVentNode } from './nodes/box-vent'
export { BuildingNode } from './nodes/building'
export {
  CABINET_METRIC_DEFAULTS,
  CabinetFrontStyleSchema,
  CabinetModuleNode,
  CabinetNode,
  CabinetTopFinishSchema,
} from './nodes/cabinet'
export { CeilingNode } from './nodes/ceiling'
export { ChimneyMaterialRole, ChimneyNode } from './nodes/chimney'
export {
  COLUMN_PRESETS,
  ColumnBaseStyle,
  ColumnCapitalStyle,
  ColumnCarvingPlacement,
  ColumnCrossSection,
  ColumnNode,
  ColumnPanelShape,
  ColumnPostBase,
  type ColumnPresetId,
  ColumnRingPlacement,
  ColumnShaftDetail,
  ColumnShaftProfile,
  ColumnStyle,
  ColumnSupportStyle,
} from './nodes/column'
export {
  CONSTRUCTION_DRAWING_TYPES,
  ConstructionDimensionBaseline,
  ConstructionDimensionChainMode,
  ConstructionDimensionDatumPolicy,
  ConstructionDimensionDrawingOverride,
  ConstructionDimensionDrawingPresentation,
  ConstructionDimensionImperialPrecision,
  ConstructionDimensionMetricNotation,
  ConstructionDimensionMode,
  ConstructionDimensionNode,
  ConstructionDimensionTerminator,
  ConstructionDimensionTextPosition,
  ConstructionDrawingType,
  constructionDimensionRequiredAnchorCount,
  resolveConstructionDimensionDrawingOverride,
  resolveConstructionDimensionDrawingPresentation,
  setConstructionDimensionDrawingPresentation,
  setConstructionDimensionDrawingSuppressedSegments,
} from './nodes/construction-dimension'
export { CupolaMaterialRole, CupolaNode } from './nodes/cupola'
export {
  CurtainGrid,
  CurtainPanelType,
  CurtainWallConfig,
  curtainGridPositions,
  DEFAULT_CURTAIN_WALL,
  getCurtainWallConfig,
} from './nodes/curtain-wall'
export {
  DoorNode,
  DoorSegment,
  FRENCH_DOOR_SEGMENTS,
  OpeningConstructionType,
  OpeningDimensionReference,
} from './nodes/door'
export {
  createDormerDefaultWindow,
  DormerNode,
  type DormerSurfaceMaterialRole,
  type DormerSurfaceMaterialSpec,
  DormerWallFace,
  dormerPointToWallFace,
  dormerWallFacePointToDormer,
  getDormerDefaultWindowFace,
  getDormerExposedFaces,
  getDormerWallFaceFrame,
  getDormerWallHorizontalBoundsAtHeight,
  getDormerWallOpeningVerticalBounds,
  getDormerWallVerticalBounds,
  getEffectiveDormerSurfaceMaterial,
} from './nodes/dormer'
export {
  DownspoutNode,
  defaultDownspoutMetadata,
  isDefaultDownspoutNode,
  usesAutomaticDownspoutLength,
} from './nodes/downspout'
export { DuctFittingNode } from './nodes/duct-fitting'
export { DuctSegmentNode } from './nodes/duct-segment'
export { DuctTerminalNode } from './nodes/duct-terminal'
export {
  ElevatorDoorPanelStyle,
  ElevatorDoorStyle,
  ElevatorNode,
  ElevatorShaftStyle,
} from './nodes/elevator'
export { EyebrowVentMaterialRole, EyebrowVentNode } from './nodes/eyebrow-vent'
export {
  clampFencePicketRailProjection,
  FenceBaseStyle,
  FenceGuardInfill,
  FenceNode,
  FenceStyle,
  maxFencePicketRailProjection,
} from './nodes/fence'
export { type FenceFeatureNode, FenceGateNode, FenceOpeningNode } from './nodes/fence-feature'
export { FloorOpeningNode } from './nodes/floor-opening'
export { GuideNode, GuideScaleReference } from './nodes/guide'
export {
  computeGutterEaveY,
  createDefaultGuttersForSegment,
  GUTTER_EAVE_TUCK_INWARD,
  GUTTER_EAVE_TUCK_UP,
  type GutterEaveSide,
  type GutterEdgeExclusion,
  GutterNode,
  GutterOutlet,
  type GutterRun,
  getDefaultGutterSide,
  getGutterRunsForSegment,
  hasAutoGutterMetadata,
  isAutoGutterEnabled,
  isDefaultGutterNode,
} from './nodes/gutter'
export { HvacEquipmentNode } from './nodes/hvac-equipment'
export {
  ImportedMeshNode,
  ImportedMeshPrimitive,
  type ImportedMeshPrimitive as ImportedMeshPrimitiveValue,
} from './nodes/imported-mesh'
export type {
  AnimationEffect,
  Asset,
  AssetInput,
  Control,
  Effect,
  Interactive,
  LightEffect,
  SliderControl,
  TemperatureControl,
  ToggleControl,
} from './nodes/item'
export {
  getScaledDimensions,
  ItemNode,
  isLowProfileItemSurface,
  LOW_PROFILE_ITEM_SURFACE_MAX_HEIGHT,
} from './nodes/item'
export {
  LeanToCanopyForm,
  LeanToConnectionMode,
  LeanToEndCondition,
  LeanToExtensionNode,
  LeanToResizeLock,
  LeanToRoofEdge,
} from './nodes/lean-to-extension'
export { LevelNode } from './nodes/level'
export { LinesetNode } from './nodes/lineset'
export { LiquidLineNode } from './nodes/liquid-line'
export {
  AngleMeasurement,
  AreaMeasurement,
  DistanceMeasurement,
  MeasurementAnchor,
  MeasurementFeatureAnchor,
  MeasurementFeatureParameter,
  MeasurementFeatureReference,
  MeasurementNode,
  MeasurementPayload,
  MeasurementPoint,
  PerimeterMeasurement,
  VolumeMeasurement,
} from './nodes/measurement'
export { PipeFittingNode } from './nodes/pipe-fitting'
export { PipeSegmentNode } from './nodes/pipe-segment'
export { PipeTrapNode } from './nodes/pipe-trap'
export {
  DEFAULT_RAILING_WALL,
  getRailingWallConfig,
  getRailingWallHeight,
  isRailingWall,
  RAILING_GUARD_HEIGHT,
  RAILING_GUARD_HEIGHT_TALL,
  RAILING_MAX_POST_SPACING,
  RAILING_SPHERE_LIMIT,
  RAILING_STYLE_DEFAULTS,
  RailingWallConfig,
  type RailingWallPatch,
  type RailingWallSlotId,
  RailingWallStyle,
  railingOpeningFields,
  railingWallDefaults,
  railingWallSlotDefault,
} from './nodes/railing-wall'
// Nodes
export {
  createDefaultRidgeVentsForSegment,
  getRidgeVentLinesForSegment,
  hasAutoRidgeVentMetadata,
  isAutoRidgeVentEnabled,
  isDefaultRidgeVentNode,
  type RidgeVentLine,
  RidgeVentNode,
} from './nodes/ridge-vent'
export type { RoofSupport, RoofSurfaceMaterialRole, RoofSurfaceMaterialSpec } from './nodes/roof'
export { getEffectiveRoofSurfaceMaterial, RoofNode } from './nodes/roof'
export {
  clipGlazedRoofPolygon,
  DEFAULT_ROOF_GLAZING,
  type GlazedRoofFace,
  type GlazedRoofLayout,
  type GlazedRoofPiece,
  type GlazedRoofPoint,
  getBarrelRoofFaces,
  getBarrelRoofSolidPieces,
  getGlazedRoofFaces,
  getGlazedRoofLayout,
  getGlazedRoofPanelType,
  getGlazedRoofPieceFaces,
  getGlazedRoofPieces,
  getGlazedRoofPlanLines,
  getRoofGlazing,
  glazedRoofFacePoint,
  glazedRoofSupportsPoint,
  insetGlazedRoofPolygon,
  isGlazedRoofSegment,
  isIndependentRoofSegment,
  RoofGlazing,
  RoofSystemType,
  supportsRoofGlazing,
} from './nodes/roof-glazing'
export type {
  DutchRoofMetrics,
  RoofSegmentSurfaceMaterialRole,
  RoofSegmentSurfaceMaterialSpec,
  RoofSegmentVisibleTopBounds,
  RoofWallBand,
  SegmentSlopeFrame,
} from './nodes/roof-segment'
export {
  getActiveRoofHeight,
  getConicalRoofCoverage,
  getDutchRoofMetrics,
  getEffectiveSegmentSurfaceMaterial,
  getPitchFromActiveRoofHeight,
  getRoofSegmentDeckReach,
  getRoofSegmentEndReach,
  getRoofSegmentSurfaceY,
  getRoofSegmentVisibleTopBounds,
  getRoofWallBandMaterial,
  getSegmentFasciaMaterial,
  getSegmentSlopeFrame,
  hasSegmentMaterialOverride,
  isBandedShedSegment,
  MIN_ROOF_SEGMENT_TRIM_SPAN,
  normalizeRoofSegmentTrim,
  ROOF_SHAPE_DEFAULTS,
  ROOF_WALL_BANDS,
  RoofEaveCut,
  RoofSegmentNode,
  RoofSegmentTrim,
  RoofType,
  roofTypeHasRakes,
  roofWallBandFields,
} from './nodes/roof-segment'
export { getRoofSegmentResizePatch } from './nodes/roof-segment-resize'
export type {
  DutchRoofShapeMetrics,
  RoofShapeEaveSide,
  RoofShapeFaceVertex,
  RoofShapeInsets,
  RoofShapeRatios,
} from './nodes/roof-segment-shape'
export {
  getDutchEndSlopeFaces,
  getDutchRoofShapeMetrics,
  getRoofModuleFaces,
  getRoofShapeEaveOverhang,
  getRoofShapeEaveSides,
  getRoofShapeInsets,
  getRoofShapeRatios,
} from './nodes/roof-segment-shape'
export type { RoofSegmentWallFace, RoofWallFaceId } from './nodes/roof-segment-walls'
export {
  clampRectToRoofWallFace,
  getMaxRoofRectHeightFromAnchor,
  getMaxRoofRectWidthFromAnchor,
  getRoofSegmentWallFace,
  getRoofSegmentWallFaces,
  getRoofWallFaceFrame,
  roofFacePointToSegment,
  segmentPointToRoofWallFace,
} from './nodes/roof-segment-walls'
export {
  CaptureSessionReference,
  type CaptureSessionReferenceInput,
  ScanNode,
} from './nodes/scan'
export { SeparatorNode } from './nodes/separator'
export { ShelfNode } from './nodes/shelf'
export { SiteDossier, SiteNode } from './nodes/site'
export {
  migrateSiteMetadata,
  SiteAddress,
  type SiteMetadataPatch,
  SiteParcel,
  SiteSetbacks,
} from './nodes/site-facts'
export {
  SKYLIGHT_TYPE_ORDER,
  SKYLIGHT_TYPE_PRESETS,
  SkylightMaterialRole,
  SkylightNode,
  SkylightOpeningSide,
  SkylightSlideDirection,
  SkylightType,
  type SkylightTypePreset,
} from './nodes/skylight'
export { MIN_GROUND_FLOOR_THICKNESS, MIN_SLAB_THICKNESS, SlabNode } from './nodes/slab'
export {
  SolarPanelMaterialRole,
  SolarPanelNode,
} from './nodes/solar-panel'
export { SpawnNode } from './nodes/spawn'
export type { StairSurfaceMaterialRole, StairSurfaceMaterialSpec } from './nodes/stair'
export {
  getEffectiveStairSurfaceMaterial,
  StairDesignTargets,
  StairNode,
  StairRailingMode,
  StairRailingStyle,
  StairSlabOpeningMode,
  StairTopLandingMode,
  StairType,
} from './nodes/stair'
export { StairConstruction } from './nodes/stair-construction'
export { AttachmentSide, StairSegmentNode, StairSegmentType } from './nodes/stair-segment'
export {
  STAIR_STRINGER_SPACINGS_IN,
  StairStringerStock,
  StairStringerType,
  StairStructure,
  StairStructureType,
  StairTreadStock,
} from './nodes/stair-structure'
export { StructuralGridNode } from './nodes/structural-grid'
export { SurfaceHoleMetadata } from './nodes/surface-hole-metadata'
export { SurfacePaintRegion } from './nodes/surface-paint-region'
export { TurbineVentMaterialRole, TurbineVentNode } from './nodes/turbine-vent'
export { DEFAULT_UNIT_COLOR, UNIT_KINDS, type UnitKind, UnitNode } from './nodes/unit'
export type {
  WallFace,
  WallSurfaceMaterialSpec,
  WallSurfaceSide,
  WallSurfaceSlotId,
  WallTrimConfig,
  WallTrimKind,
  WallTrimSlotId,
} from './nodes/wall'
export {
  DEFAULT_EXTERIOR_WALL_FINISH,
  DEFAULT_INTERIOR_WALL_PAINT,
  getEffectiveWallFaceMaterial,
  getEffectiveWallSurfaceMaterial,
  getWallFaceDefault,
  getWallSurfaceMaterialSignature,
  getWallTrimFaces,
  getWallTrimSlotId,
  WALL_CHAIR_RAIL_DEFAULT,
  WALL_CHAIR_RAIL_SLOT_DEFAULT,
  WALL_CROWN_DEFAULT,
  WALL_CROWN_SLOT_DEFAULT,
  WALL_FACE_REGION_LIMIT,
  WALL_SKIRTING_DEFAULT,
  WALL_SKIRTING_SLOT_DEFAULT,
  WALL_SLOT_DEFAULT,
  WALL_SURFACE_SLOT_DEFAULTS,
  WALL_TRIM_DEFAULTS,
  WallAssembly,
  WallAssemblyExteriorFinish,
  WallAssemblyFramingKind,
  WallAssemblyInteriorFinish,
  WallAssemblySheathingMaterial,
  WallFaceRegion,
  WallFaceScript,
  WallNode,
  WallTreatmentSide,
  WallTrimProfile,
} from './nodes/wall'
export {
  WindowConstructionType,
  WindowDimensionReference,
  WindowNode,
  WindowType,
} from './nodes/window'
export { ZoneFloorScript, ZoneNode } from './nodes/zone'
// Typed source identity (D5)
export {
  PROVENANCE_MAX_ID_BYTES,
  PROVENANCE_MAX_LINEAGE_IDS,
  PROVENANCE_MAX_NAMESPACE_BYTES,
  PROVENANCE_MAX_NODE_ID_BYTES,
  PROVENANCE_MAX_REFS,
  Provenance,
  ProvenanceLineage,
  ProvenanceLineageOp,
  ProvenanceRef,
  ProvenanceRole,
} from './provenance'
export { generateSceneMaterialId, SceneMaterial, type SceneMaterialId } from './scene-material'
// Source references in string form (`<ns>:<id>[::<sub>]`, D5)
export { type ParsedSourceRef, parseSourceRef, SourceRefString } from './source-ref'
export { MAX_TERRAIN_SIDE, TerrainData } from './terrain'
export type {
  Anchor,
  AnchorPolicy,
  AnyNodeId,
  AnyNodeOption,
  AnyNodeType,
  DefinitionPin,
  Discipline,
  DisplayFamily,
  DisplayMode,
  EndCut,
  FidelityV2,
  FidelityV3,
  FitTarget,
  MaterialPattern,
  MaterialPatternType,
  Mount,
  MountAlign,
  MountHost,
  PartKey,
  ResolvedSectionProfile,
  SectionFamily,
  SectionLibraryEntry,
  SectionProfile,
  SitePresentation,
  SurfaceAnchor,
  SurfacePatchId,
  SweepEndSpec,
  WallMountDatum,
} from './types'
// Union types
export { AnyNode, nodeKindOf } from './types'
export {
  CUSTOM_WALL_TYPE_PREFIX,
  newWallTypeId,
  WallTypeDefinition,
  WallTypeDefinitionId,
} from './wall-type'
