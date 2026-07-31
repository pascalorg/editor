// lib/scenegraph/schema/nodes/site.ts

import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { TerrainData } from '../terrain'

// 2D Polygon
const PropertyLineData = z.object({
  type: z.literal('polygon'),
  points: z.array(z.tuple([z.number(), z.number()])),
})

export const SiteNode = BaseNode.extend({
  id: objectId('site'),
  type: nodeType('site'),
  // Specific props
  polygon: PropertyLineData.optional().default({
    type: 'polygon',
    // Default 30x30 square centered at origin
    points: [
      [-15, -15],
      [15, -15],
      [15, 15],
      [-15, 15],
    ],
  }),
  /**
   * Sculpted ground. Absent means flat ground at the datum — the state every
   * scene that predates terrain is in, and the state an untouched site stays in
   * so ~11 KB of base64 zeroes does not land in every saved scene.
   */
  terrain: TerrainData.optional(),
  children: z.array(z.string()).default([]),
}).describe(
  dedent`
  Site node - used to represent a site
  - polygon: polygon data
  - terrain: optional sculpted heightfield; absent means flat ground
  - children: array of child node ids (buildings, items)
  `,
)

export type SiteNode = z.infer<typeof SiteNode>
