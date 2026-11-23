import { composeNodeDefinition } from '../definition-contributions'
import { gutterEditContribution } from './definition.edit'
import { gutterRenderDefinition } from './definition.render'

export const gutterDefinition = composeNodeDefinition(
  gutterRenderDefinition,
  gutterEditContribution,
)
