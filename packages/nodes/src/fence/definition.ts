import { composeNodeDefinition } from '../definition-contributions'
import { fenceEditContribution } from './definition.edit'
import { fenceRenderDefinition } from './definition.render'

export const fenceDefinition = composeNodeDefinition(fenceRenderDefinition, fenceEditContribution)
export { fenceBaseElevation } from './definition.render'
