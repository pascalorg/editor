import dedent from 'dedent'
import { z } from 'zod'
import { objectId } from './base'

const COLLECTION_TYPES = ['room', 'other'] as const
export const CollectionType = z.enum(COLLECTION_TYPES)

export const CollectionSchema = z
  .object({
    id: objectId('collection'),
    object: z.literal('collection').default('collection'),
    type: CollectionType.default('other'),
    levelId: z.string().nullable().default(null), // Level this collection is associated with
    name: z.string(),
    nodeIds: z.array(z.string()).default([]),
    // Visual styling
    color: z.string().default('#3b82f6'), // Default blue
    metadata: z.json().optional().default({}),
  })
  .describe(
    dedent`
  Collection schema - a logical grouping of nodes (e.g., electric appliances, furniture set)
  - object: "collection"
  - type: collection type (room, other)
  - id: collection id
  - levelId: level this collection is associated with (optional)
  - name: collection name
  - nodeIds: array of node ids in this collection
  - color: hex color for visual styling
  - metadata: collection metadata (optional)
  `,
  )

export type Collection = z.infer<typeof CollectionSchema>
export type CollectionType = z.infer<typeof CollectionType>
