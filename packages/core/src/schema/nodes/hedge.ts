import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { HEDGE_LIMITS } from './hedge-limits'

export { HEDGE_LIMITS } from './hedge-limits'

const coordinate = z
  .number()
  .finite()
  .min(-HEDGE_LIMITS.maxCoordinate)
  .max(HEDGE_LIMITS.maxCoordinate)
const Point = z.tuple([coordinate, coordinate])

/** An opening left in the hedge for a gate or a path: its centre, in metres along the line, and its width. */
export const HedgeGap = z.object({
  at: z
    .number()
    .finite()
    .min(0)
    .max(HEDGE_LIMITS.maxCoordinate * HEDGE_LIMITS.maxPoints),
  width: z.number().finite().min(HEDGE_LIMITS.minGapWidth).max(HEDGE_LIMITS.maxGapWidth),
})

/**
 * A hedge planted along a line on its Site's ground, in the Site's frame. It is stored as the few
 * numbers below, never as a mesh: its form is a function of them, of `seed` and of the generator
 * version `gen`, so a better generator does not silently change a stored garden.
 */
export const HedgeNode = BaseNode.extend({
  id: objectId('hedge'),
  type: nodeType('hedge'),
  path: z.array(Point).min(HEDGE_LIMITS.minPoints).max(HEDGE_LIMITS.maxPoints),
  closed: z.boolean().default(false),
  curve: z.boolean().default(false),
  height: z.number().finite().min(HEDGE_LIMITS.minHeight).max(HEDGE_LIMITS.maxHeight).default(1.2),
  width: z.number().finite().min(HEDGE_LIMITS.minWidth).max(HEDGE_LIMITS.maxWidth).default(0.7),
  clip: z.number().finite().min(0).max(1).default(1),
  leafSize: z
    .number()
    .finite()
    .min(HEDGE_LIMITS.minLeafSize)
    .max(HEDGE_LIMITS.maxLeafSize)
    .default(0.09),
  leafColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#4c8a32'),
  gaps: z.array(HedgeGap).max(HEDGE_LIMITS.maxGaps).default([]),
  seed: z.number().int().default(1),
  gen: z.number().int().min(1).max(999).default(1),
}).describe(
  'Hedge: a planted run along a line on the Site ground (Site metres). path is its centreline (2 to 64 points; closed rings back to the first; curve bends it smoothly through the points, otherwise sides are straight and corners rounded), height and width its size, clip 0 left to grow to 1 freshly clipped, leafSize and leafColor its foliage, gaps the openings left along the line (at = metres from the start, width), seed fixes the irregular form, gen names the generator that draws it.',
)

export type HedgeNode = z.infer<typeof HedgeNode>
export type HedgeGap = z.infer<typeof HedgeGap>
