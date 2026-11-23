import { composeNodeDefinition } from '../definition-contributions'
import { slabEditContribution } from './definition.edit'
import { slabRenderDefinition } from './definition.render'

export const slabDefinition = composeNodeDefinition(slabRenderDefinition, slabEditContribution)
