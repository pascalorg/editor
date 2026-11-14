import { composeNodeDefinition } from '../definition-contributions'
import { ridgeVentEditContribution } from './definition.edit'
import { ridgeVentRenderDefinition } from './definition.render'

export const ridgeVentDefinition = composeNodeDefinition(
  ridgeVentRenderDefinition,
  ridgeVentEditContribution,
)
