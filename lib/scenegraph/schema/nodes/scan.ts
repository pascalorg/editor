import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeId, nodeType } from '../base'

export const ScanNode = BaseNode.extend({
  id: nodeId('scan'),
  type: nodeType('scan'),
  url: z.string(), // Data URL for 3D model
  // position and rotation are in level coordinate system (scan can be adjusted around any axis)
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  scale: z.number().min(0).default(1),
}).describe(
  dedent`
  Scan node - used to represent a scan in the building
  - position: position of the scan in level coordinate system
  - rotation: rotation of the scan in level coordinate system
  - scale: scale of the scan
  `,
)

export type ScanNode = z.infer<typeof ScanNode>
