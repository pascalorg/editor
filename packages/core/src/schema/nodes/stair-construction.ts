import { z } from 'zod'

/** Explicit construction details; absence preserves the original stair body. */
export const StairConstruction = z.object({
  mode: z.enum(['solid', 'waist', 'open', 'side-stringers', 'center-stringer']).default('open'),
  waistThickness: z.number().positive().default(0.25),
  treadThickness: z.number().positive().default(0.05),
  riserThickness: z.number().positive().default(0.02),
  nosing: z.number().nonnegative().default(0.025),
  finishThickness: z.number().nonnegative().default(0),
  closedRisers: z.boolean().default(false),
  stringerWidth: z.number().positive().default(0.08),
  stringerDepth: z.number().positive().default(0.25),
})
export type StairConstruction = z.infer<typeof StairConstruction>
