import { composeNodeDefinition } from '../definition-contributions'
import { downspoutEditContribution } from './definition.edit'
import { downspoutRenderDefinition } from './definition.render'

export const downspoutDefinition = composeNodeDefinition(
  downspoutRenderDefinition,
  downspoutEditContribution,
)
