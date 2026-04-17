import { z } from 'zod'

export const SurfaceHoleMetadata = z.object({
  source: z.enum(['manual', 'stair']).default('manual'),
  stairId: z.string().optional(),
})

export type SurfaceHoleMetadata = z.infer<typeof SurfaceHoleMetadata>
