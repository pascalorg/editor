import { composeNodeDefinition } from '../definition-contributions'
import { shelfEditContribution } from './definition.edit'
import { shelfRenderDefinition } from './definition.render'

export const shelfDefinition = composeNodeDefinition(shelfRenderDefinition, shelfEditContribution)
