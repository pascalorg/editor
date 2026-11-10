import { composeNodeDefinition } from '../definition-contributions'
import { skylightEditContribution } from './definition.edit'
import { skylightRenderDefinition } from './definition.render'

export const skylightDefinition = composeNodeDefinition(
  skylightRenderDefinition,
  skylightEditContribution,
)
