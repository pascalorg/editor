import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { CeilingNode } from './ceiling'
import { GuideNode } from './guide'
import { RoofNode } from './roof'
import { ScanNode } from './scan'
import { SlabNode } from './slab'
import { WallNode } from './wall'
import { ZoneNode } from './zone'

export const LevelNode = BaseNode.extend({
  id: objectId('level'),
  type: nodeType('level'),
  children: z
    .array(
      z.union([
        WallNode.shape.id,
        ZoneNode.shape.id,
        SlabNode.shape.id,
        CeilingNode.shape.id,
        RoofNode.shape.id,
        ScanNode.shape.id,
        GuideNode.shape.id,
      ]),
    )
    .default([]),
  // Specific props
  level: z.number().default(0),
  baseElevation: z
    .number()
    .default(0)
    .describe("Additive Y offset in meters applied above this level's computed stack position."),
}).describe(
  dedent`
  Level node - used to represent a level in the building
  - children: array of floor, wall, ceiling, roof, item nodes
  - level: level number
  - baseElevation: additive Y offset in meters above the computed stack position
  `,
)

export type LevelNode = z.infer<typeof LevelNode>
