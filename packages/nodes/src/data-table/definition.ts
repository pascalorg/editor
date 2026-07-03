import { DataTableNode as DataTableNodeSchema, type NodeDefinition } from '@pascal-app/core'
import { dataTableParametrics } from './parametrics'
import { DataTableNode } from './schema'

export const dataTableDefinition: NodeDefinition<typeof DataTableNode> = {
  kind: 'data-table',
  schemaVersion: 1,
  schema: DataTableNode,
  category: 'structure',

  defaults: () => {
    const stub = DataTableNodeSchema.parse({
      id: 'data-table_default' as never,
      type: 'data-table',
    })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    sceneSelection: { outline: false },
    duplicable: true,
    deletable: true,
    movable: { axes: ['x', 'z'] as const },
  },

  parametrics: dataTableParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: 'Place table widget' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Table Widget',
    description: 'A canvas table backed by multiple static/live data values.',
    icon: { kind: 'url', src: '/icons/data-table.svg' },
    paletteSection: 'structure',
    paletteOrder: 142,
  },

  mcp: {
    description: 'A canvas table widget for showing multiple live data values.',
  },
}
