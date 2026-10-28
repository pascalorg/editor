import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

const INCH = 0.0254
const PlanPoint = z.tuple([z.number(), z.number()])

export const FootingShape = z.enum(['strip', 'pad'])
export type FootingShape = z.infer<typeof FootingShape>

/** The sizes a new footing takes (IRC R403.1): a strip 12 × 8 in, a pad 24 × 24 × 10 in. */
export const FOOTING_SIZES = {
  strip: { width: 12 * INCH, thickness: 8 * INCH },
  pad: { width: 24 * INCH, length: 24 * INCH, thickness: 10 * INCH },
} as const

export const FootingNode = BaseNode.extend({
  id: objectId('footing'),
  type: nodeType('footing'),
  shape: FootingShape.default('strip'),
  start: PlanPoint.optional(),
  end: PlanPoint.optional(),
  center: PlanPoint.optional(),
  width: z.number().positive().default(FOOTING_SIZES.strip.width),
  length: z.number().positive().optional(),
  rotation: z.number().optional(),
  thickness: z.number().positive().default(FOOTING_SIZES.strip.thickness),
  depth: z.number().positive().optional(),
}).describe(
  dedent`
  Footing node - a concrete footing poured under the building's lowest level, its height derived
  from the building's foundation record (metadata.foundation), never stored
  - shape: 'strip' runs start → end (level-local plan points, like a wall); 'pad' stands at center
  - width: across a strip; a pad's side along its local x
  - length: a pad's side along its local z (absent = square)
  - rotation: a pad's turn about Y, radians
  - thickness: the footing's own depth of concrete, metres
  - depth: its bottom under the grade beside it, metres (absent = the building's)
  `,
)

export type FootingNode = z.infer<typeof FootingNode>
