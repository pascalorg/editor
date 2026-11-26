import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { ROCK_LIMITS } from './rock-limits'

export { ROCK_LIMITS } from './rock-limits'

const Point = z.tuple([z.number().finite(), z.number().finite()])

/**
 * A natural rock mass standing on its Site's ground, in the Site's frame: the polygon is where it
 * meets the ground and the most it ever spreads; its crown reaches `height` above the lowest
 * ground under it. The stored polygon, seed and look parameters determine its irregular shape, so
 * it is stored as a few numbers, never as a mesh.
 */
export const RockNode = BaseNode.extend({
  id: objectId('rock'),
  type: nodeType('rock'),
  polygon: z.array(Point).min(ROCK_LIMITS.minPoints).max(ROCK_LIMITS.maxPoints),
  height: z.number().finite().min(ROCK_LIMITS.minHeight).max(ROCK_LIMITS.maxHeight).default(2.4),
  seed: z.number().int().default(1),
  gen: z.literal(1).default(1),
  rockType: z
    .enum(['boulder', 'fjord', 'granite', 'volcanic', 'river', 'stacked', 'stepping'])
    .default('boulder'),
  weathering: z.number().finite().min(0).max(1).default(0.35),
  moss: z.number().finite().min(0).max(1).default(0),
  form: z.enum(['faceted', 'weathered']).default('faceted'),
  strata: z.boolean().default(false),
  lichen: z.number().finite().min(0).max(1).default(0),
}).describe(
  'Rock: a natural mass within its polygon footprint (Site metres), with height above the lowest ground beneath it. seed fixes the shape; rockType, weathering, moss, form, strata and lichen control its surface.',
)

export type RockNode = z.infer<typeof RockNode>
