import type { NodeDefinition } from '@pascal-app/core'
import { buildInstanceFloorplan } from './floorplan'
import { InstanceNode } from './schema'

export const instanceDefinition: NodeDefinition<typeof InstanceNode> = {
  kind: 'instance',
  schemaVersion: 1,
  schema: InstanceNode,
  category: 'structure',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    definitionId: 'definition_unassigned',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  }),

  capabilities: {
    movable: { axes: ['x', 'z'], gridSnap: true },
    rotatable: {
      axes: ['y'],
      snapAngles: Array.from({ length: 8 }, (_, index) => (index * Math.PI) / 4),
    },
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    groupable: true,
    presettable: false,
  },

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  system: {
    module: () => import('./system'),
    priority: 3,
  },
  floorplan: buildInstanceFloorplan,

  presentation: {
    label: 'Component Instance',
    description: 'A placed reference to a shared component definition.',
    icon: { kind: 'iconify', name: 'lucide:boxes' },
    hidden: true,
  },

  mcp: {
    description: 'A placed reference to a shared component definition.',
  },
}
