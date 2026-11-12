import { composeNodeDefinition } from '../definition-contributions'
import { levelEditContribution } from './definition.edit'
import { levelRenderDefinition } from './definition.render'

export const levelDefinition = composeNodeDefinition(levelRenderDefinition, levelEditContribution)
