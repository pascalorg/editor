import z from 'zod'
import { BuildingNode } from './nodes/building'
import { CeilingNode } from './nodes/ceiling'
import { ColumnNode } from './nodes/column'
import { DoorNode } from './nodes/door'
import { FenceNode } from './nodes/fence'
import { GuideNode } from './nodes/guide'
import { ItemNode } from './nodes/item'
import { LevelNode } from './nodes/level'
import { RoofNode } from './nodes/roof'
import { RoofSegmentNode } from './nodes/roof-segment'
import { ScanNode } from './nodes/scan'
import { SiteNode } from './nodes/site'
import { SlabNode } from './nodes/slab'
import { SpawnNode } from './nodes/spawn'
import { StairNode } from './nodes/stair'
import { StairSegmentNode } from './nodes/stair-segment'
import { WallNode } from './nodes/wall'
import { WindowNode } from './nodes/window'
import { ZoneNode } from './nodes/zone'

export const AnyNode = z.discriminatedUnion('type', [
  SiteNode,
  BuildingNode,
  LevelNode,
  ColumnNode,
  WallNode,
  FenceNode,
  ItemNode,
  ZoneNode,
  SlabNode,
  CeilingNode,
  RoofNode,
  RoofSegmentNode,
  StairNode,
  StairSegmentNode,
  ScanNode,
  GuideNode,
  SpawnNode,
  WindowNode,
  DoorNode,
])

export type AnyNode = z.infer<typeof AnyNode>
export type AnyNodeType = AnyNode['type']
export type AnyNodeId = AnyNode['id']
