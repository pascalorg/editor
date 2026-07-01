import z from 'zod'
import { AssemblyNode } from './nodes/assembly'
import { BoxNode } from './nodes/box'
import { BuildingNode } from './nodes/building'
import { CableTrayNode } from './nodes/cable-tray'
import { CapsuleNode } from './nodes/capsule'
import { CeilingNode } from './nodes/ceiling'
import { ColumnNode } from './nodes/column'
import { ConeNode } from './nodes/cone'
import { ConformalStripNode } from './nodes/conformal-strip'
import { ConveyorBeltNode } from './nodes/conveyor-belt'
import { CylinderNode } from './nodes/cylinder'
import { DataChartNode } from './nodes/data-chart'
import { DataTableNode } from './nodes/data-table'
import { DataWidgetNode } from './nodes/data-widget'
import { DoorNode } from './nodes/door'
import { ElevatorNode } from './nodes/elevator'
import { ExtrudeNode } from './nodes/extrude'
import { FenceNode } from './nodes/fence'
import { FrustumNode } from './nodes/frustum'
import { GuideNode } from './nodes/guide'
import { HalfCylinderNode } from './nodes/half-cylinder'
import { HemisphereNode } from './nodes/hemisphere'
import { ItemNode } from './nodes/item'
import { LadderNode } from './nodes/ladder'
import { LatheNode } from './nodes/lathe'
import { LevelNode } from './nodes/level'
import { PipeNode } from './nodes/pipe'
import { PipeFittingNode } from './nodes/pipe-fitting'
import { RoadNode } from './nodes/road'
import { RoofNode } from './nodes/roof'
import { RoofSegmentNode } from './nodes/roof-segment'
import { RoundedPanelNode } from './nodes/rounded-panel'
import { ScanNode } from './nodes/scan'
import { ShelfNode } from './nodes/shelf'
import { SiteNode } from './nodes/site'
import { SlabNode } from './nodes/slab'
import { SpawnNode } from './nodes/spawn'
import { SphereNode } from './nodes/sphere'
import { StairNode } from './nodes/stair'
import { StairSegmentNode } from './nodes/stair-segment'
import { SteelBeamNode } from './nodes/steel-beam'
import { SteelFrameNode } from './nodes/steel-frame'
import { SweepNode } from './nodes/sweep'
import { TankNode } from './nodes/tank'
import { TorusNode } from './nodes/torus'
import { TrapezoidPrismNode } from './nodes/trapezoid-prism'
import { WallNode } from './nodes/wall'
import { WedgeNode } from './nodes/wedge'
import { WindowNode } from './nodes/window'
import { ZoneNode } from './nodes/zone'

export const AnyNode = z.discriminatedUnion('type', [
  SiteNode,
  BuildingNode,
  AssemblyNode,
  CableTrayNode,
  BoxNode,
  CylinderNode,
  DataChartNode,
  DataTableNode,
  DataWidgetNode,
  ConeNode,
  ConformalStripNode,
  ConveyorBeltNode,
  FrustumNode,
  HemisphereNode,
  TorusNode,
  WedgeNode,
  TrapezoidPrismNode,
  SphereNode,
  LatheNode,
  CapsuleNode,
  HalfCylinderNode,
  RoundedPanelNode,
  ExtrudeNode,
  SweepNode,
  TankNode,
  ElevatorNode,
  LevelNode,
  ColumnNode,
  WallNode,
  FenceNode,
  PipeFittingNode,
  PipeNode,
  RoadNode,
  ItemNode,
  LadderNode,
  ZoneNode,
  SlabNode,
  CeilingNode,
  RoofNode,
  RoofSegmentNode,
  ShelfNode,
  SteelBeamNode,
  SteelFrameNode,
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
