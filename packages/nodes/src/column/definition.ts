import { composeNodeDefinition } from '../definition-contributions'
import { columnEditContribution } from './definition.edit'
import { columnRenderDefinition } from './definition.render'

export const columnDefinition = composeNodeDefinition(
  columnRenderDefinition,
  columnEditContribution,
)
