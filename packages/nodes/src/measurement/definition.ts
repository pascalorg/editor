import type { NodeDefinition } from '@pascal-app/core'
import { buildMeasurementFloorplan } from './floorplan'
import { measurementParametrics } from './parametrics'
import { MeasurementNode } from './schema'

export const measurementDefinition: NodeDefinition<typeof MeasurementNode> = {
  kind: 'measurement',
  bake: 'strip',
  schemaVersion: 1,
  schema: MeasurementNode,
  category: 'analysis',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    measurement: {
      kind: 'distance',
      points: [
        [0, 0, 0],
        [1, 0, 0],
      ],
    },
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    deletable: true,
    duplicable: true,
    presettable: false,
  },

  parametrics: measurementParametrics,
  dirtyTracking: false,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  floorplan: buildMeasurementFloorplan,
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: 'Place measurement point' },
    { key: 'Enter', label: 'Finish measurement' },
    { key: 'Backspace', label: 'Remove last point' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Measurement',
    description: 'A persistent distance, area, or volume annotation.',
    icon: { kind: 'iconify', name: 'lucide:ruler' },
    hidden: true,
  },

  mcp: {
    description: 'A persistent level-local distance, area, or volume measurement.',
  },
}
