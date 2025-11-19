import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeId, nodeType } from '../base'
import { LevelNode } from './level'

export const BuildingNode = BaseNode.extend({
  id: nodeId('building'),
  type: nodeType('building'),
  children: z.array(LevelNode).default([LevelNode.parse({})]),
  position: z.tuple([z.number(), z.number()]).default([0, 0]), // (x, z) in site coordinate system (default is [0, 0])
  rotation: z.number().default(0), // Yaw around Y-axis in site coordinate system
}).describe(
  dedent`
  Building node - used to represent a building
  - children: array of level nodes (each level is a tree of floor and wall nodes) 
  - position: position in site coordinate system (default is [0, 0]) anchoring the building to the site
  - rotation: rotation in site coordinate system (default is 0) yaw around Y-axis
  `,
)

export type BuildingNode = z.infer<typeof BuildingNode>
