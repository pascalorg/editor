import { z } from 'zod'
import { FOUNDATION_BY_REGION_NOTE } from '../lib/foundation-construction'
import { levelTarget } from './levels'
import { measurement } from './measurement'
import { NodeId } from './node-id'

const wallTypeInput = z
  .string()
  .min(1)
  .describe(
    'Assembly type id from get_walls.wallTypes: a built-in preset or custom- project wall type. Copies its layers and total thickness in metres, overriding thickness. Unknown ids: unknown_wall_type.',
  )

/**
 * A wall's bend: a rounded corner could only be made with apply_patch, its sign documented
 * nowhere.
 */
export const WALL_CURVE_OFFSET_INPUT = measurement('length', 'm', {
  description:
    "Bends the wall into an arc: the sagitta, from the middle of the straight line start→end to the middle of the arc. Positive bows the middle toward the back face (the −normal side, normal (−Δz, Δx) of start→end), the arc's centre on the front side; negative the other way. At most half the chord (a half circle); more is clamped. A quarter round of radius r at a corner: end both walls r short of the corner and join their ends with an arc of curveOffset ±0.293·r, the sign that bows it outward.",
})

const planPoint = (end: string) =>
  z.array(z.number()).length(2).describe(`[x, z] ${end} point in level coordinates (metres).`)

export const addWallTool = {
  name: 'add_wall',
  title: 'Add wall',
  description:
    'Add a single wall between two points on a level, straight or, with curveOffset, an arc. type applies a preset or project wall assembly including its thickness (unknown_wall_type for an unknown id). wallType railing builds the Build panel guard: default post-and-rail, 0.9144 m high, thickness from railing.postSize, no assembly or foundation. Its doors are gaps; windows refuse railing_window, skirting refuses railing_wall. railing settings on a standard wall refuse not_a_railing; type on a railing refuses railing_wall. Refused with a code: a level that is not a storey (a declared roof level), and a wall shorter than 1 cm. On a level below grade, a standard wall against the ground (on the outline of the walls of the level) is a foundation wall, ' +
    FOUNDATION_BY_REGION_NOTE +
    '; a partition inside the outline is an ordinary wall; the result says which.',
  input: {
    start: planPoint('start'),
    end: planPoint('end'),
    type: wallTypeInput.optional(),
    wallType: z
      .enum(['standard', 'railing'])
      .optional()
      .describe(
        'Wall kind (default standard). railing is an open guard with its own height and post-derived thickness.',
      ),
    railing: z
      .object({
        style: z
          .enum(['balusters', 'post-and-rail', 'cable', 'boards', 'glass', 'metal'])
          .optional()
          .describe(
            'Guard style (default post-and-rail); omitted member sizes use the style defaults from the Build panel.',
          ),
        postSpacing: measurement('length', 'm', {
          positive: true,
          description: 'Maximum post spacing on centre (default 1.8288 m).',
        }).optional(),
        postSize: measurement('length', 'm', {
          positive: true,
          description:
            'Square post side; sets wall thickness, overriding thickness. Default 0.0889 m for wood styles, 0.0508 m cable, 0.0381 m glass/metal.',
        }).optional(),
        infillSize: measurement('length', 'm', {
          positive: true,
          description:
            'Baluster/bar square side, cable diameter, board face height or glass thickness. Default by style: post-and-rail 0.0381, balusters 0.03175, cable 0.009525, boards 0.1397, glass 0.0127, metal 0.015875 m.',
        }).optional(),
        infillGap: measurement('length', 'm', {
          min: 0,
          description:
            'Clear infill gap. Default 0.0889 m wood styles, 0.066675 m cable, 0 m glass, 0.09525 m metal.',
        }).optional(),
        bottomClearance: measurement('length', 'm', {
          min: 0,
          description:
            'Clearance over the floor. Default 0.0889 m post-and-rail/boards, 0.05715 m balusters, 0.06985 m cable, 0.0762 m glass/metal.',
        }).optional(),
        cap: z
          .boolean()
          .optional()
          .describe('2x6 top cap on post-and-rail/boards styles (default true).'),
      })
      .optional()
      .describe(
        'Railing settings, only with wallType railing. All lengths in metres; omitted fields follow the selected style.',
      ),
    thickness: measurement('length', 'm', {
      positive: true,
      description:
        'Wall thickness (default 0.1 m; a wall against the ground on a level below grade, given none, is a foundation wall ' +
        FOUNDATION_BY_REGION_NOTE +
        '; a partition inside it is an ordinary wall).',
    }).optional(),
    height: measurement('length', 'm', {
      positive: true,
      description: "Wall height (default: the storey's height; a railing 0.9144 m / 36 in).",
    }).optional(),
    curveOffset: WALL_CURVE_OFFSET_INPUT.optional(),
    ...levelTarget,
  },
}

export const setWallTypeTool = {
  name: 'set_wall_type',
  title: 'Set wall type',
  description:
    'Apply an assembly type to existing standard walls, copying its layers and total thickness as the wall panel does. type null clears the assembly and keeps thickness. All walls change together. Refused with unknown_wall_type for an unknown type id, target_not_found for a missing wall, curtain_wall or railing_wall for walls that take no assembly.',
  input: {
    wallIds: z.array(NodeId).min(1),
    type: wallTypeInput.nullable(),
  },
}
