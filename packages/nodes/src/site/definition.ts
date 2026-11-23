import { composeNodeDefinition } from '../definition-contributions'
import { siteEditContribution } from './definition.edit'
import { siteRenderDefinition } from './definition.render'

export const siteDefinition = composeNodeDefinition(siteRenderDefinition, siteEditContribution)
