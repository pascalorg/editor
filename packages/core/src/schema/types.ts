import z from 'zod'
import { BlockNode } from './nodes/block'
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
import { LeanToExtensionNode } from './nodes/lean-to-extension'
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

/** A node schema as authored: `type` is a literal wrapped by `nodeType()`'s `.default()`. */
type NodeMember = z.ZodObject<{ type: z.ZodDefault<z.ZodLiteral<string>> } & z.core.$ZodLooseShape>

/** The same schema with the discriminator narrowed back to its bare literal. */
type BareDiscriminator<T extends NodeMember> = z.ZodObject<
  Omit<T['shape'], 'type'> & { type: ReturnType<T['shape']['type']['unwrap']> }
>

/**
 * Assembles the node union on discriminators that claim exactly one value.
 *
 * `nodeType()` defaults the literal so a per-kind schema can fill `type` in
 * (`WallNode.parse({ start, end })`), but a `.default()`-wrapped discriminator
 * also claims `undefined` from zod 4.5 on (upstream #6432). With 48 members
 * doing it, the union's lazily-built discriminator map collides on
 * `undefined` and throws `Duplicate discriminator value` — as a plain Error,
 * so it escapes `safeParse` and surfaces as a crash at the first parse.
 *
 * Each member is therefore projected to a clone whose `type` is the bare
 * literal. Per-kind schemas keep their default; only the union's view of the
 * discriminator narrows. Metadata lives in zod's global registry keyed by
 * instance, so `.describe()` text has to be carried over to the clone by hand.
 */
export const nodeUnion = <const T extends readonly [NodeMember, ...NodeMember[]]>(members: T) =>
  z.discriminatedUnion(
    'type',
    members.map((member) => {
      const projected = member.extend({ type: member.shape.type.unwrap() })
      const meta = z.globalRegistry.get(member)
      return meta ? projected.meta(meta) : projected
    }) as { [K in keyof T]: BareDiscriminator<T[K]> },
  )

export const AnyNode = nodeUnion([
  SiteNode,
  BuildingNode,
  ElevatorNode,
  LevelNode,
  LeanToExtensionNode,
  ColumnNode,
  ConstructionDimensionNode,
  BlockNode,
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

/** One member schema of `AnyNode`, discriminator already projected to a bare literal. */
export type AnyNodeOption = (typeof AnyNode)['options'][number]

/** The node kind a union member accepts, read off its bare-literal discriminator. */
export const nodeKindOf = (option: AnyNodeOption): AnyNodeType => option.shape.type.value
