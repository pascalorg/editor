import type { NodeEditContribution } from '../definition-contributions'
import type { ImportedMeshNode } from './schema'

export const importedMeshEditContribution: NodeEditContribution<typeof ImportedMeshNode> = {
  snapProfile: 'item',
}
