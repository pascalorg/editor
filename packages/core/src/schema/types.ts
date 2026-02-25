import z from 'zod'
import { BuildingNode } from './nodes/building'
import { CeilingNode } from './nodes/ceiling'
import { GuideNode } from './nodes/guide'
import { ItemNode } from './nodes/item'
import { LevelNode } from './nodes/level'
import { RoofNode } from './nodes/roof'
import { ScanNode } from './nodes/scan'
import { SiteNode } from './nodes/site'
import { SlabNode } from './nodes/slab'
import { DoorNode } from './nodes/door'
import { WallNode } from './nodes/wall'
import { WindowNode } from './nodes/window'
import { ZoneNode } from './nodes/zone'

export const AnyNode = z.discriminatedUnion('type', [
  SiteNode,
  BuildingNode,
  LevelNode,
  WallNode,
  ItemNode,
  ZoneNode,
  SlabNode,
  CeilingNode,
  RoofNode,
  ScanNode,
  GuideNode,
  WindowNode,
  DoorNode,
])

export type AnyNode = z.infer<typeof AnyNode>
export type AnyNodeType = AnyNode['type']
export type AnyNodeId = AnyNode['id']
