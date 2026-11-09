import { composeNodeDefinition } from '../definition-contributions'
import { roofSegmentEditContribution } from './definition.edit'
import { roofSegmentRenderDefinition } from './definition.render'

export const roofSegmentDefinition = composeNodeDefinition(
  roofSegmentRenderDefinition,
  roofSegmentEditContribution,
)
