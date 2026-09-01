// Base

export {
  SOLAR_PANEL_PRESET_LABELS,
  SOLAR_PANEL_PRESETS,
  type SolarPanelPresetDims,
  SolarPanelPresetKey,
} from '../solar-panel-presets'
// Asset URL allowlist
export { ALLOWED_ORIGINS_ENV, ALLOWED_SCHEMES, AssetUrl } from './asset-url'
export { BaseNode, generateId, Material, nodeType, objectId } from './base'
// Camera
export { CameraSchema } from './camera'
// Collections
export { type Collection, type CollectionId, generateCollectionId } from './collections'
// Compiled per-kind parsers (opt-in)
export {
  compiledNodeParsersEnabled,
  enableCompiledNodeParsers,
  parseNode,
} from './compiled-node-parsers'
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
  DoorNode,
  DoorSegment,
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
export { FenceBaseStyle, FenceNode, FenceStyle } from './nodes/fence'
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
export type {
  DutchRoofMetrics,
  RoofSegmentSurfaceMaterialRole,
  RoofSegmentSurfaceMaterialSpec,
  RoofSegmentVisibleTopBounds,
  SegmentSlopeFrame,
} from './nodes/roof-segment'
export {
  getActiveRoofHeight,
  getConicalRoofCoverage,
  getDutchRoofMetrics,
  getEffectiveSegmentSurfaceMaterial,
  getPitchFromActiveRoofHeight,
  getRoofSegmentSurfaceY,
  getRoofSegmentVisibleTopBounds,
  getSegmentSlopeFrame,
  hasSegmentMaterialOverride,
  isBandedShedSegment,
  MIN_ROOF_SEGMENT_TRIM_SPAN,
  normalizeRoofSegmentTrim,
  ROOF_SHAPE_DEFAULTS,
  RoofSegmentNode,
  RoofSegmentTrim,
  RoofType,
} from './nodes/roof-segment'
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
export { ShelfNode } from './nodes/shelf'
export { SiteNode } from './nodes/site'
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
export { MIN_SLAB_THICKNESS, SlabNode } from './nodes/slab'
export {
  SolarPanelMaterialRole,
  SolarPanelNode,
} from './nodes/solar-panel'
export { SpawnNode } from './nodes/spawn'
export type { StairSurfaceMaterialRole, StairSurfaceMaterialSpec } from './nodes/stair'
export {
  getEffectiveStairSurfaceMaterial,
  StairNode,
  StairRailingMode,
  StairSlabOpeningMode,
  StairTopLandingMode,
  StairType,
} from './nodes/stair'
export { AttachmentSide, StairSegmentNode, StairSegmentType } from './nodes/stair-segment'
export { StructuralGridNode } from './nodes/structural-grid'
export { SurfaceHoleMetadata } from './nodes/surface-hole-metadata'
export { TurbineVentMaterialRole, TurbineVentNode } from './nodes/turbine-vent'
export type {
  WallBandSurfaceSlotId,
  WallFaceBand,
  WallFaceBandConfig,
  WallSurfaceMaterialSpec,
  WallSurfaceSide,
  WallSurfaceSlotId,
  WallTrimConfig,
} from './nodes/wall'
export {
  buildEnabledWallFaceBandPatch,
  buildWallFaceBandCountPatch,
  getEffectiveWallSurfaceMaterial,
  getWallBandSlotId,
  getWallFaceBandConfig,
  getWallFaceBandForHeight,
  getWallSurfaceMaterialSignature,
  getWallSurfaceSideFromBandSlot,
  WALL_CHAIR_RAIL_DEFAULT,
  WALL_CHAIR_RAIL_SLOT_DEFAULT,
  WALL_CROWN_DEFAULT,
  WALL_CROWN_SLOT_DEFAULT,
  WALL_FACE_BAND_DEFAULT,
  WALL_SKIRTING_DEFAULT,
  WALL_SKIRTING_SLOT_DEFAULT,
  WALL_SLOT_DEFAULT,
  WALL_SURFACE_SLOT_DEFAULTS,
  WALL_TRIM_DEFAULTS,
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
export { ZoneNode } from './nodes/zone'
export { generateSceneMaterialId, SceneMaterial, type SceneMaterialId } from './scene-material'
export { MAX_TERRAIN_SIDE, TerrainData } from './terrain'
export type { AnyNodeId, AnyNodeOption, AnyNodeType } from './types'
// Union types
export { AnyNode, nodeKindOf } from './types'
