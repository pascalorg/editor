import { composeNodeDefinition } from '../definition-contributions'
import { pipeSegmentEditContribution } from './definition.edit'
import { pipeSegmentRenderDefinition } from './definition.render'

export const pipeSegmentDefinition = composeNodeDefinition(
  pipeSegmentRenderDefinition,
  pipeSegmentEditContribution,
)
