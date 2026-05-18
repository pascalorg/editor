import type { NodeDefinition } from '@pascal-app/core'
import { buildShelfFloorplan } from './floorplan'
import { buildShelfGeometry } from './geometry'
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

  // Three-checkbox composition: shelf needs only pure builder functions.
  // The framework's <ParametricNodeRenderer> + <GeometrySystem> handle 3D
  // mount and rebuild on dirty; the <FloorplanRegistryLayer> calls
  // buildShelfFloorplan for the 2D top-down view. No renderer.tsx, no
  // system.tsx, no inline floor-plan SVG — see
  // `wiki/architecture/node-definitions.md`. Shelf is the reference port
  // proving Phase 4's boilerplate collapse for both 3D and 2D.
  geometry: buildShelfGeometry,
  floorplan: buildShelfFloorplan,

  preview: () => import('./preview'),
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: 'Place shelf' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Shelf',
    description: 'A horizontal surface for stacking other items.',
    icon: { kind: 'url', src: '/icons/column.png' },
    paletteSection: 'structure',
    paletteOrder: 50,
  },

  mcp: {
    description:
      'A parametric shelf with adjustable dimensions and bracket style. Stackable on its top surface.',
  },
}
