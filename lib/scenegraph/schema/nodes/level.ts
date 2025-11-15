import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, id, nodeType } from '../base'
import { FloorNode } from './floor'
import { WallNode } from './wall'

export const LevelNode = BaseNode.extend({
  id: id('level'),
  type: nodeType('level'),
  children: z.array(z.discriminatedUnion('type', [FloorNode, WallNode])).default([]),
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
