import dedent from 'dedent'
import { z } from 'zod'
import { objectId } from './base'

// Polygon boundary for zone area - array of [x, z] coordinates
export const ZonePolygon = z.array(z.tuple([z.number(), z.number()]))

export const ZoneSchema = z
  .object({
    id: objectId('zone'),
    object: z.literal('zone').default('zone'),
    levelId: z.string(), // Required - must be attached to a level
    name: z.string(),
    // Polygon boundary - array of [x, z] coordinates defining the zone
    polygon: ZonePolygon,
    // Visual styling
    color: z.string().default('#3b82f6'), // Default blue
    metadata: z.json().optional().default({}),
  })
  .describe(
    dedent`
  Zone schema - a polygon zone attached to a level
  - object: "zone"
  - id: zone id
  - levelId: level this zone is attached to
  - name: zone name
  - polygon: array of [x, z] points defining the zone boundary
  - color: hex color for visual styling
  - metadata: zone metadata (optional)
  `,
  )

export type Zone = z.infer<typeof ZoneSchema>
export type ZonePolygon = z.infer<typeof ZonePolygon>
