import { z } from 'zod'
import { MaterialSchema } from '../schema/material'
import { NodeId } from './node-id'

export const paintTool = {
  name: 'paint',
  title: 'Paint',
  description:
    "Give walls, columns, slabs, ceilings, fences, doors, windows or roofs a finish in one call, as the editor's Paint does. Give one finish: color (#rrggbb, painted with the nearest of the library's flat colours, said with how near); material, a library:<id> (find it with search_materials) or scene:<id> ref, or a native material {properties: {color, roughness, metalness}} for an exact finish, kept as a scene material (materialName names a new one) and reused when the scene holds an equal one; or erase: true, back to the surface's default. role picks the surface: a wall's face a or b (or exterior, interior: the face turned out or into its room), its trims aSkirting, bSkirting, aCrown, bCrown, aChairRail, bChairRail, a curtain wall's curtain-frame, curtain-glass, curtain-solid; a column's shaft, base, capital or frame; a slab's surface, side, edge, riser, underside or foundation; a ceiling's surface; a fence's posts, infill, base or rail; a door's panel, frame, glass or hardware; a window's frame or glass; a roof's top, edge or wall. Without a role: both faces of a wall, a column's shaft, a slab's or a ceiling's surface, a whole fence, a door's panel and frame, a window's frame, a roof's top. A wall face is painted whole, over the wall finish of the room it faces; its painted parts keep their own, named in the note. A ceiling shows its finish's colour, not its texture. The result says the finish written, and the scene material when there is one. A target that is not in the scene, a role it lacks or an unknown material refuses the whole call: nothing is painted.",
  input: {
    targets: z.array(NodeId).min(1).max(200).describe('The nodes to paint.'),
    role: z.string().min(1).optional().describe('The surface: see the description.'),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional()
      .describe('A colour, #rrggbb: painted with the nearest library colour.'),
    material: z
      .union([z.string().min(1), MaterialSchema])
      .optional()
      .describe(
        'A library:<id> or scene:<id> ref, or a native material (properties color, roughness, metalness, and an existing texture) kept as a scene material.',
      ),
    materialName: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe(
        'The name of a new native material; an equal one already in the scene keeps its own.',
      ),
    erase: z.literal(true).optional().describe("Back to the surface's default."),
  },
}
