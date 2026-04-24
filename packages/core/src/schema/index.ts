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
export { ArchwayNode } from './nodes/archway'
export { BuildingNode } from './nodes/building'
export { CeilingNode } from './nodes/ceiling'
export { DoorNode, DoorSegment } from './nodes/door'
export { FenceBaseStyle, FenceNode, FenceStyle } from './nodes/fence'
export { GuideNode } from './nodes/guide'
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
export { getScaledDimensions, ItemNode } from './nodes/item'
export { LevelNode } from './nodes/level'
export { getEffectiveRoofSurfaceMaterial, RoofNode } from './nodes/roof'
export type { RoofSurfaceMaterialRole, RoofSurfaceMaterialSpec } from './nodes/roof'
export { RoofSegmentNode, RoofType } from './nodes/roof-segment'
export { ScanNode } from './nodes/scan'
// Nodes
export { SiteNode } from './nodes/site'
export { SlabNode } from './nodes/slab'
export {
  getEffectiveStairSurfaceMaterial,
  StairNode,
  StairRailingMode,
  StairSlabOpeningMode,
  StairTopLandingMode,
  StairType,
} from './nodes/stair'
export type { StairSurfaceMaterialRole, StairSurfaceMaterialSpec } from './nodes/stair'
export { AttachmentSide, StairSegmentNode, StairSegmentType } from './nodes/stair-segment'
export { SurfaceHoleMetadata } from './nodes/surface-hole-metadata'
export type { WallSurfaceMaterialSpec, WallSurfaceSide } from './nodes/wall'
export {
  getEffectiveWallSurfaceMaterial,
  getWallSurfaceMaterialSignature,
  WallNode,
} from './nodes/wall'
export { WindowNode } from './nodes/window'
export { ZoneNode } from './nodes/zone'
export type { AnyNodeId, AnyNodeType } from './types'
// Union types
export { AnyNode } from './types'
