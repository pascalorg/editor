import { composeNodeDefinition } from '../definition-contributions'
import { linesetEditContribution } from './definition.edit'
import { linesetRenderDefinition } from './definition.render'

export const linesetDefinition = composeNodeDefinition(
  linesetRenderDefinition,
  linesetEditContribution,
)
