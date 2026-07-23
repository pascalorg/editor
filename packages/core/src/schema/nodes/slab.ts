import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'
import { SurfaceHoleMetadata } from './surface-hole-metadata'

// Edit-time floor for `thickness` — a thinner slab z-fights the ceiling's
// −0.01 underside offset. Applies to edits only; migration writes legacy
// intervals verbatim (including degenerate zero-thickness slabs).
export const MIN_SLAB_THICKNESS = 0.02

export const SlabNode = BaseNode.extend({
  id: objectId('slab'),
  type: nodeType('slab'),
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
  // Per-slot material overrides on the unified slot model, mirroring
  // `ShelfNode.slots`. Key = slot id (`surface`), value = a `MaterialRef`
  // (`library:<id>` / `scene:<id>`). Absent = the declared slot default.
  slots: z.record(z.string(), z.string()).optional(),
  polygon: z.array(z.tuple([z.number(), z.number()])),
  holes: z.array(z.array(z.tuple([z.number(), z.number()]))).default([]),
  holeMetadata: z.array(SurfaceHoleMetadata).default([]),
  elevation: z.number().default(0.05), // Walking surface (slab top), meters above the level plane
  thickness: z.number().default(0.05), // Grows downward from the surface
  recessed: z.boolean().default(false),
  autoFromWalls: z.boolean().default(false),
}).describe(
  dedent`
  Slab node - used to represent a slab/floor in the building
  - polygon: array of [x, z] points defining the slab boundary
  - holes: array of [x, z] polygons representing cutouts in the slab
  - holeMetadata: metadata parallel to holes, used to preserve manual and auto-managed cutouts
  - elevation: the walking surface (slab top), in meters above the level plane
  - thickness: grows downward from the surface; the solid occupies [elevation - thickness, elevation]
  - recessed: open recess (pool) whose floor sits at elevation (< 0); the shell walls rise to the level plane
  - autoFromWalls: whether the slab is automatically generated from a closed wall loop
  `,
)

export type SlabNode = z.infer<typeof SlabNode>
