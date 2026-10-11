import { z } from 'zod'
import { MaterialSchema } from '../schema/material'
import { NodeId } from './node-id'

export const paintTool = {
  name: 'paint',
  title: 'Paint',
  description:
    "Give walls, columns, slabs, ceilings, fences, doors, windows or roofs a finish in one call, as the editor's paint does: a colour (#rrggbb, the nearest of the library's flat colours, said with how near), an existing library:<id> or scene:<id> material, an inline native MaterialSchema for exact PBR, or erase the slot override. Inline material: {properties:{color:'#rrggbb',roughness:0.5,metalness:0}}; optional materialName names a newly persisted material. Equal materials reuse their scene ref; the result returns finish, materialId and material, and createdMaterial only when created. Inline authoring requires a host with a scene material registry. No new image service or organic woodgrain generation. role picks the surface: a wall's faces a and b (or exterior, interior), its skirting, crown or chair rail; a column's shaft, base, capital or frame; a slab's surface, side, edge, riser, underside or foundation; a ceiling's surface; a fence's posts, infill, base or rail; a door's panel, frame, glass or hardware; a window's frame or glass; a roof's top, edge or wall (gable/body, independent of top). Without a role: both faces of a wall, a column's shaft, a slab's or ceiling's surface, a whole fence, a door's panel and frame, a window's frame, a roof's top. Ceilings render a flat colour from the finish, not PBR textures; erase removes the surface slot override, retaining any legacy material fallback. Use current native node IDs, not group IDs. An unknown material, role or missing target refuses the entire paint call: no target in that call was painted. Read the current scene before retrying retired wall IDs. A run_batch may apply successful siblings while refusing this call; inspect each result, not just the batch status.",
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
        'An existing library:<id> or scene:<id> ref, or an exact native MaterialSchema (properties color, roughness, metalness and existing texture). Inline materials are persisted and reused by value; no image generation or organic woodgrain.',
      ),
    materialName: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe(
        'Optional name for a newly created inline material; does not rename a reused material.',
      ),
    erase: z.literal(true).optional().describe('Back to the surface default.'),
  },
}
