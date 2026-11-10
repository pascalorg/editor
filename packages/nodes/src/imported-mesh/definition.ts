import { composeNodeDefinition } from '../definition-contributions'
import { importedMeshEditContribution } from './definition.edit'
import { importedMeshRenderDefinition } from './definition.render'

export const importedMeshDefinition = composeNodeDefinition(
  importedMeshRenderDefinition,
  importedMeshEditContribution,
)
