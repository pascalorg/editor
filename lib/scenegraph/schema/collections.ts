import dedent from 'dedent'
import { z } from 'zod'
import { objectId } from './base'

const COLLECTION_TYPES = ['room', 'other'] as const
export const CollectionType = z.enum(COLLECTION_TYPES)

// Polygon boundary for collection area - array of [x, z] coordinates
export const CollectionPolygon = z.array(z.tuple([z.number(), z.number()]))

export const CollectionSchema = z
  .object({
    id: objectId('collection'),
    object: z.literal('collection').default('collection'),
    type: CollectionType.default('other'),
    levelId: z.string(), // Required - must be attached to a level
    name: z.string(),
    // Polygon boundary - array of [x, z] coordinates defining the zone
    polygon: CollectionPolygon,
    // Visual styling
    color: z.string().default('#3b82f6'), // Default blue
    metadata: z.json().optional().default({}),
  })
  .describe(
    dedent`
  Collection schema - a polygon zone attached to a level
  - object: "collection"
  - type: collection type (room, other)
  - id: collection id
  - levelId: level this collection is attached to
  - name: collection name
  - polygon: array of [x, z] points defining the zone boundary
  - color: hex color for visual styling
  - metadata: collection metadata (optional)
  `,
  )

export type Collection = z.infer<typeof CollectionSchema>
export type CollectionType = z.infer<typeof CollectionType>
export type CollectionPolygon = z.infer<typeof CollectionPolygon>
