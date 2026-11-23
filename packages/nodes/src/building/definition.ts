import { composeNodeDefinition } from '../definition-contributions'
import { buildingEditContribution } from './definition.edit'
import { buildingRenderDefinition } from './definition.render'

export const buildingDefinition = composeNodeDefinition(
  buildingRenderDefinition,
  buildingEditContribution,
)
