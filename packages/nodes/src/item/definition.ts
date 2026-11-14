import { composeNodeDefinition } from '../definition-contributions'
import { itemEditContribution } from './definition.edit'
import { itemRenderDefinition } from './definition.render'

export const itemDefinition = composeNodeDefinition(itemRenderDefinition, itemEditContribution)
