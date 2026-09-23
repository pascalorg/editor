import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const FenceStyle = z.enum(['slat', 'rail', 'privacy', 'horizontal', 'picket'])
export const FenceBaseStyle = z.enum(['floating', 'grounded'])
export const FencePostCap = z.enum(['none', 'flat', 'pyramid'])
export const FenceSurfaceMode = z.enum(['auto', 'selected', 'level'])
export const FenceTransitionMode = z.enum(['slope', 'step', 'break'])
export const FencePatternDistribution = z.enum([
  'automatic',
  'fixed-spacing',
  'fixed-count',
  'maximum-spacing',
  'equal-fit',
])
export const FenceFeature = z.object({
  id: z.string(),
  kind: z.enum(['gate', 'opening']),
  center: z.number().finite().nonnegative(),
  width: z.number().finite().positive(),
  leafType: z.enum(['single', 'double']).optional(),
  style: z.enum(['match', 'picket', 'slat', 'horizontal', 'privacy', 'rail']).optional(),
  height: z.number().finite().min(0.3).max(6).optional(),
  clearance: z.number().finite().min(0).max(2).optional(),
  thickness: z.number().finite().min(0.02).max(0.3).optional(),
  frameWidth: z.number().finite().min(0.025).max(0.2).optional(),
  spacing: z.number().finite().min(0.04).max(1).optional(),
  boardWidth: z.number().finite().min(0.02).max(0.3).optional(),
  hinge: z.enum(['left', 'right']).optional(),
  swing: z.enum(['inward', 'outward']).optional(),
  openAngle: z.number().finite().min(0).max(170).optional(),
  leafSplit: z.number().finite().min(0.2).max(0.8).optional(),
  brace: z.enum(['none', 'diagonal', 'cross']).optional(),
  showHardware: z.boolean().optional(),
  showPosts: z.boolean().optional(),
})

export const FenceNode = BaseNode.extend({
  id: objectId('fence'),
  type: nodeType('fence'),
  children: z.array(z.string()).default([]),
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
  spanModes: z.array(z.enum(['straight', 'curve'])).optional(),
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
  // Top surface selected when drawing on a shaped node. The sampled surface
  // is resolved again for both preview and committed geometry.
  supportSurfaceNodeId: z.string().optional(),
  // Manual vertical offset from the elected slab, shaped surface, or level base.
  supportOffset: z.number().finite().optional(),
  surfaceMode: FenceSurfaceMode.default('auto'),
  transitionMode: FenceTransitionMode.default('slope'),
  transitionWidth: z.number().min(0.2).max(5).default(0.8),
  curveOffset: z.number().optional(),
  baseHeight: z.number().default(0.22),
  postSpacing: z.number().default(1.98),
  picketSpacing: z.number().default(0.27),
  patternDistribution: FencePatternDistribution.default('automatic'),
  patternAlignment: z.enum(['start', 'center', 'end']).default('center'),
  patternCount: z.number().int().min(1).max(500).default(4),
  patternRemainder: z.enum(['leave', 'spread']).default('leave'),
  picketWidth: z.number().positive().default(0.07),
  picketTop: z.enum(['flat', 'pointed', 'rounded', 'dog-ear']).default('flat'),
  picketProfile: z.enum(['level', 'arched', 'scalloped', 'alternating']).default('level'),
  picketTopClearance: z.number().nonnegative().default(0.2),
  picketVariation: z.number().nonnegative().default(0.23),
  picketRailProjection: z.number().positive().default(0.018),
  picketRailCount: z.number().int().min(2).max(3).default(2),
  postSize: z.number().default(0.109),
  topRailHeight: z.number().default(0.04),
  groundClearance: z.number().default(0.14),
  edgeInset: z.number().default(0.015),
  // Reveal between the boards of a `horizontal` fence (0 = flush cladding).
  slatGap: z.number().default(0.01),
  postCap: FencePostCap.default('pyramid'),
  baseStyle: FenceBaseStyle.default('floating'),
  showInfill: z.boolean().default(true),
  infillPlacement: z.enum(['center', 'front', 'back']).default('center'),
  color: z.string().default('#ffffff'),
  style: FenceStyle.default('picket'),
}).describe(
  dedent`
  Fence node - used to represent a fence segment in the building/site level coordinate system
  - start/end: fence endpoints in level coordinate system
  - path: optional list of [x, y] points; when set (>= 2) the centerline is a smooth spline through them
  - spanModes: straight or curved choice for each path span
  - children: independently selectable gates and open passages
  - tangents: optional per-point handle vectors (parallel to path); null entries fall back to the automatic tangent
  - height/thickness: overall fence dimensions in meters
  - supportSlabId: optional slab host; the fence stands on that slab's walking surface (elevation)
  - supportSurfaceNodeId: optional shaped surface whose top the fence follows
  - supportOffset: manual vertical offset from the elected support surface
  - surfaceMode: auto follows the highest top, selected follows one chosen top, level holds the starting elevation
  - curveOffset: midpoint sagitta offset used to bend the fence into an arc (ignored when path is set)
  - baseHeight/postSpacing/postSize/topRailHeight: exact geometric controls from the plan3D fence model
  - patternDistribution/patternAlignment/patternCount/patternRemainder: repeated-piece layout
  - groundClearance/edgeInset/baseStyle: fence support and inset configuration
  - showInfill: whether to draw intermediate posts/slats between end posts
  - color/style: visual appearance options
  `,
)

export type FenceNode = z.infer<typeof FenceNode>
