import { AssemblyNode as AssemblyNodeSchema, type NodeDefinition } from '@pascal-app/core'
import { buildAssemblyGeometry } from './geometry'
import { assemblyParametrics } from './parametrics'
import { AssemblyNode } from './schema'

export const assemblyDefinition: NodeDefinition<typeof AssemblyNode> = {
  kind: 'assembly',
  schemaVersion: 1,
  schema: AssemblyNode,
  category: 'structure',

  defaults: () => {
    const stub = AssemblyNodeSchema.parse({ id: 'assembly_default' as never, type: 'assembly' })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    movable: { axes: ['x', 'z'] as const, gridSnap: true },
    rotatable: { axes: ['y'] as const },
  },

  parametrics: assemblyParametrics,

  relations: {
    cascadeDelete: 'descendants',
  },

  geometry: buildAssemblyGeometry,

  presentation: {
    label: 'Assembly',
    description: 'Transformable group for multi-part generated objects.',
    icon: { kind: 'iconify', name: 'mdi:group' },
    paletteSection: 'structure',
    hidden: true,
  },

  mcp: {
    description: 'A transformable parent group for multi-part generated objects.',
  },
}
