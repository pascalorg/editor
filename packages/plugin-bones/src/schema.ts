import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'
import { DEFAULT_LENGTH, LUMBER_ORIENTATIONS, LUMBER_SIZES } from './lumber'

/**
 * A single piece of dimensional lumber placed loose in the scene — the atom of
 * the Bones plugin. Composed from the public `BaseNode` exactly like built-in
 * kinds; `objectId`/`nodeType` come from `@pascal-app/core`, so this persists
 * in scene JSON with no host internals.
 *
 * Inferred framing (studs/plates/headers generated from walls) will use its own
 * `bones:framing` kind — see SPEC.md. Keeping the loose member its own kind
 * means hand-placed lumber survives re-inference untouched.
 */
export const LumberNode = BaseNode.extend({
  id: objectId('lumber'),
  type: nodeType('bones:lumber'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  /** Nominal size — actual dressed dimensions come from the catalog. */
  size: z.enum(LUMBER_SIZES).default('2x4'),
  /** Member length in meters (stock default: 8 ft). */
  length: z.number().positive().default(DEFAULT_LENGTH),
  /** stud = vertical, flat = plate-like, edge = joist-like. */
  orientation: z.enum(LUMBER_ORIENTATIONS).default('stud'),
}).describe(
  `Dimensional lumber member (Bones plugin)
  - size: nominal US lumber size (2x4, 2x6, ... 6x6); rendered at actual dressed dimensions
  - length: member length in meters
  - orientation: stud (vertical), flat (lying on wide face, like a plate), edge (on narrow edge, like a joist)
  - position: base center point in level coordinates
  - rotation: Y rotation spins the member in plan`,
)

export type LumberNode = z.infer<typeof LumberNode>
