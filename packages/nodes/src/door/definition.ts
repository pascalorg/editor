import { composeNodeDefinition } from '../definition-contributions'
import { doorEditContribution } from './definition.edit'
import { doorRenderDefinition } from './definition.render'

export const doorDefinition = composeNodeDefinition(doorRenderDefinition, doorEditContribution)
