import { composeNodeDefinition } from '../definition-contributions'
import { scanEditContribution } from './definition.edit'
import { scanRenderDefinition } from './definition.render'

export const scanDefinition = composeNodeDefinition(scanRenderDefinition, scanEditContribution)
