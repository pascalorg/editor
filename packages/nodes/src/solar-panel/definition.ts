import { composeNodeDefinition } from '../definition-contributions'
import { solarPanelEditContribution } from './definition.edit'
import { solarPanelRenderDefinition } from './definition.render'

export const solarPanelDefinition = composeNodeDefinition(
  solarPanelRenderDefinition,
  solarPanelEditContribution,
)
