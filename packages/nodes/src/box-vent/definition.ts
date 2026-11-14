import { composeNodeDefinition } from '../definition-contributions'
import { boxVentEditContribution } from './definition.edit'
import { boxVentRenderDefinition } from './definition.render'

export const boxVentDefinition = composeNodeDefinition(
  boxVentRenderDefinition,
  boxVentEditContribution,
)
