import dedent from 'dedent'
import { z } from 'zod'
import { Assembly } from '../assembly'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'
import { RoofSegmentNode } from './roof-segment'
import {
  type RoofSurfaceMaterialRole,
  type RoofSurfaceMaterialSpec,
  readRoofRoleMaterial,
} from './roof-surface-roles'

export type { RoofSurfaceMaterialRole, RoofSurfaceMaterialSpec } from './roof-surface-roles'

export const RoofSupport = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('level') }),
    z.object({ kind: z.literal('walls') }),
    z.object({
      kind: z.literal('roof'),
      roofSegmentId: RoofSegmentNode.shape.id,
      localPosition: z.tuple([z.number(), z.number()]),
      curbHeight: z.number().min(0).default(0.5),
    }),
  ])
  .default({ kind: 'level' })

export type RoofSupport = z.infer<typeof RoofSupport>

export const RoofNode = BaseNode.extend({
  id: objectId('roof'),
  type: nodeType('roof'),
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
  topMaterial: MaterialSchema.optional(),
  topMaterialPreset: z.string().optional(),
  edgeMaterial: MaterialSchema.optional(),
  edgeMaterialPreset: z.string().optional(),
  soffitMaterial: MaterialSchema.optional(),
  soffitMaterialPreset: z.string().optional(),
  fasciaMaterial: MaterialSchema.optional(),
  fasciaMaterialPreset: z.string().optional(),
  wallMaterial: MaterialSchema.optional(),
  wallMaterialPreset: z.string().optional(),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  // Rotation around Y axis in radians
  rotation: z.number().default(0),
  support: RoofSupport,
  // Layer build-up inward from the covering-top plane of every segment (F2).
  assembly: Assembly.optional(),
  // Per-slot material overrides, as on walls and slabs: `layer:<id>` keys
  // (or a layer's own `slot`) paint an assembly layer.
  slots: z.record(z.string(), z.string()).optional(),
  // Child roof segment IDs
  children: z.array(RoofSegmentNode.shape.id).default([]),
}).describe(
  dedent`
  Roof node - a container for roof segments.
  Acts as a group that holds one or more RoofSegmentNodes.
  When not being edited, segments are visually combined into a single solid.
  - position: center position of the roof group
  - rotation: rotation around Y axis
  - support: custom level placement, spatial wall-top following, or a roof-surface attachment
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
  // No cross-role fallback beyond the roles a new surface still follows
  // (see roof-surface-roles): an unset role resolves only to the legacy
  // catch-all and otherwise to the caller's theme default. Painting one
  // surface must never bleed onto the others.
  return readRoofRoleMaterial(node, role) ?? getLegacyRoofSurfaceMaterial(node)
}
