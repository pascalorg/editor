import type { NodeDefinition } from '@pascal-app/core'
import { shelfParametrics } from './parametrics'
import { ShelfNode } from './schema'

export const shelfDefinition: NodeDefinition<typeof ShelfNode> = {
  kind: 'shelf',
  schemaVersion: 1,
  schema: ShelfNode,
  category: 'furnish',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    width: 1.2,
    depth: 0.3,
    thickness: 0.04,
    height: 0.9,
    bracketStyle: 'minimal',
    color: '#a07050',
  }),

  capabilities: {
    movable: { axes: ['x', 'z'], gridSnap: true },
    rotatable: {
      axes: ['y'],
      snapAngles: [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI],
    },
    // The whole point of shelf: things can stack on it. Surface height
    // resolves from the node so multiple shelves at different heights stack
    // correctly (vs a fixed-height table).
    surfaces: {
      top: { height: (n) => (n as ShelfNode).height + (n as ShelfNode).thickness },
    },
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
  },

  parametrics: shelfParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  tool: () => import('./tool'),

  presentation: {
    label: 'Shelf',
    description: 'A horizontal surface for stacking other items.',
    icon: { kind: 'iconify', name: 'lucide:layers' },
    paletteSection: 'structure',
    paletteOrder: 50,
  },

  mcp: {
    description:
      'A parametric shelf with adjustable dimensions and bracket style. Stackable on its top surface.',
  },
}
