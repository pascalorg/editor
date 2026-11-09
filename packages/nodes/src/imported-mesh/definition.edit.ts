import type { NodeEditContribution } from '../definition-contributions'
import { buildImportedMeshFloorplan } from './floorplan'
import type { ImportedMeshNode } from './schema'

export const importedMeshEditContribution: NodeEditContribution<typeof ImportedMeshNode> = {
  snapProfile: 'item',
  floorplan: buildImportedMeshFloorplan,
}
