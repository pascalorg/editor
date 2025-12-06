import dedent from 'dedent'
import { z } from 'zod'
import { objectId } from './base'
import { LevelNode } from './nodes/level'

const COLLECTION_TYPES = ['room', 'other'] as const
export const CollectionType = z.enum(COLLECTION_TYPES)

export const CollectionSchema = z
  .object({
    id: objectId('collection'),
    object: z.literal('collection').default('collection'),
    type: CollectionType.default('other'),
    levelId: LevelNode.transform((level) => level.id)
      .nullable()
      .default(null),
    name: z.string(),
    nodeIds: z.array(z.string()).default([]),
    metadata: z.json().optional().default({}),
  })
  .describe(
    dedent`
  Collection schema - used to represent a collection of nodes for interacting with the scene
  - object: "collection"
  - type: collection type (room, other)
  - id: collection id
  - name: collection name
  - nodeIds: array of node ids
  - metadata: collection metadata (optional)
  `,
  )

export type Collection = z.infer<typeof CollectionSchema>
export type CollectionType = z.infer<typeof CollectionType>
