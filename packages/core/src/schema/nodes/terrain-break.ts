import { z } from 'zod'
import { validateTerrainBreak } from '../../lib/terrain-breaks'
import { BaseNode, nodeType, objectId } from '../base'

const SideHeight = z.union([z.number().finite(), z.literal('ground')])

export const TerrainBreakNode = BaseNode.extend({
  id: objectId('terrain-break'),
  type: nodeType('terrain-break'),
  line: z
    .array(z.tuple([z.number().finite(), z.number().finite()]))
    .min(2)
    .max(513),
  kind: z.enum(['cliff', 'retaining', 'soil']),
  left: SideHeight,
  right: SideHeight,
})
  .refine((node) => node.left !== 'ground' || node.right !== 'ground', {
    message: 'At least one terrain-break side must have a numeric height.',
    path: ['left'],
  })
  .refine((node) => node.left !== 'ground' || node.right !== 'ground', {
    message: 'At least one terrain-break side must have a numeric height.',
    path: ['right'],
  })
  .refine(
    (node) => {
      if (node.left === 'ground' && node.right === 'ground') return true
      try {
        validateTerrainBreak(node)
        return true
      } catch {
        return false
      }
    },
    {
      message: 'Terrain-break geometry must be straight open or a simple convex CCW closed ring.',
      path: ['line'],
    },
  )
  .describe('Vertical terrain boundary in site XZ metres; directed left is the positive cross side')
  .meta({ strictMutations: true })

export type TerrainBreakNode = z.infer<typeof TerrainBreakNode>
export type TerrainBreakNodeId = TerrainBreakNode['id']
