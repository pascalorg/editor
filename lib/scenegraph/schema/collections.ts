import dedent from 'dedent'
import { z } from 'zod'
import { objectId } from './base'
import { LevelNode } from './nodes/level'

const COLLECTION_TYPES = ['room', 'other'] as const
export const CollectionType = z.enum(COLLECTION_TYPES)

// Polygon boundary for collection area
const CollectionPolygon = z.object({
  type: z.literal('polygon'),
  points: z.array(z.tuple([z.number(), z.number()])), // Array of [x, z] coordinates
})

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
    // Polygon boundary (optional - for polygon-based collections)
    polygon: CollectionPolygon.optional(),
    // Visual styling
    color: z.string().default('#3b82f6'), // Default blue
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
  - polygon: optional polygon boundary with [x, z] points
  - color: hex color for visual styling
  - metadata: collection metadata (optional)
  `,
  )

export type Collection = z.infer<typeof CollectionSchema>
export type CollectionType = z.infer<typeof CollectionType>
