import { composeNodeDefinition } from '../definition-contributions'
import { chimneyEditContribution } from './definition.edit'
import { chimneyRenderDefinition } from './definition.render'

export const chimneyDefinition = composeNodeDefinition(
  chimneyRenderDefinition,
  chimneyEditContribution,
)
