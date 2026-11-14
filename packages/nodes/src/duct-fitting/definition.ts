import { composeNodeDefinition } from '../definition-contributions'
import { ductFittingEditContribution } from './definition.edit'
import { ductFittingRenderDefinition } from './definition.render'

export const ductFittingDefinition = composeNodeDefinition(
  ductFittingRenderDefinition,
  ductFittingEditContribution,
)
