import { z } from 'zod'
import { EnvironmentNode } from './environment'
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
import { RootNode } from './root'

export * from '../common-types'
export * from './base'
export * from './environment'
// Export all specific node types
export * from './nodes/building'
export * from './nodes/ceiling'
export * from './nodes/column'
export * from './nodes/door'
export * from './nodes/floor'
export * from './nodes/group'
export * from './nodes/image'
export * from './nodes/item'
export * from './nodes/level'
export * from './nodes/roof'
export * from './nodes/scan'
export * from './nodes/site'
export * from './nodes/slab'
export * from './nodes/stair'
export * from './nodes/wall'
export * from './nodes/window'
export * from './root'

export const SceneSchema = z.object({
  root: RootNode.default(RootNode.parse({})),
  metadata: z.json().default({}),
})

export type Scene = z.infer<typeof SceneSchema>

export function initScene(): Scene {
  return SceneSchema.parse({
    root: RootNode.parse({}),
  })
}

export function loadScene(scene: unknown) {
  const result = SceneSchema.safeParse(scene)
  if (!result.success) {
    throw new Error(`Failed to load scene: ${result.error.message}`)
  }
  return result.data as Scene
}

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

// Type mapping for extracting specific node types
export type NodeTypeMap = {
  [K in keyof typeof NodeSchemas]: z.infer<(typeof NodeSchemas)[K]>
}

export type NodeCreateTypeMap = {
  [K in keyof typeof NodeCreateSchemas]: z.infer<(typeof NodeCreateSchemas)[K]>
}

export const loadNode = (node: unknown): AnyNode => {
  const result = AnyNode.safeParse(node)
  if (!result.success) {
    throw new Error(`Failed to load node: ${result.error.message}`)
  }
  return result.data as AnyNode
}
