import { z } from 'zod'

/** What the scene holds after a call that changes it (agent-operations `achievedChanges`). */
export const achievedOutput = z.object({
  created: z.record(z.string(), z.number()),
  updated: z.number(),
  deleted: z.record(z.string(), z.number()),
  unchanged: z.literal(true).optional(),
})
