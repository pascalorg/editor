import z from 'zod'
import { nodeId } from '@/lib/graph/nodes/helpers'

export const ObjectNode = z.object({
  id: nodeId('object'),
  type: z.string(), // Generic string, validated by specific schemas
  name: z.string(),

  //  position & rotation
  position: z.tuple([z.number(), z.number(), z.number()]), // [x, y, z]
  rotation: z.tuple([z.number(), z.number(), z.number()]), // [pitch, yaw, roll]

  // hierarchy
  parent: z.string().optional(),
  // https://zod.dev/api?id=recursive-objects
  get children() {
    return z.array(ObjectNode).optional().default([])
  },

  visible: z.boolean().optional().default(true),
  opacity: z.number().min(0).max(100).optional().default(100),
  preview: z.boolean().optional().default(false),

  // metadata
  metadata: z.json(),
})

export const LevelNode = z.object({
  id: z.string().min(1),
  name: z.string(),
  children: z.array(ObjectNode),
})

export type LevelNode = z.infer<typeof LevelNode>
