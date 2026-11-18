import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { TREE_FORMS, TREE_LIMITS } from './tree-limits'

const coordinate = z
  .number()
  .finite()
  .min(-TREE_LIMITS.maxCoordinate)
  .max(TREE_LIMITS.maxCoordinate)

export const TreeNode = BaseNode.extend({
  id: objectId('tree'),
  type: nodeType('tree'),
  position: z.tuple([coordinate, z.literal(0), coordinate]).default([0, 0, 0]),
  form: z.enum(TREE_FORMS).default('round'),
  heightM: z.number().finite().min(TREE_LIMITS.minHeight).max(TREE_LIMITS.maxHeight).default(8),
  spreadM: z.number().finite().min(TREE_LIMITS.minSpread).max(TREE_LIMITS.maxSpread).optional(),
  foliage: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#609343'),
  density: z.number().finite().min(0).max(1).default(0.85),
  seed: z.number().int().min(-2147483648).max(2147483647).default(1),
  gen: z.literal(1).default(1),
}).describe(
  'A seeded procedural tree owned by a Site. Position is a Site XZ ground anchor with stored Y zero; ground supplies elevation. Height and crown width are metres. Omitted spreadM follows form and height. Foliage is a six-digit hex colour; density zero is bare winter wood. Gen pins the branching rule.',
)

export type TreeNode = z.infer<typeof TreeNode>
