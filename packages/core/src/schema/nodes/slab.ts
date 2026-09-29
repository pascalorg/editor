import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'
import { SurfaceHoleMetadata } from './surface-hole-metadata'

// Edit-time floor for `thickness` — a thinner slab z-fights the ceiling's
// −0.01 underside offset. Applies to edits only; migration writes legacy
// intervals verbatim (including degenerate zero-thickness slabs).
export const MIN_SLAB_THICKNESS = 0.02
// A ground-bearing base plate has no ceiling under it, so it may be thinner;
// it is never zero (a zero-thickness plate renders as a hole).
export const MIN_GROUND_FLOOR_THICKNESS = 0.01
export const DEFAULT_SLAB_ELEVATION = 0.05

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
  elevation: z.number().default(DEFAULT_SLAB_ELEVATION), // Walking surface (slab top), meters above the level plane
  floorHeight: z
    .number()
    .finite()
    .optional()
    .describe(
      'Ground-contact base plate only: authored floor top in level-local meters; upper floors change thickness to raise their top.',
    ),
  referenceFloorElevation: z
    .number()
    .finite()
    .optional()
    .describe(
      'Base plate reference walking surface in level-local meters. Absent follows terrain and support. The resolved top minus this reference is the footprint lift; only an atomic floor-reference rebase may change it.',
    ),
  foundation: z
    .object({
      type: z.enum(['solid', 'none']),
      material: z.union([z.string(), MaterialSchema]).optional(),
    })
    .optional(),
  thickness: z.number().default(0.05), // Grows downward from the surface
  recessed: z.boolean().default(false),
  recessedRimElevation: z.number().finite().optional(),
  fillToTerrain: z.boolean().optional(),
  boundary: z.literal('auto').optional(),
  support: z.literal('open').optional(),
  plateRole: z.enum(['base', 'platform', 'sunken']).optional(),
  railing: z
    .array(
      z.object({
        start: z.tuple([z.number(), z.number()]),
        end: z.tuple([z.number(), z.number()]),
      }),
    )
    .optional(),
  zoneIds: z.array(z.string()).optional(),
  associatedZoneIds: z.array(z.string()).optional(),
  autoFromWalls: z.boolean().default(false),
}).describe(
  dedent`
  Slab node - used to represent a slab/floor in the building
  - polygon: array of [x, z] points defining the slab boundary
  - holes: array of [x, z] polygons representing cutouts in the slab
  - holeMetadata: metadata parallel to holes, used to preserve manual and auto-managed cutouts
  - elevation: the walking surface (slab top), in meters above the level plane
  - floorHeight: ground-contact base plate authored top in level-local meters; absent follows terrain. Upper base plates use thickness with a fixed underside.
  - referenceFloorElevation: base plate reference top (level-local meters); absent follows terrain and support. Ordinary floor edits keep this datum.
  - associatedZoneIds: rooms whose authored construction overlaps this manual slab, resolved once during legacy migration.
  - foundation: base plate exterior support to terrain; solid or none, with its own material (default concrete).
  - thickness: grows downward from the surface; the solid occupies [elevation - thickness, elevation]
  - recessed: open recess (pool) whose floor sits at elevation
  - recessedRimElevation: optional rim anchor for a raised/lowered recess; absent means the level plane
  - fillToTerrain: manual slabs only; extends a solid slab's perimeter downward to terrain without changing its flat top or authored thickness
  - autoFromWalls: whether the slab is automatically generated from a closed wall loop
  `,
)

export type SlabNode = z.infer<typeof SlabNode>
