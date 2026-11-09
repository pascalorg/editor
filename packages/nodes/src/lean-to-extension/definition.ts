import { composeNodeDefinition } from '../definition-contributions'
import { leanToExtensionEditContribution } from './definition.edit'
import { leanToExtensionRenderDefinition } from './definition.render'

export const leanToExtensionDefinition = composeNodeDefinition(
  leanToExtensionRenderDefinition,
  leanToExtensionEditContribution,
)
