import { composeNodeDefinition } from '../definition-contributions'
import { fenceGateEditContribution, fenceOpeningEditContribution } from './definition.edit'
import { fenceGateRenderDefinition, fenceOpeningRenderDefinition } from './definition.render'

export const fenceGateDefinition = composeNodeDefinition(
  fenceGateRenderDefinition,
  fenceGateEditContribution,
)
export const fenceOpeningDefinition = composeNodeDefinition(
  fenceOpeningRenderDefinition,
  fenceOpeningEditContribution,
)
