import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeId, nodeType } from '../base'
import { ColumnNode } from './column'
import { FloorNode } from './floor'
import { GroupNode } from './group'
import { ImageNode } from './image'
import { ItemNode } from './item'
import { RoofNode } from './roof'
import { ScanNode } from './scan'
import { WallNode } from './wall'

export const LevelNode = BaseNode.extend({
  id: nodeId('level'),
  type: nodeType('level'),
  children: z
    .array(
      z.discriminatedUnion('type', [
        FloorNode,
        WallNode,
        ColumnNode,
        GroupNode,
        ItemNode,
        RoofNode,
        ImageNode,
        ScanNode,
      ]),
    )
    .default([]),
  // Specific props
  level: z.number().default(0),
}).describe(
  dedent`
  Level node - used to represent a level in the building
  - children: array of floor, wall, ceiling, roof, item nodes
  - level: level number
  `,
)

export type LevelNode = z.infer<typeof LevelNode>
