import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const ImageNode = BaseNode.extend({
  id: objectId('image'),
  type: nodeType('reference-image'),
  url: z.string(), // Data URL for image
  position: z.tuple([z.number(), z.number()]).default([0, 0]),
  // Euler rotation [x, y, z] in radians (standard Three.js convention)
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  scale: z.number().min(0).default(1),
}).describe(
  dedent`
  Image node - used to represent a image in the building
  - url: url of the image
  `,
)

export type ImageNode = z.infer<typeof ImageNode>
