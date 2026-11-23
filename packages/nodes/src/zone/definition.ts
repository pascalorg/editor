import { composeNodeDefinition } from '../definition-contributions'
import { zoneEditContribution } from './definition.edit'
import { zoneRenderDefinition } from './definition.render'

export const zoneDefinition = composeNodeDefinition(zoneRenderDefinition, zoneEditContribution)
