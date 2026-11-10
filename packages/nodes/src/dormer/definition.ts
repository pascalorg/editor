import { composeNodeDefinition } from '../definition-contributions'
import { dormerEditContribution } from './definition.edit'
import { dormerRenderDefinition } from './definition.render'

export const dormerDefinition = composeNodeDefinition(
  dormerRenderDefinition,
  dormerEditContribution,
)
