import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { type MaterialSchema, MaterialSchema as MaterialSchemaSchema } from '../material'
import { StairSegmentNode } from './stair-segment'

export const StairRailingMode = z.enum(['none', 'left', 'right', 'both'])
export const StairType = z.enum(['straight', 'curved', 'spiral'])
export const StairTopLandingMode = z.enum(['none', 'integrated'])
export const StairSlabOpeningMode = z.enum(['none', 'destination'])

export type StairRailingMode = z.infer<typeof StairRailingMode>
export type StairType = z.infer<typeof StairType>
export type StairTopLandingMode = z.infer<typeof StairTopLandingMode>
export type StairSlabOpeningMode = z.infer<typeof StairSlabOpeningMode>
export type StairSurfaceMaterialRole = 'railing' | 'tread' | 'side'
export type StairSurfaceMaterialSpec = {
  material?: MaterialSchema
  materialPreset?: string
}

export const StairNode = BaseNode.extend({
  id: objectId('stair'),
  type: nodeType('stair'),
  material: MaterialSchemaSchema.optional(),
  materialPreset: z.string().optional(),
  railingMaterial: MaterialSchemaSchema.optional(),
  railingMaterialPreset: z.string().optional(),
  treadMaterial: MaterialSchemaSchema.optional(),
  treadMaterialPreset: z.string().optional(),
  sideMaterial: MaterialSchemaSchema.optional(),
  sideMaterialPreset: z.string().optional(),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  // Rotation around Y axis in radians
  rotation: z.number().default(0),
  stairType: StairType.default('straight'),
  fromLevelId: z.string().nullable().default(null),
  toLevelId: z.string().nullable().default(null),
  slabOpeningMode: StairSlabOpeningMode.default('none'),
  openingOffset: z.number().default(0),
  width: z.number().default(1.0),
  totalRise: z.number().default(2.5),
  stepCount: z.number().default(10),
  thickness: z.number().default(0.25),
  fillToFloor: z.boolean().default(true),
  innerRadius: z.number().default(0.9),
  sweepAngle: z.number().default(Math.PI / 2),
  topLandingMode: StairTopLandingMode.default('none'),
  topLandingDepth: z.number().default(0.9),
  showCenterColumn: z.boolean().default(true),
  showStepSupports: z.boolean().default(true),
  railingMode: StairRailingMode.default('none'),
  railingHeight: z.number().default(0.92),
  // Child stair segment IDs
  children: z.array(StairSegmentNode.shape.id).default([]),
}).describe(
  dedent`
  Stair node - a container for stair segments.
  Acts as a group that either holds one or more StairSegmentNodes (straight stairs)
  or stores stair-level geometry properties for curved stairs.
  - position: center position of the stair group
  - rotation: rotation around Y axis
  - stairType: straight (segment-based), curved (arc-based), or spiral
  - fromLevelId / toLevelId: source and destination levels used for auto slab cutouts
  - slabOpeningMode: whether a destination-level slab opening is generated for this stair
  - openingOffset: extra opening expansion applied after the cutout polygon is computed
  - width: stair width
  - totalRise: total stair height
  - stepCount: number of visible steps
  - thickness: stair slab / tread thickness
  - fillToFloor: whether the stair mass fills down to the floor or uses tread thickness only
  - innerRadius: inner curve radius for curved stairs
  - sweepAngle: total curved stair sweep in radians
  - topLandingMode: optional integrated top landing for spiral stairs
  - topLandingDepth: depth used to size the integrated spiral top landing
  - showCenterColumn: whether spiral stairs render a center column
  - showStepSupports: whether spiral stairs render step support brackets
  - railingMode: whether to render railings and on which side(s)
  - railingHeight: top height of the railing above the stair surface
  - children: array of StairSegmentNode IDs for straight stairs
  `,
)

export type StairNode = z.infer<typeof StairNode>

function getLegacyStairSurfaceMaterial(node: StairNode): StairSurfaceMaterialSpec {
  return {
    material: node.material,
    materialPreset: node.materialPreset,
  }
}

export function getEffectiveStairSurfaceMaterial(
  node: StairNode,
  role: StairSurfaceMaterialRole,
): StairSurfaceMaterialSpec {
  if (role === 'railing') {
    if (node.railingMaterial !== undefined || typeof node.railingMaterialPreset === 'string') {
      return {
        material: node.railingMaterial,
        materialPreset:
          typeof node.railingMaterialPreset === 'string' ? node.railingMaterialPreset : undefined,
      }
    }
  }

  if (role === 'tread') {
    if (node.treadMaterial !== undefined || typeof node.treadMaterialPreset === 'string') {
      return {
        material: node.treadMaterial,
        materialPreset:
          typeof node.treadMaterialPreset === 'string' ? node.treadMaterialPreset : undefined,
      }
    }
  }

  if (role === 'side') {
    if (node.sideMaterial !== undefined || typeof node.sideMaterialPreset === 'string') {
      return {
        material: node.sideMaterial,
        materialPreset:
          typeof node.sideMaterialPreset === 'string' ? node.sideMaterialPreset : undefined,
      }
    }
  }

  const treadFallback = {
    material: node.treadMaterial,
    materialPreset:
      typeof node.treadMaterialPreset === 'string' ? node.treadMaterialPreset : undefined,
  }
  const sideFallback = {
    material: node.sideMaterial,
    materialPreset:
      typeof node.sideMaterialPreset === 'string' ? node.sideMaterialPreset : undefined,
  }

  if (
    role === 'tread' &&
    (sideFallback.material !== undefined || sideFallback.materialPreset !== undefined)
  ) {
    return sideFallback
  }

  if (
    role === 'side' &&
    (treadFallback.material !== undefined || treadFallback.materialPreset !== undefined)
  ) {
    return treadFallback
  }

  if (role === 'railing') {
    if (treadFallback.material !== undefined || treadFallback.materialPreset !== undefined) {
      return treadFallback
    }

    if (sideFallback.material !== undefined || sideFallback.materialPreset !== undefined) {
      return sideFallback
    }
  }

  return getLegacyStairSurfaceMaterial(node)
}
