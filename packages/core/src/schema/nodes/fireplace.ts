import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const FireplaceMaterialRole = z.enum(['mantel', 'surround', 'hearth', 'firebox'])
export type FireplaceMaterialRole = z.infer<typeof FireplaceMaterialRole>

export const FireplaceStyle = z.enum(['wall', 'freestanding', 'corner', 'double-sided'])
export type FireplaceStyle = z.infer<typeof FireplaceStyle>

export const FireStyle = z.enum(['none', 'small', 'medium', 'large', 'roaring'])
export type FireStyle = z.infer<typeof FireStyle>

export const FireplaceNode = BaseNode.extend({
  id: objectId('fireplace'),
  type: nodeType('fireplace'),

  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
  mantelMaterial: MaterialSchema.optional(),
  mantelMaterialPreset: z.string().optional(),
  hearthMaterial: MaterialSchema.optional(),
  hearthMaterialPreset: z.string().optional(),
  fireboxMaterial: MaterialSchema.optional(),
  fireboxMaterialPreset: z.string().optional(),

  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.number().default(0),

  style: FireplaceStyle.default('wall'),

  width: z.number().min(0.6).max(4).default(1.5),
  height: z.number().min(0.8).max(4).default(2.2),
  depth: z.number().min(0.3).max(1.5).default(0.6),

  fireboxWidth: z.number().min(0.3).max(3).default(0.9),
  fireboxHeight: z.number().min(0.3).max(3).default(0.7),
  fireboxDepth: z.number().min(0.2).max(1.2).default(0.4),
  fireboxSillHeight: z.number().min(0).max(1.5).default(0.3),

  mantelHeight: z.number().min(0.05).max(0.5).default(0.12),
  mantelOverhang: z.number().min(0).max(0.3).default(0.08),
  mantelThickness: z.number().min(0.03).max(0.2).default(0.06),
  mantelWidth: z.number().min(0).max(1).default(0.1),

  hearthDepth: z.number().min(0).max(0.8).default(0.35),
  hearthHeight: z.number().min(0.02).max(0.2).default(0.05),
  hearthWidth: z.number().min(0).max(1.5).default(0.15),

  surroundWidth: z.number().min(0.05).max(0.5).default(0.15),
  lintelHeight: z.number().min(0.05).max(0.4).default(0.12),

  cornerAngle: z.number().min(30).max(90).default(45),

  fire: FireStyle.default('medium'),
  fireColor: z.enum(['orange', 'amber', 'blue', 'white']).default('orange'),
}).describe(
  dedent`
  Fireplace — an architectural fireplace with mantel, hearth, surround,
  firebox, and optional animated fire. Hosted on a level; placed against
  a wall (wall), free in space (freestanding), in a corner (corner), or
  penetrating a wall (double-sided). The fire is a procedural particle
  system rendered in the viewer — toggle with the \`fire\` field.
  `,
)

export type FireplaceNode = z.infer<typeof FireplaceNode>
export type FireplaceNodeId = FireplaceNode['id']
