// lib/scenegraph/schema/nodes/door.ts
import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, id, nodeType } from '../base'

export const DoorNode = BaseNode.extend({
  id: id('door'),
  type: nodeType('door'),
  // Position is in local coordinate system of the wall
  position: z.number(),
}).describe(
  dedent`
  Door node - used to represent a door in the wall:
  - position: position in local coordinate system of the wall
  `,
)

export type DoorNode = z.infer<typeof DoorNode>
