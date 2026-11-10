import type { NodeRenderDefinition } from '../definition-contributions'
import { MeasurementNode } from './schema'

export const measurementRenderDefinition: NodeRenderDefinition<typeof MeasurementNode> & {
  kind: 'measurement'
} = {
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
  dirtyTracking: false,
  rendersChildren: false,
  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  presentation: {
    label: 'Measurement',
    description: 'A persistent distance, angle, area, perimeter, or volume annotation.',
    icon: { kind: 'url', src: '/icons/measure.webp' },
    hidden: true,
    actionMenu: false,
  },
  mcp: {
    description:
      'A persistent level-local distance, angle, area, perimeter, or volume measurement.',
  },
}
