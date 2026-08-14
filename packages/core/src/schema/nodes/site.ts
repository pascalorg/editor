// lib/scenegraph/schema/nodes/site.ts

import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

// 2D Polygon
const PropertyLineData = z.object({
  type: z.literal('polygon'),
  points: z.array(z.tuple([z.number(), z.number()])),
})

// 3D Polygon/Mesh
// const TerrainData = z.object({
//   type: z.literal('terrain'),
//   points: z.array(z.tuple([z.number(), z.number(), z.number()])),
// })

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
   * How far formwork, its access scaffold and working/striking clearances must
   * stay inside the boundary, m. The boundary itself is `polygon`. Optional
   * project data for the scaffold-versus-boundary check; nothing reads it yet,
   * and stating it changes no other output.
   */
  setback: z.number().finite().nonnegative().max(1000).optional(),
  // terrain: TerrainData,
  children: z.array(z.string()).default([]),
}).describe(
  dedent`
  Site node - used to represent a site
  - polygon: polygon data (the site boundary)
  - setback: how far formwork, access scaffold and working/striking clearances must stay inside the boundary, m
  - children: array of child node ids (buildings, items)
  `,
)

export type SiteNode = z.infer<typeof SiteNode>
