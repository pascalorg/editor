import z from 'zod'
import { BoxVentNode } from './nodes/box-vent'
import { BuildingNode } from './nodes/building'
import { CabinetModuleNode, CabinetNode } from './nodes/cabinet'
import { CeilingNode } from './nodes/ceiling'
import { ChimneyNode } from './nodes/chimney'
import { ColumnNode } from './nodes/column'
import { ConstructionDimensionNode } from './nodes/construction-dimension'
import { CupolaNode } from './nodes/cupola'
import { DoorNode } from './nodes/door'
import { DormerNode } from './nodes/dormer'
import { DownspoutNode } from './nodes/downspout'
import { DrawingSheetNode } from './nodes/drawing-sheet'
import { DuctFittingNode } from './nodes/duct-fitting'
import { DuctSegmentNode } from './nodes/duct-segment'
import { DuctTerminalNode } from './nodes/duct-terminal'
import { ElevatorNode } from './nodes/elevator'
import { EyebrowVentNode } from './nodes/eyebrow-vent'
import { FenceNode } from './nodes/fence'
import { GuideNode } from './nodes/guide'
import { GutterNode } from './nodes/gutter'
import { HvacEquipmentNode } from './nodes/hvac-equipment'
import { ItemNode } from './nodes/item'
import { LevelNode } from './nodes/level'
import { LinesetNode } from './nodes/lineset'
import { LiquidLineNode } from './nodes/liquid-line'
import { MeasurementNode } from './nodes/measurement'
import { PipeFittingNode } from './nodes/pipe-fitting'
import { PipeSegmentNode } from './nodes/pipe-segment'
import { PipeTrapNode } from './nodes/pipe-trap'
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
import { StructuralGridNode } from './nodes/structural-grid'
import { TurbineVentNode } from './nodes/turbine-vent'
import { WallNode } from './nodes/wall'
import { WindowNode } from './nodes/window'
import { ZoneNode } from './nodes/zone'

export const AnyNode = z.discriminatedUnion('type', [
  SiteNode,
  BuildingNode,
  ElevatorNode,
  LevelNode,
  ColumnNode,
  ConstructionDimensionNode,
  StructuralGridNode,
  WallNode,
  FenceNode,
  CabinetNode,
  CabinetModuleNode,
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
  MeasurementNode,
  SpawnNode,
  WindowNode,
  DoorNode,
  BoxVentNode,
  RidgeVentNode,
  TurbineVentNode,
  CupolaNode,
  EyebrowVentNode,
  GutterNode,
  ChimneyNode,
  SolarPanelNode,
  SkylightNode,
  DormerNode,
  DownspoutNode,
  DrawingSheetNode,
  DuctSegmentNode,
  DuctFittingNode,
  DuctTerminalNode,
  HvacEquipmentNode,
  LinesetNode,
  LiquidLineNode,
  PipeSegmentNode,
  PipeFittingNode,
  PipeTrapNode,
])

export type AnyNode = z.infer<typeof AnyNode>
export type AnyNodeType = AnyNode['type']
export type AnyNodeId = AnyNode['id']
