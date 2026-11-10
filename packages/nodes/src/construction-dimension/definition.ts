import { composeNodeDefinition } from '../definition-contributions'
import { constructionDimensionEditContribution } from './definition.edit'
import { constructionDimensionRenderDefinition } from './definition.render'

export const constructionDimensionDefinition = composeNodeDefinition(
  constructionDimensionRenderDefinition,
  constructionDimensionEditContribution,
)
