import z from 'zod'
import { BoxVentNode } from './nodes/box-vent'
import { BuildingNode } from './nodes/building'
import { CeilingNode } from './nodes/ceiling'
import { ChimneyNode } from './nodes/chimney'
import { ColumnNode } from './nodes/column'
import { DoorNode } from './nodes/door'
import { DormerNode } from './nodes/dormer'
import { ElevatorNode } from './nodes/elevator'
import { FenceNode } from './nodes/fence'
import { GuideNode } from './nodes/guide'
import { ItemNode } from './nodes/item'
import { LevelNode } from './nodes/level'
import { RidgeVentNode } from './nodes/ridge-vent'
import { RoofNode } from './nodes/roof'
import { RoofSegmentNode } from './nodes/roof-segment'
import { ScanNode } from './nodes/scan'
import { ShelfNode } from './nodes/shelf'
import { SiteNode } from './nodes/site'
import { SkylightNode } from './nodes/skylight'
import { SlabNode } from './nodes/slab'
import { SolarPanelNode } from './nodes/solar-panel'
import { SpawnNode } from './nodes/spawn'
import { StairNode } from './nodes/stair'
import { StairSegmentNode } from './nodes/stair-segment'
import { WallNode } from './nodes/wall'
import { WindowNode } from './nodes/window'
import { ZoneNode } from './nodes/zone'

export const AnyNode = z.discriminatedUnion('type', [
  SiteNode,
  BuildingNode,
  ElevatorNode,
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
  ShelfNode,
  StairNode,
  StairSegmentNode,
  ScanNode,
  GuideNode,
  SpawnNode,
  WindowNode,
  DoorNode,
  BoxVentNode,
  RidgeVentNode,
  ChimneyNode,
  SolarPanelNode,
  SkylightNode,
  DormerNode,
])

export type AnyNode = z.infer<typeof AnyNode>
export type AnyNodeType = AnyNode['type']
export type AnyNodeId = AnyNode['id']
