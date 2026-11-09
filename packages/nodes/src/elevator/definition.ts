import { composeNodeDefinition } from '../definition-contributions'
import { elevatorEditContribution } from './definition.edit'
import { elevatorRenderDefinition } from './definition.render'

export const elevatorDefinition = composeNodeDefinition(
  elevatorRenderDefinition,
  elevatorEditContribution,
)
