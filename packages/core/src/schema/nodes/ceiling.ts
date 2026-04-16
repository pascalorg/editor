import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'
import { ItemNode } from './item'

/**
 * Sub-region of a ceiling at a different height. Used to model
 * stepped ceilings — tray (also called recessed or coffered) ceilings
 * where a central area is inset above the main ceiling plane, and
 * multi-height rooms where an L-shape wing has a taller or shorter
 * ceiling than the rest.
 *
 * At render time, every region's polygon is subtracted from the main
 * ceiling shape as a hole, then drawn as its own flat plane at
 * `region.height`. Regions at a higher height give the classic
 * tray-ceiling look from below; regions at a lower height model
 * soffits / dropped ceiling panels.
 *
 * NOTE: this represents *stepped* ceilings, not smoothly tilted ones.
 * A true vaulted / cathedral ceiling with a continuous slope needs a
 * different representation (a tilted plane with two reference heights)
 * and is tracked separately.
 */
export const CeilingRegion = z.object({
  polygon: z.array(z.tuple([z.number(), z.number()])),
  height: z.number(),
  holes: z.array(z.array(z.tuple([z.number(), z.number()]))).default([]),
})

export type CeilingRegion = z.infer<typeof CeilingRegion>

export const CeilingNode = BaseNode.extend({
  id: objectId('ceiling'),
  type: nodeType('ceiling'),
  children: z.array(ItemNode.shape.id).default([]),
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
  polygon: z.array(z.tuple([z.number(), z.number()])),
  holes: z.array(z.array(z.tuple([z.number(), z.number()]))).default([]),
  height: z.number().default(2.5), // Height in meters
  regions: z.array(CeilingRegion).default([]),
}).describe(
  dedent`
  Ceiling node - used to represent a ceiling in the building
  - polygon: array of [x, z] points defining the ceiling boundary
  - holes: array of polygons representing holes in the ceiling
  - height: height of the main ceiling surface, in metres
  - regions: optional sub-regions at different heights (tray ceilings,
    soffits, multi-height rooms). Each region's polygon is cut out of
    the main ceiling as a hole and drawn as its own flat plane at
    \`region.height\`.
  `,
)

export type CeilingNode = z.infer<typeof CeilingNode>
