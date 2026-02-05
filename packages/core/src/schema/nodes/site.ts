// lib/scenegraph/schema/nodes/site.ts

import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { BuildingNode } from './building'
import { ItemNode } from './item'

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
  // terrain: TerrainData,
  children: z
    .array(z.discriminatedUnion('type', [BuildingNode, ItemNode]))
    .default([BuildingNode.parse({})]),
}).describe(
  dedent`
  Site node - used to represent a site
  - polygon: polygon data
  - children: array of building and item nodes
  `,
)

export type SiteNode = z.infer<typeof SiteNode>
