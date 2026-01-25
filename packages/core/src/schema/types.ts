import z from 'zod'
import { BuildingNode } from './nodes/building'
import { ItemNode } from './nodes/item'
import { LevelNode } from './nodes/level'
import { SiteNode } from './nodes/site'
import { WallNode } from './nodes/wall'
import { ZoneNode } from './nodes/zone'

export const AnyNode = z.discriminatedUnion('type', [
  SiteNode,
  BuildingNode,
  LevelNode,
  WallNode,
  ItemNode,
  ZoneNode,
])

export type AnyNode = z.infer<typeof AnyNode>
export type AnyNodeType = AnyNode['type']
export type AnyNodeId = AnyNode['id']
