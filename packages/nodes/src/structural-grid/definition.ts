import type { NodeDefinition } from '@pascal-app/core'
import type { FloorplanNodeExtension } from '@pascal-app/editor'
import { buildStructuralGridFloorplan } from './floorplan'
import { StructuralGridNode } from './schema'

export const structuralGridDefinition: NodeDefinition<typeof StructuralGridNode> = {
  kind: 'structural-grid',
  bake: 'strip',
  schemaVersion: 1,
  schema: StructuralGridNode,
  category: 'structure',
  extensions: {
    'pascal:editor/floorplan': {
      tool: () => import('./floorplan-tool'),
      preferredView: '2d',
    } satisfies FloorplanNodeExtension<StructuralGridNode>,
  },
  snapProfile: 'structural',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    start: [0, 0],
    end: [0, 5],
    label: '1',
    showStartBubble: true,
    showEndBubble: true,
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    deletable: true,
    presettable: false,
  },

  dirtyTracking: false,
  floorplan: buildStructuralGridFloorplan,
  toolHints: [
    { key: 'Left click', label: 'Start grid axis' },
    { key: 'Left click', label: 'Finish grid axis' },
    { key: 'Alt', label: 'Bypass snapping' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Structural Grid',
    description: 'Persistent construction grid axis with identification bubbles.',
    icon: { kind: 'url', src: '/icons/structural-grid.webp' },
    paletteSection: 'structure',
    paletteOrder: 72,
  },

  mcp: {
    description:
      'A floor-plan structural datum axis defined by two level-local points and a grid identifier.',
  },
}
