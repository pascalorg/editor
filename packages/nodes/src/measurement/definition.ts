import { measurementReferenceNodeIds, type NodeDefinition } from '@pascal-app/core'
import { buildMeasurementFloorplan } from './floorplan'
import { measurementParametrics } from './parametrics'
import { MeasurementNode } from './schema'

export const measurementDefinition: NodeDefinition<typeof MeasurementNode> = {
  kind: 'measurement',
  bake: 'strip',
  schemaVersion: 2,
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
  floorplanDependencies: (node) => measurementReferenceNodeIds(node.measurement),
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: 'Place measurement point' },
    { key: 'Enter', label: 'Finish measurement' },
    { key: 'Backspace', label: 'Remove last point' },
    { key: 'Esc', label: 'Finish and continue' },
  ],

  presentation: {
    label: 'Measurement',
    description: 'A persistent distance, angle, area, perimeter, or volume annotation.',
    icon: { kind: 'iconify', name: 'lucide:ruler' },
    hidden: true,
  },

  mcp: {
    description:
      'A persistent level-local distance, angle, area, perimeter, or volume measurement.',
  },
}
