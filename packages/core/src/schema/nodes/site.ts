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

export const DEFAULT_NORTH_DIRECTION_DEG = 0

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
   * Site north heading in degrees, clockwise from world −Z toward +X.
   * Zero preserves the established scene convention: +Z is south.
   */
  northDirectionDeg: z
    .number()
    .finite()
    .default(DEFAULT_NORTH_DIRECTION_DEG)
    .transform((deg) => {
      const canonical = ((deg % 360) + 360) % 360
      return Object.is(canonical, -0) ? 0 : canonical
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
  - northDirectionDeg: site north heading in degrees, clockwise from world −Z toward +X; 0 means +Z is south
  - terrain: optional sculpted heightfield; absent means flat ground
  - children: array of child node ids (buildings, items)
  `,
)

export type SiteNode = z.infer<typeof SiteNode>
