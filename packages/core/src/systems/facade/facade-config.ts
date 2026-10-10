import { z } from 'zod'
import { FacadeUnitSchema } from './facade-unit'

export const FacadeSurfaceSchema = z.enum(['interior', 'exterior', 'both'])
export type FacadeSurface = z.infer<typeof FacadeSurfaceSchema>

/**
 * `place`: the unit places the openings. `dress`: the openings already there are
 * kept where they are and as big as they are, and the unit dresses them.
 */
export const FacadeModeSchema = z.enum(['place', 'dress'])
export type FacadeMode = z.infer<typeof FacadeModeSchema>

/**
 * A full snapshot of the unit applied to one wall, plus what keeps it live. It
 * never points back at a catalog row, so editing or archiving the source cannot
 * change an applied facade; `sourceItemId` is attribution only.
 */
export const WallFacadeSchema = z.object({
  unit: FacadeUnitSchema,
  sourceItemId: z.string().optional(),
  /**
   * The facade node whose set gave this wall its unit, and the unit's key in
   * that set. Kept while the wall carries that unit; another unit takes it out.
   */
  set: z.object({ facadeId: z.string(), unit: z.string() }).optional(),
  /** Absent means `place`. */
  mode: FacadeModeSchema.optional(),
  /**
   * What the set's corner chains and bands ask of this wall: the width kept clear
   * at the corners the chain dresses, and how far cladding stays from the floor
   * and the ceiling, where bands run. Kept while the wall carries its unit.
   */
  treated: z
    .object({
      reserve: z.number().optional(),
      reserveEnds: z.array(z.enum(['outside', 'inside'])).optional(),
      below: z.number().optional(),
      above: z.number().optional(),
    })
    .optional(),
  surface: FacadeSurfaceSchema.optional(),
  /** The wall face the runs are measured on and balconies project from. */
  face: z.enum(['front', 'back']).optional(),
  /** Digest of the inputs the last fill resolved against; drift triggers a refill. */
  layoutFrame: z.string().optional(),
  /** Wall slot refs the facade replaced, restored on removal. */
  previousSlots: z.record(z.string(), z.string().nullable()).optional(),
  appliedSlots: z.record(z.string(), z.string()).optional(),
  detached: z.boolean().optional(),
  detachedReason: z.string().optional(),
})
export type WallFacade = z.infer<typeof WallFacadeSchema>

export function readWallFacade(metadata: Record<string, unknown>): WallFacade | undefined {
  const parsed = WallFacadeSchema.safeParse(metadata.proceduralFacade)
  return parsed.success ? parsed.data : undefined
}

/** A facade the resize sync still regenerates. */
export function readLiveWallFacade(metadata: Record<string, unknown>): WallFacade | undefined {
  const facade = readWallFacade(metadata)
  return facade && !facade.detached ? facade : undefined
}
