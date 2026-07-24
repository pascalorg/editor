import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import type { CeilingNode } from './ceiling'
import type { ColumnNode } from './column'
import type { ConstructionDimensionNode } from './construction-dimension'
import type { DuctFittingNode } from './duct-fitting'
import type { DuctSegmentNode } from './duct-segment'
import type { DuctTerminalNode } from './duct-terminal'
import type { FenceNode } from './fence'
import type { GuideNode } from './guide'
import type { HvacEquipmentNode } from './hvac-equipment'
import type { ItemNode } from './item'
import type { LinesetNode } from './lineset'
import type { LiquidLineNode } from './liquid-line'
import type { MeasurementNode } from './measurement'
import type { PipeFittingNode } from './pipe-fitting'
import type { PipeSegmentNode } from './pipe-segment'
import type { PipeTrapNode } from './pipe-trap'
import type { RoofNode } from './roof'
import type { ScanNode } from './scan'
import type { ShelfNode } from './shelf'
import type { SlabNode } from './slab'
import type { SpawnNode } from './spawn'
import type { StairNode } from './stair'
import type { StructuralGridNode } from './structural-grid'
import type { WallNode } from './wall'
import type { ZoneNode } from './zone'

type CoreLevelChildId =
  | WallNode['id']
  | FenceNode['id']
  | ColumnNode['id']
  | ConstructionDimensionNode['id']
  | StructuralGridNode['id']
  | ItemNode['id']
  | ZoneNode['id']
  | SlabNode['id']
  | CeilingNode['id']
  | RoofNode['id']
  | StairNode['id']
  | ScanNode['id']
  | GuideNode['id']
  | MeasurementNode['id']
  | SpawnNode['id']
  | ShelfNode['id']
  | DuctSegmentNode['id']
  | DuctFittingNode['id']
  | DuctTerminalNode['id']
  | HvacEquipmentNode['id']
  | LinesetNode['id']
  | LiquidLineNode['id']
  | PipeSegmentNode['id']
  | PipeFittingNode['id']
  | PipeTrapNode['id']

const LevelChildId = z.string().transform((id) => id as CoreLevelChildId)

export const LevelNode = BaseNode.extend({
  id: objectId('level'),
  type: nodeType('level'),
  // The node registry owns child-kind validity. Persisted level relationships
  // must also admit IDs minted by plugins that core cannot enumerate.
  children: z.array(LevelChildId).default([]),
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
