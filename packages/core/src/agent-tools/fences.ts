import { z } from 'zod'
import { FenceBaseStyle, FenceStyle } from '../schema/nodes/fence-types'
import { levelTarget } from './levels'
import { measurement } from './measurement'

export const addFenceTool = {
  name: 'add_fence',
  title: 'Add fence',
  description:
    "Add a fence along points on a level: one fence per side, a whole run or a lot's boundary (closed) in one call. Privacy (solid panels) by default; picket for a picket fence, slat for vertical slats, rail for open rails, horizontal for cladding boards, guard for a deck's barrier. Fences stand on the level, as the editor's fence tool puts them. Refused with a code: a side shorter than 10 cm (fence_too_short), a roof level (roof_level).",
  input: {
    points: z
      .array(z.array(z.number()).length(2))
      .min(2)
      .max(64)
      .describe(
        '[x, z] points in level coordinates (metres), the fence running through them in order.',
      ),
    closed: z
      .boolean()
      .optional()
      .describe("Close the run back to the first point, as a lot's boundary."),
    height: measurement('length', 'm', {
      positive: true,
      description: 'Fence height (default 1.8 m).',
    }).optional(),
    style: FenceStyle.optional().describe(
      'slat | rail | privacy | horizontal | guard | picket (default privacy).',
    ),
    baseStyle: FenceBaseStyle.optional().describe(
      'grounded (default: a kickboard on the ground), floating (the panel held off the ground on its posts) or raised (a bottom rail held above the ground, the posts to the ground: a deck guard).',
    ),
    materialPreset: z
      .string()
      .optional()
      .describe('A library material (library:<id>), found with search_materials.'),
    ...levelTarget,
  },
}
