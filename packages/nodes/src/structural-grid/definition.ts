import { composeNodeDefinition } from '../definition-contributions'
import { structuralGridEditContribution } from './definition.edit'
import { structuralGridRenderDefinition } from './definition.render'

export const structuralGridDefinition = composeNodeDefinition(
  structuralGridRenderDefinition,
  structuralGridEditContribution,
)
