import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeId, nodeType } from '../base'
import { CeilingNode } from './ceiling'
import { ColumnNode } from './column'
import { DoorNode } from './door'
import { FloorNode } from './floor'
import { ItemNode } from './item'
import { WallNode } from './wall'
import { WindowNode } from './window'

export const GroupNode = BaseNode.extend({
  id: nodeId('group'),
  type: nodeType('group'),
  // TODO: test recursive GroupNode children
  children: z
    .array(
      z.discriminatedUnion('type', [
        // Building elements or items
        FloorNode,
        WallNode,
        DoorNode,
        WindowNode,
        ColumnNode,
        CeilingNode,
        ItemNode,
      ]),
    )
    .default([]),
  position: z.tuple([z.number(), z.number()]),
}).describe(
  dedent`
  Group node - used to represent a group of nodes in the building
  - children: array of floor, wall, door, window nodes
  - position: position in level coordinate system
  `,
)

export type GroupNode = z.infer<typeof GroupNode>
