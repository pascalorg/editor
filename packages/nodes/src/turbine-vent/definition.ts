import { composeNodeDefinition } from '../definition-contributions'
import { turbineVentEditContribution } from './definition.edit'
import { turbineVentRenderDefinition } from './definition.render'

export const turbineVentDefinition = composeNodeDefinition(
  turbineVentRenderDefinition,
  turbineVentEditContribution,
)
