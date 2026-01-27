import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const CeilingNode = BaseNode.extend({
  id: objectId('ceiling'),
  type: nodeType('ceiling'),
  // Specific props
  // Polygon boundary - array of [x, z] coordinates defining the ceiling
  polygon: z.array(z.tuple([z.number(), z.number()])),
  height: z.number().default(2.5), // Height in meters
}).describe(
  dedent`
  Ceiling node - used to represent a ceiling in the building
  - polygon: array of [x, z] points defining the ceiling boundary
  `,
)

export type CeilingNode = z.infer<typeof CeilingNode>
