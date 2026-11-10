import { composeNodeDefinition } from '../definition-contributions'
import { separatorEditContribution } from './definition.edit'
import { separatorRenderDefinition } from './definition.render'

export const separatorDefinition = composeNodeDefinition(
  separatorRenderDefinition,
  separatorEditContribution,
)
