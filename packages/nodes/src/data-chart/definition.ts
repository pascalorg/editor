import { DataChartNode as DataChartNodeSchema, type NodeDefinition } from '@pascal-app/core'
import { dataChartParametrics } from './parametrics'
import { DataChartNode } from './schema'

export const dataChartDefinition: NodeDefinition<typeof DataChartNode> = {
  kind: 'data-chart',
  schemaVersion: 1,
  schema: DataChartNode,
  category: 'structure',

  defaults: () => {
    const stub = DataChartNodeSchema.parse({
      id: 'data-chart_default' as never,
      type: 'data-chart',
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

  parametrics: dataChartParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: 'Place chart widget' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Chart Widget',
    description: 'A canvas chart backed by static/live data.',
    icon: { kind: 'url', src: '/icons/data-chart.svg' },
    paletteSection: 'structure',
    paletteOrder: 141,
  },

  mcp: {
    description: 'A canvas chart widget for showing live values as bars or a line.',
  },
}
