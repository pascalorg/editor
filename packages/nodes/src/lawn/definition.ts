import { composeNodeDefinition } from '../definition-contributions'
import { lawnEditContribution } from './definition.edit'
import { lawnRenderDefinition } from './definition.render'

export const lawnDefinition = composeNodeDefinition(lawnRenderDefinition, lawnEditContribution)
