import { composeNodeDefinition } from '../definition-contributions'
import { floorOpeningEditContribution } from './definition.edit'
import { floorOpeningRenderDefinition } from './definition.render'

export const floorOpeningDefinition = composeNodeDefinition(
  floorOpeningRenderDefinition,
  floorOpeningEditContribution,
)
