import { composeNodeDefinition } from '../definition-contributions'
import { terrainBreakEditContribution } from './definition.edit'
import { terrainBreakRenderDefinition } from './definition.render'

export const terrainBreakDefinition = composeNodeDefinition(
  terrainBreakRenderDefinition,
  terrainBreakEditContribution,
)
