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
  /**
   * True compass bearing that plan-up (-Z) points at, in degrees. Zero — the
   * default every existing scene loads with — means the model is drawn north-up.
   *
   * Without this a sun angle is a decoration rather than an analysis: an
   * azimuth means nothing until the model's own bearing is known.
   */
  northOffset: z.number().finite().min(0).max(360).default(0),
  /**
   * Where on earth the site is, for solar geometry. Absent means unplaced, and
   * a sun study has to ask before it can say anything — which is honest, where
   * defaulting to a made-up city would silently produce wrong shadows.
   */
  latitude: z.number().finite().min(-90).max(90).optional(),
  longitude: z.number().finite().min(-180).max(180).optional(),
  children: z.array(z.string()).default([]),
}).describe(
  dedent`
  Site node - used to represent a site
  - polygon: polygon data
  - terrain: optional sculpted heightfield; absent means flat ground
  - northOffset: true bearing of plan-up in degrees; 0 means drawn north-up
  - latitude/longitude: site location in degrees, for solar position; absent means unplaced
  - children: array of child node ids (buildings, items)
  `,
)

export type SiteNode = z.infer<typeof SiteNode>
