import { composeNodeDefinition } from '../definition-contributions'
import { hedgeEditContribution } from './definition.edit'
import { hedgeRenderDefinition } from './definition.render'

export const hedgeDefinition = composeNodeDefinition(hedgeRenderDefinition, hedgeEditContribution)
