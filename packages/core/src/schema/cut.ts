import { z } from 'zod'

/**
 * Cut intents (F5b, `editor-fidelity-foundations.md` §2.2), frozen by plan
 * item DT-03a. One contract for every cut: a cutter publishes what it removes
 * from a face of its host through `capabilities.cuts`, and each host kernel
 * intersects the intents with its own faces. No host reads them yet (DT-03b
 * walls, ceilings and slabs; RL-02 roofs); today's cut paths are unchanged.
 *
 * Frames (frozen). `shape` is in the named patch's surface chart (F0
 * `SurfaceAnchor`): [u, v] metres, u along the patch frame's +X and
 * v = normal × u.
 * - wall `front`: u = wall-local x (from `start`), v = wall-local y (the frame
 *   door and window `position` use); the normal is +n.
 * - wall `back`: the normal is −n, so u runs from `end`: u = length − x.
 * - roof `facet:<id>:covering`: u along the facet's eave, v up the slope, both
 *   measured on the slope.
 * - Horizontal hosts are the one exception: a slab `top` and a ceiling
 *   `underside` take plan [x, z] in the host's local plan, the space of its
 *   `polygon` and stored `holes`, never the chart's mirrored [x, −z].
 */

const V2 = z.tuple([z.number().finite(), z.number().finite()])

export const CutShape = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('polygon'), ring: z.array(V2).min(3) }),
  // A circle stays a circle in the face, so curved hosts can cut it exactly.
  z.object({ kind: z.literal('circle'), center: V2, radius: z.number().finite().positive() }),
])
export type CutShape = z.infer<typeof CutShape>

export const CutIntent = z.object({
  host: z.object({
    nodeId: z.string().min(1),
    /** A `SurfacePatchId` of the host, or a wider recipe surface id. */
    surfaceId: z.string().min(1),
    /** Cut one generated part (F3) of the host instead of its body. */
    partKey: z.templateLiteral([z.string(), '/', z.string(), '/', z.string()]).optional(),
  }),
  shape: CutShape,
  /**
   * `through` removes the host's whole thickness; a number is metres along
   * −normal from the named face, so a pocket keeps the backing behind it.
   */
  depth: z.union([z.literal('through'), z.number().finite().positive()]),
  /**
   * Radians between each side of the cut and the face normal. Positive
   * narrows with depth (a splayed reveal is widest at the face).
   */
  taper: z
    .number()
    .gt(-Math.PI / 2)
    .lt(Math.PI / 2)
    .optional(),
})
export type CutIntent = z.infer<typeof CutIntent>
