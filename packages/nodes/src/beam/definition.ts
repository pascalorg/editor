import { composeNodeDefinition } from '../definition-contributions'
import { beamEditContribution } from './definition.edit'
import { beamRenderDefinition } from './definition.render'

export const beamDefinition = composeNodeDefinition(beamRenderDefinition, beamEditContribution)
