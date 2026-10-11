import { z } from 'zod'
import { WINDOW_STYLES } from '../building/opening-style-presets'
import { WindowType } from '../schema/nodes/opening-types'
import { measurement } from './measurement'

export const addCornerWindowTool = {
  name: 'add_corner_window',
  title: 'Add corner window',
  description:
    "A window that wraps the corner where two walls meet: one window on each wall, both running to the corner and joined, the glass fused at the corner (post none, the default) or meeting at a thin post (post post). Any angle the walls make, a bay's 135° as well as a square or an acute corner. The corner is the point the two walls end at ([x, z], as get_walls gives their ends); width is how far the glass runs along each wall from the corner, the same on both unless widths names a wall. Each side is placed by add_window's rules (height, sillHeight, windowType, style the same on both sides; with no sillHeight, centred on the lower of the two walls). Refused with a code: no_corner where no two walls end at the point, corner_ambiguous where more than two do (name two with wallIds), corner_angle for a corner nearly folded back or nearly straight, width_exceeds_wall. Returns windowIds and wallIds; the editor's window panel shows the pair under Corner.",
  input: {
    corner: z
      .array(z.number())
      .length(2)
      .describe("The point where the two walls meet, [x, z] in the level's plan (m)."),
    levelId: z
      .string()
      .optional()
      .describe('The level of the walls (default: any level with walls ending there).'),
    wallIds: z
      .array(z.string())
      .length(2)
      .optional()
      .describe('The two walls, when more than two end at the corner.'),
    width: measurement('length', 'm', {
      positive: true,
      description: 'How far the glass runs along each wall from the corner (default 1.2 m).',
    }).optional(),
    widths: z
      .record(z.string(), z.number().positive())
      .optional()
      .describe('A width for a wall by its id, over width (e.g. { "wall_a": 1.6 }).'),
    height: measurement('length', 'm', {
      positive: true,
      description: 'Window height (default 1.5 m).',
    }).optional(),
    sillHeight: measurement('length', 'm', {
      min: 0,
      description:
        'Height from the floor to the bottom of the window (default: centred vertically on the lower of the two walls, the same on both sides).',
    }).optional(),
    post: z
      .enum(['none', 'post'])
      .optional()
      .describe(
        'none: the glass fused at the corner (default); post: the glass meets at a thin post.',
      ),
    windowType: WindowType.optional().describe(
      "How it opens (default fixed), the window panel's Type row; the fused corner is a fixed window's.",
    ),
    style: z
      .enum(WINDOW_STYLES)
      .optional()
      .describe("The panes' look on each side (rows and columns), the window panel's Style row."),
  },
}
