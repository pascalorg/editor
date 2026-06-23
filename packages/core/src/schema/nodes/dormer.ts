import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'
import { RoofType } from './roof-segment'

export type DormerSurfaceMaterialRole = 'top' | 'side' | 'wall'
export type DormerSurfaceMaterialSpec = {
  material?: z.infer<typeof MaterialSchema>
  materialPreset?: string
}

/**
 * Default dormer dimensions and window controls. Values match the
 * legacy archive so existing scenes don't shift visually.
 */
export const DORMER_DEFAULTS = {
  WIDTH: 1.21,
  DEPTH: 1.55,
  WALL_HEIGHT: 0,
  ROOF_HEIGHT: 0.49,
  WALL_SKIRT_HEIGHT: 2.73,
  WINDOW_WIDTH: 0.76,
  WINDOW_HEIGHT: 0.68,
  WINDOW_OFFSET_X: 0.02,
  WINDOW_OFFSET_Y: 0.99,
  WINDOW_FRAME_THICKNESS: 0.05,
  WINDOW_FRAME_DEPTH: 0.06,
  WINDOW_COLUMNS: 3,
  WINDOW_ROWS: 3,
  WINDOW_DIVIDER_THICKNESS: 0.02,
  WINDOW_ARCH_HEIGHT: 0.35,
  WINDOW_CORNER_RADIUS: 0.15,
  WINDOW_SILL_DEPTH: 0.08,
  WINDOW_SILL_THICKNESS: 0.03,
} as const

const DEFAULT_CORNER_RADII: [number, number, number, number] = [
  DORMER_DEFAULTS.WINDOW_CORNER_RADIUS,
  DORMER_DEFAULTS.WINDOW_CORNER_RADIUS,
  DORMER_DEFAULTS.WINDOW_CORNER_RADIUS,
  DORMER_DEFAULTS.WINDOW_CORNER_RADIUS,
]

export const DormerNode = BaseNode.extend({
  id: objectId('dormer'),
  type: nodeType('dormer'),

  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
  topMaterial: MaterialSchema.optional(),
  topMaterialPreset: z.string().optional(),
  sideMaterial: MaterialSchema.optional(),
  sideMaterialPreset: z.string().optional(),
  wallMaterial: MaterialSchema.optional(),
  wallMaterialPreset: z.string().optional(),

  roofSegmentId: z.string().optional(),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.number().default(0),

  width: z.number().default(DORMER_DEFAULTS.WIDTH),
  depth: z.number().default(DORMER_DEFAULTS.DEPTH),
  height: z.number().default(DORMER_DEFAULTS.WALL_HEIGHT),

  roofType: RoofType.default('gable'),
  roofHeight: z.number().default(DORMER_DEFAULTS.ROOF_HEIGHT),

  // Height of the hung wall (the "skirt") that extends below the eave
  // into the host roof — this is the wall area the window opening is
  // cut through. Larger values let the dormer host taller windows.
  wallSkirtHeight: z.number().default(DORMER_DEFAULTS.WALL_SKIRT_HEIGHT),

  // Window is rendered as parametric geometry on the dormer's front
  // face — not a child node. The fields below mirror the legacy panel
  // controls; geometry beyond the simple opening box is deferred.
  windowWidth: z.number().default(DORMER_DEFAULTS.WINDOW_WIDTH),
  windowHeight: z.number().default(DORMER_DEFAULTS.WINDOW_HEIGHT),
  windowOffsetX: z.number().default(DORMER_DEFAULTS.WINDOW_OFFSET_X),
  windowOffsetY: z.number().default(DORMER_DEFAULTS.WINDOW_OFFSET_Y),
  windowFrameThickness: z.number().default(DORMER_DEFAULTS.WINDOW_FRAME_THICKNESS),
  windowFrameDepth: z.number().default(DORMER_DEFAULTS.WINDOW_FRAME_DEPTH),
  windowColumns: z.number().int().min(1).max(8).default(DORMER_DEFAULTS.WINDOW_COLUMNS),
  windowRows: z.number().int().min(1).max(8).default(DORMER_DEFAULTS.WINDOW_ROWS),
  windowDividerThickness: z.number().default(DORMER_DEFAULTS.WINDOW_DIVIDER_THICKNESS),
  windowShape: z.enum(['rectangle', 'rounded', 'arch']).default('rectangle'),
  windowArchHeight: z.number().default(DORMER_DEFAULTS.WINDOW_ARCH_HEIGHT),
  // Single source of truth for the rounded-shape corner radii. Tuple is
  // [topLeft, topRight, bottomRight, bottomLeft]. "All vs Individual"
  // is a UI-only view mode derived from whether the tuple is uniform.
  windowCornerRadii: z
    .tuple([z.number(), z.number(), z.number(), z.number()])
    .default(DEFAULT_CORNER_RADII),
  windowSill: z.boolean().default(false),
  windowSillDepth: z.number().default(DORMER_DEFAULTS.WINDOW_SILL_DEPTH),
  windowSillThickness: z.number().default(DORMER_DEFAULTS.WINDOW_SILL_THICKNESS),
}).describe(
  dedent`
  Dormer — a small house-shaped protrusion sitting on top of a roof
  segment. width × depth × height defines the box base; roofType and
  roofHeight define the dormer's own roof shape. The window opening
  is parametric geometry on the dormer's front face, not a hosted
  child node.
  `,
)

export type DormerNode = z.infer<typeof DormerNode>

/**
 * Per-surface material resolution. Fall-through order:
 *   top  → topMaterial[Preset]                              → legacy
 *   side → sideMaterial[Preset] → wallMaterial[Preset]      → legacy
 *   wall → wallMaterial[Preset] → sideMaterial[Preset]      → legacy
 * where legacy is `node.material` / `node.materialPreset`.
 */
export function getEffectiveDormerSurfaceMaterial(
  node: DormerNode,
  role: DormerSurfaceMaterialRole,
): DormerSurfaceMaterialSpec {
  const top: DormerSurfaceMaterialSpec = {
    material: node.topMaterial,
    materialPreset: node.topMaterialPreset,
  }
  const side: DormerSurfaceMaterialSpec = {
    material: node.sideMaterial,
    materialPreset: node.sideMaterialPreset,
  }
  const wall: DormerSurfaceMaterialSpec = {
    material: node.wallMaterial,
    materialPreset: node.wallMaterialPreset,
  }
  const legacy: DormerSurfaceMaterialSpec = {
    material: node.material,
    materialPreset: node.materialPreset,
  }
  const has = (spec: DormerSurfaceMaterialSpec) =>
    spec.material !== undefined || typeof spec.materialPreset === 'string'

  if (role === 'top') return has(top) ? top : legacy
  if (role === 'side') return has(side) ? side : has(wall) ? wall : legacy
  return has(wall) ? wall : has(side) ? side : legacy
}
