import { z } from 'zod'
import { levelTarget } from './levels'
import { measurement } from './measurement'

/**
 * A wall's bend: Hawkesbury run 2's rounded corner could only be made with apply_patch, its sign
 * documented nowhere (2026-10-03).
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
    'Add a single wall between two points on a level, straight or, with curveOffset, an arc. Refused with a code: a level that is not a storey (a declared roof level), and a wall shorter than 1 cm.',
  input: {
    start: planPoint('start'),
    end: planPoint('end'),
    thickness: measurement('length', 'm', {
      positive: true,
      description: 'Wall thickness (default 0.1 m).',
    }).optional(),
    height: measurement('length', 'm', {
      positive: true,
      description: "Wall height (default: the storey's height).",
    }).optional(),
    curveOffset: WALL_CURVE_OFFSET_INPUT.optional(),
    ...levelTarget,
  },
}
