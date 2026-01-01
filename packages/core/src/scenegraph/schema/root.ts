import dedent from 'dedent'
import { z } from 'zod'
import { EnvironmentNode } from './environment'
import { SiteNode } from './nodes/site'

export const RootNode = z
  .object({
    environment: EnvironmentNode.default(EnvironmentNode.parse({})),
    children: z.array(SiteNode).default([SiteNode.parse({})]),
  })
  .describe(
    dedent`
  Root object - used to represent the root of the scene
  - environment: environment config
  - children: array of site nodes
  `,
  )

export type RootNode = z.infer<typeof RootNode>
