import { z } from 'zod'

export const SurfaceHoleMetadata = z.object({
  // Stair/elevator auto-openings use stairId/elevatorId so sync can replace only its own holes.
  source: z.enum(['manual', 'stair', 'elevator', 'room', 'floor-opening']).default('manual'),
  openingId: z.string().optional(),
  stairId: z.string().optional(),
  elevatorId: z.string().optional(),
})

export type SurfaceHoleMetadata = z.infer<typeof SurfaceHoleMetadata>
