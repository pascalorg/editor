import { composeNodeDefinition } from '../definition-contributions'
import { measurementEditContribution } from './definition.edit'
import { measurementRenderDefinition } from './definition.render'

export const measurementDefinition = composeNodeDefinition(
  measurementRenderDefinition,
  measurementEditContribution,
)
