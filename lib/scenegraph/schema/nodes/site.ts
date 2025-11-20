// lib/scenegraph/schema/nodes/site.ts

import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeId, nodeType } from '../base'
import { BuildingNode } from './building'
import { ItemNode } from './item'

export const SiteNode = BaseNode.extend({
  id: nodeId('site'),
  type: nodeType('site'),
  // Specific props: none for now
  //   propertyLines: PropertyLineNode, // TODO: Add property line node
  //   terrain: TerrainNode, // TODO: Add terrain node
  // landscape: z.array(z.discriminatedUnion('type', [PlantNode])), // TODO: Add landscape node
  children: z
    .array(z.discriminatedUnion('type', [BuildingNode, ItemNode]))
    .default([BuildingNode.parse({})]),
}).describe(
  dedent`
  Site node - used to represent a site
  - propertyLines: property line node
  - terrain: terrain node
  - landscape: landscape node
  - children: array of building and item nodes
  `,
)

export type SiteNode = z.infer<typeof SiteNode>
