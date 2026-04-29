import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { type MaterialSchema, MaterialSchema as MaterialSchemaSchema } from '../material'
import { RoofSegmentNode } from './roof-segment'

export type RoofSurfaceMaterialRole = 'top' | 'edge' | 'wall'
export type RoofSurfaceMaterialSpec = {
  material?: MaterialSchema
  materialPreset?: string
}

export const RoofNode = BaseNode.extend({
  id: objectId('roof'),
  type: nodeType('roof'),
  material: MaterialSchemaSchema.optional(),
  materialPreset: z.string().optional(),
  topMaterial: MaterialSchemaSchema.optional(),
  topMaterialPreset: z.string().optional(),
  edgeMaterial: MaterialSchemaSchema.optional(),
  edgeMaterialPreset: z.string().optional(),
  wallMaterial: MaterialSchemaSchema.optional(),
  wallMaterialPreset: z.string().optional(),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  // Rotation around Y axis in radians
  rotation: z.number().default(0),
  // Child roof segment IDs
  children: z.array(RoofSegmentNode.shape.id).default([]),
}).describe(
  dedent`
  Roof node - a container for roof segments.
  Acts as a group that holds one or more RoofSegmentNodes.
  When not being edited, segments are visually combined into a single solid.
  - position: center position of the roof group
  - rotation: rotation around Y axis
  - children: array of RoofSegmentNode IDs
  `,
)

export type RoofNode = z.infer<typeof RoofNode>

function getLegacyRoofSurfaceMaterial(node: RoofNode): RoofSurfaceMaterialSpec {
  return {
    material: node.material,
    materialPreset: node.materialPreset,
  }
}

export function getEffectiveRoofSurfaceMaterial(
  node: RoofNode,
  role: RoofSurfaceMaterialRole,
): RoofSurfaceMaterialSpec {
  if (role === 'top') {
    if (node.topMaterial !== undefined || typeof node.topMaterialPreset === 'string') {
      return {
        material: node.topMaterial,
        materialPreset: typeof node.topMaterialPreset === 'string' ? node.topMaterialPreset : undefined,
      }
    }
  }

  if (role === 'edge') {
    if (node.edgeMaterial !== undefined || typeof node.edgeMaterialPreset === 'string') {
      return {
        material: node.edgeMaterial,
        materialPreset:
          typeof node.edgeMaterialPreset === 'string' ? node.edgeMaterialPreset : undefined,
      }
    }
  }

  if (role === 'wall') {
    if (node.wallMaterial !== undefined || typeof node.wallMaterialPreset === 'string') {
      return {
        material: node.wallMaterial,
        materialPreset:
          typeof node.wallMaterialPreset === 'string' ? node.wallMaterialPreset : undefined,
      }
    }
  }

  if (role === 'edge') {
    if (node.wallMaterial !== undefined || typeof node.wallMaterialPreset === 'string') {
      return {
        material: node.wallMaterial,
        materialPreset:
          typeof node.wallMaterialPreset === 'string' ? node.wallMaterialPreset : undefined,
      }
    }
  }

  if (role === 'wall') {
    if (node.edgeMaterial !== undefined || typeof node.edgeMaterialPreset === 'string') {
      return {
        material: node.edgeMaterial,
        materialPreset:
          typeof node.edgeMaterialPreset === 'string' ? node.edgeMaterialPreset : undefined,
      }
    }
  }

  return getLegacyRoofSurfaceMaterial(node)
}
