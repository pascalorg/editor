import { z } from 'zod'
import { measurement } from './measurement'
import { NodeId } from './node-id'

export const setFinishScriptTool = {
  name: 'set_finish_script',
  title: 'Set finish script',
  description:
    "Build a finish from a three.js module on what already stands: tiles with their joints, panelling, boards, a herringbone floor, a terrace's paving. targetId names what it finishes: a room with surface 'walls' (each wall face that looks into the room, only the room's own stretch of a wall that runs on past it, so a bathroom's tile stops where the bathroom does) or surface 'floor' (the room's floor); a wall with its face, a or b (the whole face); a slab (its top). A wall face's module receives, in wall-local metres (x along the wall from its start, y up from the face's base, z out of the face), params.outline ({ x0, y0, x1, y1 }: the stretch it builds), params.holes (the doors and windows cutting it, each { x0, y0, x1, y1 }), params.base (the floor along the face, [[x, y], …]) and params.thickness; a floor's or a slab's receives params.polygon ([[x, z], …]) and params.holes in the level's plan x/z, metres, y = 0 its surface. Lay the finish out from there: Pascal cuts the build to the outline or polygon and their holes, so rows may run past the edges; name materials slot_<finish>. toHeight stops a wall finish that many metres above the face's base, the face's paint showing above it (a splashback, a wainscot, tile to 2.1 m). Pascal rebuilds the finish when the wall, its openings or the room change. A finish built to the top owns its face's colours: paint on it is refused until it is removed. A wall face takes one module: a face shared with another room whose stretch already carries one is skipped and named in the result. remove: true takes the finish off, back to the surface's paint. The result says what was built and what was skipped, and why.",
  input: {
    targetId: NodeId.describe('The room, wall or slab to finish.'),
    surface: z
      .enum(['walls', 'floor'])
      .optional()
      .describe('On a room: its walls or its floor. Required for a room, not read otherwise.'),
    face: z
      .enum(['a', 'b'])
      .optional()
      .describe('On a wall: the face to build, a or b. Required for a wall.'),
    code: z
      .string()
      .min(1)
      .max(48_000)
      .optional()
      .describe('The three.js module. Required unless remove.'),
    toHeight: measurement('length', 'm', {
      description:
        "On walls: where the finish stops, metres above the face's base (default: the full height).",
      positive: true,
    }).optional(),
    remove: z.literal(true).optional().describe('Take the finish off instead.'),
  },
}
