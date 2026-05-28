import { type NodeDefinition, LatheNode as LatheNodeSchema } from '@pascal-app/core'
import { latheParametrics } from './parametrics'
import { LatheNode } from './schema'

export const latheDefinition: NodeDefinition<typeof LatheNode> = {
  kind: 'lathe',
  schemaVersion: 1,
  schema: LatheNode,
  category: 'structure',

  defaults: () => {
    const stub = LatheNodeSchema.parse({ id: 'lathe_default' as never, type: 'lathe' })
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

  parametrics: latheParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  presentation: {
    label: 'Lathe',
    description: 'A 2D profile revolved around the Y axis. For vases, bowls, bottles, and radially symmetric curved surfaces.',
    icon: { kind: 'iconify', name: 'mdi:rotate-3d' },
    paletteSection: 'structure',
    paletteOrder: 118,
  },

  mcp: {
    description: 'A lathe (revolved) primitive. A 2D profile rotated around Y axis for vases, bowls, bottles, and symmetric curved surfaces.',
  },
}
