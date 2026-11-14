import { composeNodeDefinition } from '../definition-contributions'
import { wallEditContribution } from './definition.edit'
import { wallRenderDefinition } from './definition.render'

export const wallDefinition = composeNodeDefinition(wallRenderDefinition, wallEditContribution)
