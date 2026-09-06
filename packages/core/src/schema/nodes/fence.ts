import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

/**
 * 'guard' — a deck guard built the way the AWC's Deck Construction Guide
 * (DCA 6) draws one: 4x4 posts no more than `postSpacing` apart, a 2x6 cap
 * rail flat on top, a 2x4 top rail on edge under it, and the infill
 * `guardInfill` chooses — 2x2 balusters on a 2x4 bottom rail at a ≤ 4 in
 * clear gap (IRC R312.1.3), ½ in cables `slatGap` apart, or horizontal
 * boards `slatGap` apart. `startPost` / `endPost` false leave that end's
 * post out so the rails die into a post already standing there (a porch's
 * 6x6); `postThrough` runs the posts past the cap with a cap of their own.
 */
export const FenceStyle = z.enum(['slat', 'rail', 'privacy', 'horizontal', 'guard'])
export const FenceGuardInfill = z.enum(['balusters', 'cable', 'boards'])
/**
 * 'grounded' — a kickboard on the ground; 'floating' — no base, the panel
 * held `groundClearance` up on posts that reach the ground; 'raised' — the
 * base is a BOTTOM RAIL held `groundClearance` above the ground with the
 * infill ending on it, the posts to the ground: a deck guard (IRC R312 —
 * pickets between a top and a bottom rail, the gap under the rail below 4 in).
 */
export const FenceBaseStyle = z.enum(['floating', 'grounded', 'raised'])
export const FencePostCap = z.enum(['none', 'flat', 'pyramid'])

export const FenceNode = BaseNode.extend({
  id: objectId('fence'),
  type: nodeType('fence'),
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
  // Unified paint-slot refs (`scene:`/`library:` MaterialRef per slot id),
  // matching the slot model items/slab/shelf use. Absent = declared default.
  slots: z.record(z.string(), z.string()).optional(),
  start: z.tuple([z.number(), z.number()]),
  end: z.tuple([z.number(), z.number()]),
  // Optional spline control points in level coordinate meters. When present
  // (>= 2 points) the fence centerline is a smooth Catmull-Rom curve through
  // these points and start/end/curveOffset no longer define the centerline.
  // start/end are kept in sync with the first/last path point so consumers
  // that read endpoints (handles, bbox, miter references) stay valid. Absent =
  // the straight or single-arc fence defined by start/end (+ curveOffset).
  path: z.array(z.tuple([z.number(), z.number()])).optional(),
  // Optional per-control-point tangent handles, parallel to `path` (same
  // length when present). Each entry is the OUT-handle offset vector [dx, dy]
  // from its path point, in level meters; the IN handle is its mirror so the
  // curve stays smooth through the point. `null` = use the automatic
  // Catmull-Rom tangent for that point. Only meaningful for spline fences.
  tangents: z.array(z.tuple([z.number(), z.number()]).nullable()).optional(),
  height: z.number().default(1.8),
  thickness: z.number().default(0.08),
  // Persisted slab-support host — the fence sits on that slab's walking
  // surface (see ItemNode.supportSlabId for the host rules).
  supportSlabId: z.string().optional(),
  // Manual vertical offset from the elected slab or level support. This moves
  // the complete fence body without changing its height.
  supportOffset: z.number().finite().optional(),
  curveOffset: z.number().optional(),
  baseHeight: z.number().default(0.22),
  postSpacing: z.number().default(2),
  postSize: z.number().default(0.1),
  topRailHeight: z.number().default(0.04),
  groundClearance: z.number().default(0),
  edgeInset: z.number().default(0.015),
  // Reveal between the boards of a `horizontal` fence (0 = flush cladding).
  slatGap: z.number().default(0.01),
  // Topper drawn on each `horizontal`-fence post.
  postCap: FencePostCap.default('pyramid'),
  baseStyle: FenceBaseStyle.default('grounded'),
  showInfill: z.boolean().default(true),
  // `guard` style only — see FenceStyle.
  guardInfill: FenceGuardInfill.default('balusters'),
  startPost: z.boolean().default(true),
  endPost: z.boolean().default(true),
  postThrough: z.boolean().default(false),
  color: z.string().default('#ffffff'),
  style: FenceStyle.default('slat'),
}).describe(
  dedent`
  Fence node - used to represent a fence segment in the building/site level coordinate system
  - start/end: fence endpoints in level coordinate system
  - path: optional list of [x, y] points; when set (>= 2) the centerline is a smooth spline through them
  - tangents: optional per-point handle vectors (parallel to path); null entries fall back to the automatic tangent
  - height/thickness: overall fence dimensions in meters
  - supportSlabId: optional slab host; the fence stands on that slab's walking surface (elevation)
  - supportOffset: manual vertical offset from the elected support surface
  - curveOffset: midpoint sagitta offset used to bend the fence into an arc (ignored when path is set)
  - baseHeight/postSpacing/postSize/topRailHeight: exact geometric controls from the plan3D fence model
  - groundClearance/edgeInset/baseStyle: fence support and inset configuration ('raised': the base is a bottom rail groundClearance above the ground, posts to the ground) ('raised': the base is a bottom rail groundClearance above the ground, posts to the ground) ('raised': the base is a bottom rail groundClearance above the ground, posts to the ground)
  - showInfill: whether to draw intermediate posts/slats between end posts
  - color/style: visual appearance options ('guard': a DCA 6 deck guard — guardInfill balusters | cable | boards, startPost / endPost false where the rails die into a standing post, postThrough for posts past the cap)
  `,
)

export type FenceGuardInfill = z.infer<typeof FenceGuardInfill>
export type FenceNode = z.infer<typeof FenceNode>
