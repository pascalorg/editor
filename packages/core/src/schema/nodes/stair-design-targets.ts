import { z } from 'zod'

export const StairDesignTargets = z.object({
  maxRiserHeight: z.number().positive().default(0.18),
  minimumGoing: z.number().positive().default(0.25),
  targetGoing: z.number().positive().default(0.28),
  minimumHeadroom: z.number().positive().default(2),
})
export type StairDesignTargets = z.infer<typeof StairDesignTargets>
