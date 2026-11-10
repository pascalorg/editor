import type { NodeRenderDefinition } from '../definition-contributions'
import { perNodeGeometryBatchable } from '../shared/node-batch/batchable'
import { buildImportedMeshGeometry } from './geometry'
import { ImportedMeshNode } from './schema'

export const importedMeshRenderDefinition: NodeRenderDefinition<typeof ImportedMeshNode> & {
  kind: 'imported-mesh'
} = {
  kind: 'imported-mesh',
  schemaVersion: 1,
  schema: ImportedMeshNode,
  category: 'structure',
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    primitives: [],
  }),
  capabilities: {
    batchable: perNodeGeometryBatchable,
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    presettable: false,
  },
  geometryKey: (node) => `${node.id}:${node.primitives.length}`,
  geometry: buildImportedMeshGeometry,
  presentation: {
    label: 'Imported Mesh',
    description: 'Geometry preserved from an imported model when no native Pascal shape exists.',
    icon: { kind: 'url', src: '/icons/item.webp' },
    hidden: true,
  },
  mcp: {
    description: 'Imported triangle geometry with source identity and properties in metadata.',
  },
}
