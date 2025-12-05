import dedent from 'dedent'
import { z } from 'zod'
import { objectId } from './base'
import { AnyNode } from './types'

export const CollectionSchema = z
  .object({
    id: objectId('collection'),
    object: z.literal('collection').default('collection'),
    name: z.string(),
    nodeIds: z.array(AnyNode.transform((node) => node.id)),
    metadata: z.json().optional().default({}),
  })
  .describe(
    dedent`
  Collection schema - used to represent a collection of nodes for interacting with the scene
  - object: "collection"
  - id: collection id
  - name: collection name
  - nodeIds: array of node ids
  - metadata: collection metadata (optional)
  `,
  )

export type Collection = z.infer<typeof CollectionSchema>
