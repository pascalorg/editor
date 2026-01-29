import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const RoofNode = BaseNode.extend({
  id: objectId('roof'),
  type: nodeType('roof'),
  // Position of the roof center (Y should typically be 0)
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  // Rotation around Y axis in radians
  rotation: z.number().default(0),
  // Length of the roof along the ridge direction (in meters)
  length: z.number().default(4),
  // Height of the roof peak from the base
  height: z.number().default(1.5),
  // Width of the left slope (in meters, measured horizontally from ridge)
  leftWidth: z.number().default(1.5),
  // Width of the right slope (in meters, measured horizontally from ridge)
  rightWidth: z.number().default(1.5),
}).describe(
  dedent`
  Roof node - used to represent a gable roof in the building
  - position: center position of the roof (Y typically 0)
  - rotation: rotation around Y axis
  - length: length of the roof along the ridge
  - height: height of the roof peak
  - leftWidth: horizontal width of the left slope (from ridge to eave)
  - rightWidth: horizontal width of the right slope (from ridge to eave)
  Total width = leftWidth + rightWidth
  `,
)

export type RoofNode = z.infer<typeof RoofNode>
