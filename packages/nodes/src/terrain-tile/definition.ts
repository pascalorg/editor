import { composeNodeDefinition } from '../definition-contributions'
import { terrainTileEditContribution } from './definition.edit'
import { terrainTileRenderDefinition } from './definition.render'

export const terrainTileDefinition = composeNodeDefinition(
  terrainTileRenderDefinition,
  terrainTileEditContribution,
)
