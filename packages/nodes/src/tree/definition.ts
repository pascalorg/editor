import { composeNodeDefinition } from '../definition-contributions'
import { treeEditContribution } from './definition.edit'
import { treeRenderDefinition } from './definition.render'

export const treeDefinition = composeNodeDefinition(treeRenderDefinition, treeEditContribution)
