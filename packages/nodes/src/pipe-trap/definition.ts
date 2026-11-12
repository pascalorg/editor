import { composeNodeDefinition } from '../definition-contributions'
import { pipeTrapEditContribution } from './definition.edit'
import { pipeTrapRenderDefinition } from './definition.render'

export const pipeTrapDefinition = composeNodeDefinition(
  pipeTrapRenderDefinition,
  pipeTrapEditContribution,
)
