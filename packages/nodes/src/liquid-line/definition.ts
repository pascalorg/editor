import { composeNodeDefinition } from '../definition-contributions'
import { liquidLineEditContribution } from './definition.edit'
import { liquidLineRenderDefinition } from './definition.render'

export const liquidLineDefinition = composeNodeDefinition(
  liquidLineRenderDefinition,
  liquidLineEditContribution,
)
