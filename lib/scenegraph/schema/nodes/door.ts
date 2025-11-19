// lib/scenegraph/schema/nodes/door.ts
import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeId, nodeType } from '../base'

export const DoorNode = BaseNode.extend({
  id: nodeId('door'),
  type: nodeType('door'),
  // Position is in local coordinate system of the wall
  position: z.tuple([z.number(), z.number()]), // x along wall from wall start point, y vertical position
}).describe(
  dedent`
  Door node - used to represent a door in the wall:
  - position: position in local coordinate system of the wall
  `,
)

export type DoorNode = z.infer<typeof DoorNode>
