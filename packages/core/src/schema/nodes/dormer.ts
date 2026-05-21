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
  surfaceNormal: z.tuple([z.number(), z.number(), z.number()]).optional(),

  width: z.number().default(1.21),
  depth: z.number().default(1.55),
  height: z.number().default(0),

  roofType: RoofType.default('gable'),
  roofHeight: z.number().default(0.49),

  // Height of the hung wall (the "skirt") that extends below the eave
  // into the host roof — this is the wall area the window opening is
  // cut through. Larger values let the dormer host taller windows.
  wallSkirtHeight: z.number().default(2.73),

  // Window is rendered as parametric geometry on the dormer's front
  // face — not a child node. The fields below mirror the legacy panel
  // controls; geometry beyond the simple opening box is deferred.
  windowWidth: z.number().default(0.76),
  windowHeight: z.number().default(0.68),
  windowOffsetX: z.number().default(0.02),
  windowOffsetY: z.number().default(0.99),
  windowFrameThickness: z.number().default(0.05),
  windowFrameDepth: z.number().default(0.06),
  windowColumns: z.number().int().min(1).max(8).default(3),
  windowRows: z.number().int().min(1).max(8).default(3),
  windowDividerThickness: z.number().default(0.02),
  windowShape: z.enum(['rectangle', 'rounded', 'arch']).default('rectangle'),
  windowArchHeight: z.number().default(0.35),
  windowCornerRadius: z.number().default(0.15),
  windowRadiusMode: z.enum(['all', 'individual']).default('all'),
  windowCornerRadii: z
    .tuple([z.number(), z.number(), z.number(), z.number()])
    .default([0.15, 0.15, 0.15, 0.15]),
  windowSill: z.boolean().default(true),
  windowSillDepth: z.number().default(0.08),
  windowSillThickness: z.number().default(0.03),
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

function getLegacyDormerSurfaceMaterial(node: DormerNode): DormerSurfaceMaterialSpec {
  return { material: node.material, materialPreset: node.materialPreset }
}

/**
 * Per-surface material resolution. Same fall-through order as the
 * archive: explicit role → cross-fallback between side/wall → legacy
 * `material`/`materialPreset`.
 */
export function getEffectiveDormerSurfaceMaterial(
  node: DormerNode,
  role: DormerSurfaceMaterialRole,
): DormerSurfaceMaterialSpec {
  if (role === 'top') {
    if (node.topMaterial !== undefined || typeof node.topMaterialPreset === 'string') {
      return { material: node.topMaterial, materialPreset: node.topMaterialPreset }
    }
  }
  if (role === 'side') {
    if (node.sideMaterial !== undefined || typeof node.sideMaterialPreset === 'string') {
      return { material: node.sideMaterial, materialPreset: node.sideMaterialPreset }
    }
  }
  if (role === 'wall') {
    if (node.wallMaterial !== undefined || typeof node.wallMaterialPreset === 'string') {
      return { material: node.wallMaterial, materialPreset: node.wallMaterialPreset }
    }
  }
  if (role === 'side') {
    if (node.wallMaterial !== undefined || typeof node.wallMaterialPreset === 'string') {
      return { material: node.wallMaterial, materialPreset: node.wallMaterialPreset }
    }
  }
  if (role === 'wall') {
    if (node.sideMaterial !== undefined || typeof node.sideMaterialPreset === 'string') {
      return { material: node.sideMaterial, materialPreset: node.sideMaterialPreset }
    }
  }
  return getLegacyDormerSurfaceMaterial(node)
}
