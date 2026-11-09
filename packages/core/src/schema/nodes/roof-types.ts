import { z } from 'zod'

// Roof shapes, in a file with no other dependency: agent tool contracts validate against them
// without loading the node schemas.
export const RoofType = z.enum([
  'hip',
  'gable',
  'shed',
  'gambrel',
  'dutch',
  'mansard',
  'flat',
  'conical',
  'barrel',
])

export type RoofType = z.infer<typeof RoofType>

/**
 * How a roof plane's rafter tails are cut at its eaves, and so the fascia over them: `plumb`
 * (vertical, the fascia plumb), `square` (square to the slope, the fascia with it) or `plumb-level`
 * (plumb, with a level cut under it for a soffit nailed up flat: a boxed eave).
 */
export const RoofEaveCut = z.enum(['plumb', 'square', 'plumb-level'])

export type RoofEaveCut = z.infer<typeof RoofEaveCut>
