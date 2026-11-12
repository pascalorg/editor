import { composeNodeDefinition } from '../definition-contributions'
import { blockEditContribution } from './definition.edit'
import { blockRenderDefinition } from './definition.render'

export const blockDefinition = composeNodeDefinition(blockRenderDefinition, blockEditContribution)
export { blockBounds } from './definition.render'
