import { composeNodeDefinition } from '../definition-contributions'
import { eyebrowVentEditContribution } from './definition.edit'
import { eyebrowVentRenderDefinition } from './definition.render'

export const eyebrowVentDefinition = composeNodeDefinition(
  eyebrowVentRenderDefinition,
  eyebrowVentEditContribution,
)
