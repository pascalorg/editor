// Base
export { BaseNode, generateId, Material, nodeType, objectId } from './base'
// Camera
export { CameraSchema } from './camera'
// Collections
export { type Collection, type CollectionId, generateCollectionId } from './collections'
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
export { BoxVentNode } from './nodes/box-vent'
export { BuildingNode } from './nodes/building'
export { CeilingNode } from './nodes/ceiling'
export { ChimneyMaterialRole, ChimneyNode } from './nodes/chimney'
export {
  DormerNode,
  type DormerSurfaceMaterialRole,
  type DormerSurfaceMaterialSpec,
  getEffectiveDormerSurfaceMaterial,
} from './nodes/dormer'
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
export { DoorNode, DoorSegment } from './nodes/door'
export {
  ElevatorDoorPanelStyle,
  ElevatorDoorStyle,
  ElevatorNode,
  ElevatorShaftStyle,
} from './nodes/elevator'
export { FenceBaseStyle, FenceNode, FenceStyle } from './nodes/fence'
export { GuideNode, GuideScaleReference } from './nodes/guide'
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
export { LevelNode } from './nodes/level'
export type { RoofSurfaceMaterialRole, RoofSurfaceMaterialSpec } from './nodes/roof'
export { getEffectiveRoofSurfaceMaterial, RoofNode } from './nodes/roof'
export { RoofSegmentNode, RoofType } from './nodes/roof-segment'
export { ScanNode } from './nodes/scan'
// Nodes
export { RidgeVentNode } from './nodes/ridge-vent'
export { ShelfNode } from './nodes/shelf'
export {
  SKYLIGHT_TYPE_ORDER,
  SKYLIGHT_TYPE_PRESETS,
  SkylightMaterialRole,
  SkylightNode,
  SkylightOpeningSide,
  SkylightSlideDirection,
  type SkylightTypePreset,
  SkylightType,
} from './nodes/skylight'
export {
  SolarPanelMaterialRole,
  SolarPanelNode,
} from './nodes/solar-panel'
export {
  SOLAR_PANEL_PRESET_LABELS,
  SOLAR_PANEL_PRESETS,
  type SolarPanelPresetDims,
  SolarPanelPresetKey,
} from '../solar-panel-presets'
export { SiteNode } from './nodes/site'
export { SlabNode } from './nodes/slab'
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
export { SurfaceHoleMetadata } from './nodes/surface-hole-metadata'
export type { WallSurfaceMaterialSpec, WallSurfaceSide } from './nodes/wall'
export {
  getEffectiveWallSurfaceMaterial,
  getWallSurfaceMaterialSignature,
  WallNode,
} from './nodes/wall'
export { WindowNode, WindowType } from './nodes/window'
export { ZoneNode } from './nodes/zone'
export type { AnyNodeId, AnyNodeType } from './types'
// Union types
export { AnyNode } from './types'
