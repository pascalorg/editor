import { composeNodeDefinition } from '../definition-contributions'
import { stairEditContribution } from './definition.edit'
import { stairRenderDefinition } from './definition.render'

export const stairDefinition = composeNodeDefinition(stairRenderDefinition, stairEditContribution)
