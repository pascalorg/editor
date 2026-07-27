import type { NodeDefinition } from '@pascal-app/core'
import { buildImportedMeshFloorplan } from './floorplan'
import { buildImportedMeshGeometry } from './geometry'
import { ImportedMeshNode } from './schema'

/** Format-neutral fallback for imported objects without a parametric node. */
export const importedMeshDefinition: NodeDefinition<typeof ImportedMeshNode> = {
  kind: 'imported-mesh',
  schemaVersion: 1,
  schema: ImportedMeshNode,
  category: 'structure',
  snapProfile: 'item',
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
    selectable: { hitVolume: 'bbox' },
    movable: { axes: ['x', 'y', 'z'], gridSnap: true },
    duplicable: true,
    deletable: true,
    presettable: false,
  },
  geometry: buildImportedMeshGeometry,
  floorplan: buildImportedMeshFloorplan,
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
