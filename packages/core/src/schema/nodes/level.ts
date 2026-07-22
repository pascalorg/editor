import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { CeilingNode } from './ceiling'
import { ColumnNode } from './column'
import { DuctFittingNode } from './duct-fitting'
import { DuctSegmentNode } from './duct-segment'
import { DuctTerminalNode } from './duct-terminal'
import { FenceNode } from './fence'
import { GuideNode } from './guide'
import { HvacEquipmentNode } from './hvac-equipment'
import { ItemNode } from './item'
import { LinesetNode } from './lineset'
import { LiquidLineNode } from './liquid-line'
import { MeasurementNode } from './measurement'
import { PipeFittingNode } from './pipe-fitting'
import { PipeSegmentNode } from './pipe-segment'
import { PipeTrapNode } from './pipe-trap'
import { RoofNode } from './roof'
import { ScanNode } from './scan'
import { ShelfNode } from './shelf'
import { SlabNode } from './slab'
import { SpawnNode } from './spawn'
import { StairNode } from './stair'
import { WallNode } from './wall'
import { ZoneNode } from './zone'

export const LevelNode = BaseNode.extend({
  id: objectId('level'),
  type: nodeType('level'),
  children: z
    .array(
      z.union([
        WallNode.shape.id,
        FenceNode.shape.id,
        ColumnNode.shape.id,
        ItemNode.shape.id,
        ZoneNode.shape.id,
        SlabNode.shape.id,
        CeilingNode.shape.id,
        RoofNode.shape.id,
        StairNode.shape.id,
        ScanNode.shape.id,
        GuideNode.shape.id,
        MeasurementNode.shape.id,
        SpawnNode.shape.id,
        ShelfNode.shape.id,
        DuctSegmentNode.shape.id,
        DuctFittingNode.shape.id,
        DuctTerminalNode.shape.id,
        HvacEquipmentNode.shape.id,
        LinesetNode.shape.id,
        LiquidLineNode.shape.id,
        PipeSegmentNode.shape.id,
        PipeFittingNode.shape.id,
        PipeTrapNode.shape.id,
      ]),
    )
    .default([]),
  // Specific props
  level: z.number().default(0),
  /**
   * Stored storey height in meters (floor-to-floor). No zod default on
   * purpose: absence marks unmigrated legacy data and gates the load-time
   * migration; a schema default would materialize silently through .parse().
   */
  height: z.number().optional(),
}).describe(
  dedent`
  Level node - used to represent a level in the building
  - children: array of architectural, equipment, and MEP distribution nodes
  - level: level number
  - height: storey height in meters (floor-to-floor); absent only on unmigrated legacy data
  `,
)

export type LevelNode = z.infer<typeof LevelNode>
