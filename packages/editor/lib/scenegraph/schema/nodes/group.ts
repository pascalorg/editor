import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { CeilingNode } from './ceiling'
import { ColumnNode } from './column'
import { DoorNode } from './door'
import { ItemNode } from './item'
import { SlabNode } from './slab'
import { WallNode } from './wall'
import { WindowNode } from './window'

// Helper to avoid circular dependencies with lazy evaluation
const GroupChildNode: z.ZodType<any> = z.lazy(() =>
  z.discriminatedUnion('type', [
    // Building elements or items
    SlabNode,
    WallNode,
    DoorNode,
    WindowNode,
    ColumnNode,
    CeilingNode,
    ItemNode,
    GroupNode,
  ]),
)

export const GroupNode = BaseNode.extend({
  id: objectId('group'),
  type: nodeType('group'),
  children: z.array(GroupChildNode).default([]),
  position: z.tuple([z.number(), z.number()]),
  rotation: z.number(),
}).describe(
  dedent`
  Group node - used to represent a group of nodes in the building
  - children: array of floor, wall, door, window nodes
  - position: position in level coordinate system
  `,
)

export type GroupNode = z.infer<typeof GroupNode>
