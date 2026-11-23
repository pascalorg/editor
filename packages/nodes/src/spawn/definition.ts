import { composeNodeDefinition } from '../definition-contributions'
import { spawnEditContribution } from './definition.edit'
import { spawnRenderDefinition } from './definition.render'

export const spawnDefinition = composeNodeDefinition(spawnRenderDefinition, spawnEditContribution)
