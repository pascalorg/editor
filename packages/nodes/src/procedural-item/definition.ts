import { composeNodeDefinition } from '../definition-contributions'
import { proceduralItemEditContribution } from './definition.edit'
import { proceduralItemRenderDefinition } from './definition.render'

export const proceduralItemDefinition = composeNodeDefinition(
  proceduralItemRenderDefinition,
  proceduralItemEditContribution,
)
