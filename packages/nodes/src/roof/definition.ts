import { composeNodeDefinition } from '../definition-contributions'
import { roofEditContribution } from './definition.edit'
import { roofRenderDefinition } from './definition.render'

export const roofDefinition = composeNodeDefinition(roofRenderDefinition, roofEditContribution)
