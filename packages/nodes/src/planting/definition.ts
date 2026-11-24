import { composeNodeDefinition } from '../definition-contributions'
import { plantingEditContribution } from './definition.edit'
import { plantingRenderDefinition } from './definition.render'

export const plantingDefinition = composeNodeDefinition(
  plantingRenderDefinition,
  plantingEditContribution,
)
