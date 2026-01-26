import z from 'zod'
import { BuildingNode } from './nodes/building'
import { ItemNode } from './nodes/item'
import { LevelNode } from './nodes/level'
import { SiteNode } from './nodes/site'
import { SlabNode } from './nodes/slab'
import { WallNode } from './nodes/wall'
import { ZoneNode } from './nodes/zone'

export const AnyNode = z.discriminatedUnion('type', [
  SiteNode,
  BuildingNode,
  LevelNode,
  WallNode,
  ItemNode,
  ZoneNode,
  SlabNode,
])

export type AnyNode = z.infer<typeof AnyNode>
export type AnyNodeType = AnyNode['type']
export type AnyNodeId = AnyNode['id']
