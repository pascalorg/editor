import { composeNodeDefinition } from '../definition-contributions'
import { ductSegmentEditContribution } from './definition.edit'
import { ductSegmentRenderDefinition } from './definition.render'

export const ductSegmentDefinition = composeNodeDefinition(
  ductSegmentRenderDefinition,
  ductSegmentEditContribution,
)
