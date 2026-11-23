import { composeNodeDefinition } from '../definition-contributions'
import { ductTerminalEditContribution } from './definition.edit'
import { ductTerminalRenderDefinition } from './definition.render'

export const ductTerminalDefinition = composeNodeDefinition(
  ductTerminalRenderDefinition,
  ductTerminalEditContribution,
)
