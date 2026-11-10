import { composeNodeDefinition } from '../definition-contributions'
import { ceilingEditContribution } from './definition.edit'
import { ceilingRenderDefinition } from './definition.render'

export const ceilingDefinition = composeNodeDefinition(
  ceilingRenderDefinition,
  ceilingEditContribution,
)
