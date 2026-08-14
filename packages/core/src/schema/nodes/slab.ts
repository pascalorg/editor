import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import {
  CASTABLE_FIELD_DOCS,
  CastableFields,
  SHUTTERING_FIELD_DOCS,
  ShutteringFields,
} from '../formwork'
import { MaterialSchema } from '../material'
import { ConstructionJointNode } from './construction-joint'
import { FormworkAssemblyNode } from './formwork-assembly'
import { FormworkBoxOutNode } from './formwork-box-out'
import { SurfaceHoleMetadata } from './surface-hole-metadata'

// Edit-time floor for `thickness` — a thinner slab z-fights the ceiling's
// −0.01 underside offset. Applies to edits only; migration writes legacy
// intervals verbatim (including degenerate zero-thickness slabs).
export const MIN_SLAB_THICKNESS = 0.02

export const SlabNode = BaseNode.extend({
  id: objectId('slab'),
  type: nodeType('slab'),
  children: z
    .array(
      z.union([
        FormworkAssemblyNode.shape.id,
        FormworkBoxOutNode.shape.id,
        ConstructionJointNode.shape.id,
      ]),
    )
    .default([]),
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
  /**
   * How many faces of the rim take formwork. One for a plain slab edge; two
   * where the edge is an upstand or a downstand edge beam and concrete pushes
   * on both sides of it.
   */
  edgeFaceCount: z.number().int().min(1).max(2).optional(),
  /** Height of the soffit above the floor it is propped off, in meters. */
  soffitHeightAboveSupport: z.number().finite().nonnegative().optional(),
  /**
   * In-situ load capacity of the slab, kN/m² — what a prop standing on it may
   * safely transmit to it. Optional project data for the prop-versus-capacity
   * check; nothing reads it yet, and stating it changes no other output.
   */
  loadCapacityKnM2: z.number().finite().positive().max(100_000).optional(),
  ...ShutteringFields,
  ...CastableFields,
}).describe(
  dedent`
  Slab node - used to represent a slab/floor in the building
  - children: hosted formwork assemblies and construction joints, in level-space X/Z
  - polygon: array of [x, z] points defining the slab boundary
  - holes: array of [x, z] polygons representing cutouts in the slab
  - holeMetadata: metadata parallel to holes, used to preserve manual and auto-managed cutouts
  - elevation: the walking surface (slab top), in meters above the level plane
  - thickness: grows downward from the surface; the solid occupies [elevation - thickness, elevation]
  - recessed: open recess (pool) whose floor sits at elevation (< 0); the shell walls rise to the level plane
  - autoFromWalls: whether the slab is automatically generated from a closed wall loop
  - edgeFaceCount: rim faces to form — 2 for an upstand or a downstand edge beam
  - soffitHeightAboveSupport: soffit height above the floor it is propped off, in meters
  - loadCapacityKnM2: in-situ load capacity of the slab, kN/m² — what a prop standing on it may safely transmit to it (optional project data for the prop-versus-capacity check)
  ${SHUTTERING_FIELD_DOCS}
  ${CASTABLE_FIELD_DOCS}
  `,
)

export type SlabNode = z.infer<typeof SlabNode>
