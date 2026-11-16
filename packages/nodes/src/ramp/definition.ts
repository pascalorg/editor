import { composeNodeDefinition } from '../definition-contributions'
import { rampEditContribution } from './definition.edit'
import { rampRenderDefinition } from './definition.render'

export const rampDefinition = composeNodeDefinition(rampRenderDefinition, rampEditContribution)
