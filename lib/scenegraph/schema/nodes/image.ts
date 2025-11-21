import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeId, nodeType } from '../base'

export const ImageNode = BaseNode.extend({
  id: nodeId('image'),
  type: nodeType('image'),
  url: z.string(), // Data URL for image
  position: z.tuple([z.number(), z.number()]).default([0, 0]),
  // rotation around Y-axis in level coordinate system (image are flat on the ground)
  rotationY: z.number().default(0),
  scale: z.number().min(0),
}).describe(
  dedent`
  Image node - used to represent a image in the building
  - url: url of the image
  `,
)

export type ImageNode = z.infer<typeof ImageNode>
