import { composeNodeDefinition } from '../definition-contributions'
import { pipeFittingEditContribution } from './definition.edit'
import { pipeFittingRenderDefinition } from './definition.render'

export const pipeFittingDefinition = composeNodeDefinition(
  pipeFittingRenderDefinition,
  pipeFittingEditContribution,
)
