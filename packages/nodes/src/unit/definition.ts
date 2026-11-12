import { composeNodeDefinition } from '../definition-contributions'
import { unitEditContribution } from './definition.edit'
import { unitRenderDefinition } from './definition.render'

export const unitDefinition = composeNodeDefinition(unitRenderDefinition, unitEditContribution)
