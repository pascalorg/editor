import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const FenceStyle = z.enum(['slat', 'rail', 'privacy', 'horizontal'])
export const FenceBaseStyle = z.enum(['floating', 'grounded'])
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
  color: z.string().default('#ffffff'),
  style: FenceStyle.default('slat'),
}).describe(
  dedent`
  Fence node - used to represent a fence segment in the building/site level coordinate system
  - start/end: fence endpoints in level coordinate system
  - path: optional list of [x, y] points; when set (>= 2) the centerline is a smooth spline through them
  - tangents: optional per-point handle vectors (parallel to path); null entries fall back to the automatic tangent
  - height/thickness: overall fence dimensions in meters
  - curveOffset: midpoint sagitta offset used to bend the fence into an arc (ignored when path is set)
  - baseHeight/postSpacing/postSize/topRailHeight: exact geometric controls from the plan3D fence model
  - groundClearance/edgeInset/baseStyle: fence support and inset configuration
  - showInfill: whether to draw intermediate posts/slats between end posts
  - color/style: visual appearance options
  `,
)

export type FenceNode = z.infer<typeof FenceNode>
