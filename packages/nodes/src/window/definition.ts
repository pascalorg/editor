import { composeNodeDefinition } from '../definition-contributions'
import { windowEditContribution } from './definition.edit'
import { windowRenderDefinition } from './definition.render'

export const windowDefinition = composeNodeDefinition(
  windowRenderDefinition,
  windowEditContribution,
)
export { resolveWindowHandlePortalTarget } from './definition.render'
