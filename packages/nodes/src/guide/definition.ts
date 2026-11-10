import { composeNodeDefinition } from '../definition-contributions'
import { guideEditContribution } from './definition.edit'
import { guideRenderDefinition } from './definition.render'

export const guideDefinition = composeNodeDefinition(guideRenderDefinition, guideEditContribution)
