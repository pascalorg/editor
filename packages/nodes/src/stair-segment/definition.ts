import { composeNodeDefinition } from '../definition-contributions'
import { stairSegmentEditContribution } from './definition.edit'
import { stairSegmentRenderDefinition } from './definition.render'

export const stairSegmentDefinition = composeNodeDefinition(
  stairSegmentRenderDefinition,
  stairSegmentEditContribution,
)
