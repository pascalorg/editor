import { DataWidgetNode as DataWidgetNodeSchema, type NodeDefinition } from '@pascal-app/core'
import { dataWidgetParametrics } from './parametrics'
import { DataWidgetNode } from './schema'

export const dataWidgetDefinition: NodeDefinition<typeof DataWidgetNode> = {
  kind: 'data-widget',
  schemaVersion: 1,
  schema: DataWidgetNode,
  category: 'structure',

  defaults: () => {
    const stub = DataWidgetNodeSchema.parse({
      id: 'data-widget_default' as never,
      type: 'data-widget',
    })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    movable: { axes: ['x', 'z'] as const },
  },

  parametrics: dataWidgetParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: '\u653e\u7f6e\u5355\u6807\u7b7e' },
    { key: 'Esc', label: '取消' },
  ],

  presentation: {
    label: '\u5355\u6807\u7b7e',
    description: 'A single-value data label backed by a live data path.',
    icon: { kind: 'url', src: '/icons/data-widget.svg' },
    paletteSection: 'structure',
    paletteOrder: 140,
  },

  mcp: {
    description: 'A single-value label for showing a live data path.',
  },
}
