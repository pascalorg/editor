import { composeNodeDefinition } from '../definition-contributions'
import { rockEditContribution } from './definition.edit'
import { rockRenderDefinition } from './definition.render'

export const rockDefinition = composeNodeDefinition(rockRenderDefinition, rockEditContribution)
