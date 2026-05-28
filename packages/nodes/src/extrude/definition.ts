import { ExtrudeNode as ExtrudeNodeSchema, type NodeDefinition } from '@pascal-app/core'
import { extrudeParametrics } from './parametrics'
import { ExtrudeNode } from './schema'

export const extrudeDefinition: NodeDefinition<typeof ExtrudeNode> = {
  kind: 'extrude',
  schemaVersion: 1,
  schema: ExtrudeNode,
  category: 'structure',

  defaults: () => {
    const stub = ExtrudeNodeSchema.parse({ id: 'extrude_default' as never, type: 'extrude' })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    movable: { axes: ['x', 'z'] as const },
    rotatable: { axes: ['y'] as const },
  },

  parametrics: extrudeParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  presentation: {
    label: 'Extrude',
    description:
      'A custom 2D profile extruded into depth for brackets, logos, handles, silhouettes, and shaped panels.',
    icon: { kind: 'iconify', name: 'mdi:vector-polyline' },
    paletteSection: 'structure',
    paletteOrder: 122,
  },

  mcp: {
    description:
      'A custom 2D profile extruded into depth for brackets, logos, handles, silhouettes, and shaped panels.',
  },
}
