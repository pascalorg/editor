import { z } from 'zod'

/**
 * A painted part of a flat surface, in level XZ: a room floor
 * (`zone.floor.regions`), a room's ceiling (`zone.ceiling.regions`) or a manual
 * ceiling (`ceiling.regions`). Later entries win; each surface clips its
 * regions to what it covers.
 */
export const SurfacePaintRegion = z.object({
  id: z.string(),
  polygon: z.array(z.tuple([z.number(), z.number()])),
  finish: z.union([z.string(), z.record(z.string(), z.unknown())]),
})

export type SurfacePaintRegion = z.infer<typeof SurfacePaintRegion>
