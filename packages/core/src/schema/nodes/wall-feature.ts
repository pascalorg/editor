import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const WallFeatureNode = BaseNode.extend({
  id: objectId('wall-feature'),
  type: nodeType('wall-feature'),
  mode: z.enum(['niche', 'bump']).default('niche'),
  face: z.enum(['a', 'b']).optional(),
  u: z.number().finite().default(0.3),
  bottom: z.number().finite().min(0).default(1),
  width: z.number().finite().positive().default(0.6),
  height: z.number().finite().positive().default(0.35),
  depth: z.number().finite().positive().default(0.1),
  children: z
    .array(z.union([objectId('wall-feature'), objectId('item'), objectId('procedural-item')]))
    .default([]),
  slots: z.record(z.string(), z.string()).optional(),
  attachments: z.record(z.string(), z.string()).default({}),
})
  .superRefine((node, ctx) => {
    for (const [childId, surfaceId] of Object.entries(node.attachments)) {
      if (
        node.children.includes(childId as (typeof node.children)[number]) &&
        (surfaceId !== 'resting' || childId.startsWith('wall-feature_'))
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['attachments', childId],
          message: 'Items can attach to the feature resting surface.',
        })
      }
    }
    if (
      node.parentId !== null &&
      !node.parentId.startsWith('wall_') &&
      !node.parentId.startsWith('wall-feature_')
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['parentId'],
        message: 'A wall feature must be owned by a wall or wall feature',
      })
    }
    if (node.parentId?.startsWith('wall_') && node.face === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['face'],
        message: 'A wall child must name face a or b',
      })
    }
    if (node.parentId?.startsWith('wall-feature_') && node.face !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['face'],
        message: 'A nested feature inherits its face from its parent',
      })
    }
  })
  .describe(
    'A rectangular niche or bump owned by a wall or wall feature. Dimensions are in metres. ' +
      'For a wall child, u is the centre distance from wall.start towards wall.end on either face; ' +
      "bottom is above the mounting face base. For a nested child, u is measured from the parent's " +
      "lower-u edge in the same wall direction, bottom is above the parent's bottom, and depth " +
      "starts at the parent's exposed face. parentId is the only host reference; null is an " +
      'unattached draft. Missing slots inherit the host finish. Host fit is validated against the scene.',
  )

export type WallFeatureNode = z.infer<typeof WallFeatureNode>
export type WallFeatureNodeId = WallFeatureNode['id']
