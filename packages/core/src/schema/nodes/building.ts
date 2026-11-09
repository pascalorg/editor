import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { ElevatorNode } from './elevator'
import { LevelNode } from './level'
import { UnitNode } from './unit'

export const BuildingNode = BaseNode.extend({
  id: objectId('building'),
  type: nodeType('building'),
  children: z
    .array(z.union([LevelNode.shape.id, ElevatorNode.shape.id, UnitNode.shape.id]))
    .default([]),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  groundLevelId: z.templateLiteral(['level_', z.string()]).optional(),
}).describe(
  dedent`
  Building node - used to represent a building
  - position: position in site coordinate system
  - rotation: rotation in site coordinate system
  - groundLevelId: the level standing at grade, the ground line of the stack; levels with a lower floor index are below grade. Absent: the lowest level whose floor is not under the ground
  - children: array of levels, units referencing zones, and building-level systems such as elevators
  `,
)

export type BuildingNode = z.infer<typeof BuildingNode>
