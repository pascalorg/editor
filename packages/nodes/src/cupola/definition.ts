import { composeNodeDefinition } from '../definition-contributions'
import { cupolaEditContribution } from './definition.edit'
import { cupolaRenderDefinition } from './definition.render'

export const cupolaDefinition = composeNodeDefinition(
  cupolaRenderDefinition,
  cupolaEditContribution,
)
