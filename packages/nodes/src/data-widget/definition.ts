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
    { key: 'Left click', label: '放置数据组件' },
    { key: 'Esc', label: '取消' },
  ],

  presentation: {
    label: 'Data Widget',
    description: 'A canvas label, badge, or card backed by static/live data.',
    icon: { kind: 'url', src: '/icons/data-widget.svg' },
    paletteSection: 'structure',
    paletteOrder: 140,
  },

  mcp: {
    description: 'A canvas data widget for showing static or live values.',
  },
}
