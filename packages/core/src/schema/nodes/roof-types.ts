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
