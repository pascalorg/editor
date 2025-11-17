import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeId, nodeType } from '../base'
import { BuildingNode } from './building'
import { EnvironmentNode } from './environment'
import { SiteNode } from './site'

export const RootNode = z
  .object({
    id: nodeId('root'),
    type: nodeType('root'),
    environment: EnvironmentNode.default(EnvironmentNode.parse({})),
    site: SiteNode.default(SiteNode.parse({})),
    buildings: z.array(BuildingNode).default([BuildingNode.parse({})]),
  })
  .describe(
    dedent`
  Root node - used to represent the root of the scene
  - environment: environment node
  - site: site node
  - buildings: array of building nodes
  `,
  )

export type RootNode = z.infer<typeof RootNode>
