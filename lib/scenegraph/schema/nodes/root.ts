import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, id, nodeType } from '../base'
import { BuildingNode } from './building'
import { EnvironmentNode } from './environment'
import { SiteNode } from './site'

export const RootNode = BaseNode.extend({
  id: id('root'),
  type: nodeType('root'),
  environment: EnvironmentNode.default(EnvironmentNode.parse({})),
  site: SiteNode.default(SiteNode.parse({})),
  buildings: z.array(BuildingNode).default([]),
}).describe(
  dedent`
  Root node - used to represent the root of the scene
  - environment: environment node
  - site: site node
  - buildings: array of building nodes
  `,
)

export type RootNode = z.infer<typeof RootNode>
