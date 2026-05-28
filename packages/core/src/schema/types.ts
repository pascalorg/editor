import z from 'zod'
import { BoxNode } from './nodes/box'
import { BuildingNode } from './nodes/building'
import { CeilingNode } from './nodes/ceiling'
import { CylinderNode } from './nodes/cylinder'
import { ColumnNode } from './nodes/column'
import { DoorNode } from './nodes/door'
import { ElevatorNode } from './nodes/elevator'
import { FenceNode } from './nodes/fence'
import { PipeNode } from './nodes/pipe'
import { GuideNode } from './nodes/guide'
import { LatheNode } from './nodes/lathe'
import { ItemNode } from './nodes/item'
import { LevelNode } from './nodes/level'
import { RoofNode } from './nodes/roof'
import { RoofSegmentNode } from './nodes/roof-segment'
import { ScanNode } from './nodes/scan'
import { ShelfNode } from './nodes/shelf'
import { SiteNode } from './nodes/site'
import { SlabNode } from './nodes/slab'
import { SpawnNode } from './nodes/spawn'
import { SphereNode } from './nodes/sphere'
import { StairNode } from './nodes/stair'
import { StairSegmentNode } from './nodes/stair-segment'
import { WallNode } from './nodes/wall'
import { WindowNode } from './nodes/window'
import { ZoneNode } from './nodes/zone'

export const AnyNode = z.discriminatedUnion('type', [
  SiteNode,
  BuildingNode,
  BoxNode,
  CylinderNode,
  SphereNode,
  LatheNode,
  ElevatorNode,
  LevelNode,
  ColumnNode,
  WallNode,
  FenceNode,
  PipeNode,
  ItemNode,
  ZoneNode,
  SlabNode,
  CeilingNode,
  RoofNode,
  RoofSegmentNode,
  ShelfNode,
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
