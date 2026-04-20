import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'
import { DoorNode } from './door'
import { ItemNode } from './item'
import { WindowNode } from './window'

export const WallNode = BaseNode.extend({
  id: objectId('wall'),
  type: nodeType('wall'),
  children: z
    .array(z.union([ItemNode.shape.id, DoorNode.shape.id, WindowNode.shape.id]))
    .default([]),
  // Legacy single-material wall finish. Read for backward compatibility only.
  material: MaterialSchema.optional(),
  // Legacy single-material wall finish preset. Read for backward compatibility only.
  materialPreset: z.string().optional(),
  interiorMaterial: MaterialSchema.optional(),
  interiorMaterialPreset: z.string().optional(),
  exteriorMaterial: MaterialSchema.optional(),
  exteriorMaterialPreset: z.string().optional(),
  thickness: z.number().optional(),
  height: z.number().optional(),
  curveOffset: z.number().optional(),
  // e.g., start/end points for path
  start: z.tuple([z.number(), z.number()]),
  end: z.tuple([z.number(), z.number()]),
  // Space detection for cutaway mode
  frontSide: z.enum(['interior', 'exterior', 'unknown']).default('unknown'),
  backSide: z.enum(['interior', 'exterior', 'unknown']).default('unknown'),
}).describe(
  dedent`
  Wall node - used to represent a wall in the building
  - thickness: thickness in meters
  - height: height in meters
  - curveOffset: midpoint sagitta offset used to bend the wall into an arc
  - start: start point of the wall in level coordinate system
  - end: end point of the wall in level coordinate system
  - size: size of the wall in grid units
  - frontSide: whether the front side faces interior, exterior, or unknown
  - backSide: whether the back side faces interior, exterior, or unknown
  `,
)
export type WallNode = z.infer<typeof WallNode>

export type WallSurfaceSide = 'interior' | 'exterior'

export type WallSurfaceMaterialSpec = {
  material?: z.infer<typeof MaterialSchema>
  materialPreset?: string
}

type WallSurfaceMaterialSource = {
  material?: z.infer<typeof MaterialSchema>
  materialPreset?: string
  interiorMaterial?: z.infer<typeof MaterialSchema>
  interiorMaterialPreset?: string
  exteriorMaterial?: z.infer<typeof MaterialSchema>
  exteriorMaterialPreset?: string
}

function getConfiguredWallSurfaceMaterial(
  wall: WallSurfaceMaterialSource,
  side: WallSurfaceSide,
): WallSurfaceMaterialSpec {
  if (side === 'interior') {
    return {
      material: wall.interiorMaterial,
      materialPreset: wall.interiorMaterialPreset,
    }
  }

  return {
    material: wall.exteriorMaterial,
    materialPreset: wall.exteriorMaterialPreset,
  }
}

function hasSurfaceMaterial(spec: WallSurfaceMaterialSpec): boolean {
  return spec.material !== undefined || typeof spec.materialPreset === 'string'
}

export function getEffectiveWallSurfaceMaterial(
  wall: WallSurfaceMaterialSource,
  side: WallSurfaceSide,
): WallSurfaceMaterialSpec {
  const configured = getConfiguredWallSurfaceMaterial(wall, side)
  if (hasSurfaceMaterial(configured)) {
    return configured
  }

  return {
    material: wall.material,
    materialPreset: wall.materialPreset,
  }
}

export function getWallSurfaceMaterialSignature(spec: WallSurfaceMaterialSpec): string {
  return JSON.stringify({
    material: spec.material ?? null,
    materialPreset: spec.materialPreset ?? null,
  })
}
