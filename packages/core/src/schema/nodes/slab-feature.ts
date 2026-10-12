import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const SlabFeatureNode = BaseNode.extend({
  id: objectId('slab-feature'),
  type: nodeType('slab-feature'),
  mode: z.enum(['niche', 'bump']).default('niche'),
  x: z.number().finite().default(0),
  z: z.number().finite().default(0),
  width: z.number().finite().positive().default(0.6),
  length: z.number().finite().positive().default(0.6),
  depth: z.number().finite().positive().default(0.02),
  children: z
    .array(z.union([objectId('slab-feature'), objectId('item'), objectId('procedural-item')]))
    .default([]),
  slots: z.record(z.string(), z.string()).optional(),
  attachments: z.record(z.string(), z.literal('resting')).default({}),
})
  .superRefine((node, ctx) => {
    if (
      node.parentId &&
      !node.parentId.startsWith('slab_') &&
      !node.parentId.startsWith('slab-feature_')
    )
      ctx.addIssue({
        code: 'custom',
        path: ['parentId'],
        message: 'A slab feature belongs to a slab or slab bump.',
      })
    for (const id of Object.keys(node.attachments))
      if (id.startsWith('slab-feature_'))
        ctx.addIssue({
          code: 'custom',
          path: ['attachments', id],
          message: 'Only items attach to the resting surface.',
        })
  })
  .describe(
    'Rectangular slab niche or bump. x/z are footprint centre coordinates relative to the slab first outline vertex, or relative to the centre of a parent bump. width is along X, length along Z, depth is normal to the top face. Missing finishes inherit the host. Only a niche can nest inside a slab-owned bump.',
  )

export type SlabFeatureNode = z.infer<typeof SlabFeatureNode>
export type SlabFeatureNodeId = SlabFeatureNode['id']
