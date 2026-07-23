import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const LevelNode = BaseNode.extend({
  id: objectId('level'),
  type: nodeType('level'),
  // The node registry owns child-kind validity. Persisted level relationships
  // must also admit IDs minted by plugins that core cannot enumerate.
  children: z.array(z.string()).default([]),
  // Specific props
  level: z.number().default(0),
}).describe(
  dedent`
  Level node - used to represent a level in the building
  - children: array of architectural, equipment, and MEP distribution nodes
  - level: level number
  `,
)

export type LevelNode = z.infer<typeof LevelNode>
