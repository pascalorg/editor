import { z } from 'zod'

export const HangerOverrides = z.record(
  z.string(),
  z.object({
    fraction: z.number().finite().min(0).max(1).optional(),
    skipped: z.boolean().optional(),
    hostId: z.string().optional(),
  }),
)
