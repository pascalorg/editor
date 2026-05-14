import type { NodeDefinition } from '@pascal-app/core'
import { spawnParametrics } from './parametrics'
import { SpawnNode } from './schema'

export const spawnDefinition: NodeDefinition<typeof SpawnNode> = {
  kind: 'spawn',
  schemaVersion: 1,
  schema: SpawnNode,
  category: 'site',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: 0,
  }),

  capabilities: {
    movable: { axes: ['x', 'z'], gridSnap: true },
    rotatable: {
      axes: ['y'],
      snapAngles: [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI],
    },
    duplicable: false, // singleton per level
    deletable: true,
    selectable: { hitVolume: 'bbox' },
  },

  parametrics: spawnParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  tool: () => import('./tool'),

  presentation: {
    label: 'Spawn Point',
    description: 'Player or camera origin within a level. One per level.',
    icon: { kind: 'iconify', name: 'lucide:flag' },
    paletteSection: 'structure',
    paletteOrder: 90, // bottom of structure list — matches legacy palette order
  },

  mcp: {
    description: 'A singleton spawn point marker placed inside a level.',
  },
}
