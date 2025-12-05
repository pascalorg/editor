import z from 'zod'

// Export all specific node types
import { BuildingNode } from './nodes/building'
import { CeilingNode } from './nodes/ceiling'
import { ColumnNode } from './nodes/column'
import { DoorNode } from './nodes/door'
import { FloorNode } from './nodes/floor'
import { GroupNode } from './nodes/group'
import { ImageNode } from './nodes/image'
import { ItemNode } from './nodes/item'
import { LevelNode } from './nodes/level'
import { RoofNode } from './nodes/roof'
import { ScanNode } from './nodes/scan'
import { SiteNode } from './nodes/site'
import { SlabNode } from './nodes/slab'
import { StairNode, StairSegmentNode } from './nodes/stair'
import { WallNode } from './nodes/wall'
import { WindowNode } from './nodes/window'

// Nodes that should not be included in the AnyNode are: SiteNode
export const AnyNode = z.discriminatedUnion('type', [
  BuildingNode,
  LevelNode,
  WallNode,
  DoorNode,
  WindowNode,
  FloorNode,
  CeilingNode,
  RoofNode,
  ColumnNode,
  GroupNode,
  ItemNode,
  ImageNode,
  ScanNode,
  SlabNode,
  SiteNode,
  StairNode,
  StairSegmentNode,
])
export type AnyNode = z.infer<typeof AnyNode>
export type AnyNodeType = AnyNode['type']
export type AnyNodeId = AnyNode['id']

// RootNode and EnvironmentNode are not "nodes" anymore (no ID, no Type)
export type SceneNode = AnyNode
export type SceneNodeId = SceneNode['id']
export type SceneNodeType = SceneNode['type']

export const NodeSchemas = {
  site: SiteNode,
  building: BuildingNode,
  level: LevelNode,
  wall: WallNode,
  door: DoorNode,
  window: WindowNode,
  floor: FloorNode,
  ceiling: CeilingNode,
  roof: RoofNode,
  column: ColumnNode,
  group: GroupNode,
  item: ItemNode,
  image: ImageNode,
  scan: ScanNode,
  slab: SlabNode,
  stair: StairNode,
  stair_segment: StairSegmentNode,
}

export const NodeCreateSchemas = {
  site: SiteNode.omit({ id: true, object: true, type: true }),
  building: BuildingNode.omit({ id: true, object: true, type: true }),
  level: LevelNode.omit({ id: true, object: true, type: true }),
  wall: WallNode.omit({ id: true, object: true, type: true }),
  door: DoorNode.omit({ id: true, object: true, type: true }),
  window: WindowNode.omit({ id: true, object: true, type: true }),
  floor: FloorNode.omit({ id: true, object: true, type: true }),
  ceiling: CeilingNode.omit({ id: true, object: true, type: true }),
  roof: RoofNode.omit({ id: true, object: true, type: true }),
  column: ColumnNode.omit({ id: true, object: true, type: true }),
  group: GroupNode.omit({ id: true, object: true, type: true }),
  item: ItemNode.omit({ id: true, object: true, type: true }),
  image: ImageNode.omit({ id: true, object: true, type: true }),
  scan: ScanNode.omit({ id: true, object: true, type: true }),
  slab: SlabNode.omit({ id: true, object: true, type: true }),
  stair: StairNode.omit({ id: true, object: true, type: true }),
  stair_segment: StairSegmentNode.omit({ id: true, object: true, type: true }),
}
