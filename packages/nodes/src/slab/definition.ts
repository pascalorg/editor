import type { NodeDefinition } from '@pascal-app/core'
import { slabParametrics } from './parametrics'
import { SlabNode } from './schema'

/**
 * Slab — Phase 5 batch kind, polygon-based.
 *
 * Capabilities:
 *  - **No `movable`**: slab's "move" today is whole-slab translation via
 *    legacy `MoveSlabTool`, which integrates with the floor-plan boundary /
 *    hole editors. Per the capability-driven dispatch rule, omitting
 *    `movable` keeps the legacy mover (preserves polygon-aware behavior).
 *    Migration to the generic mover is possible in a later milestone if
 *    the legacy mover proves equivalent.
 *  - **`surfaces.top`**: items host on the slab top at `elevation`.
 *  - `selectable`, `duplicable`, `deletable` standard.
 *
 * Relations:
 *  - `hosts: ['item']` — items mount on the slab top.
 *  - `cascadeDelete: 'descendants'` — deleting a slab removes hosted items.
 *
 * Renderer + system: thin renderer + re-export of the legacy `SlabSystem`.
 * Same shape as wall / fence runtime port.
 *
 * Tool field absent: slab has 3 tools (slab-tool, boundary-editor, hole-
 * editor) wired through editor state, not registry dispatch.
 */
export const slabDefinition: NodeDefinition<typeof SlabNode> = {
  kind: 'slab',
  schemaVersion: 1,
  schema: SlabNode,
  category: 'structure',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    polygon: [],
    holes: [],
    holeMetadata: [],
    elevation: 0.05,
    autoFromWalls: false,
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    surfaces: {
      top: { height: (n) => (n as SlabNode).elevation },
    },
    duplicable: true,
    deletable: true,
  },

  relations: {
    hosts: ['item'],
    cascadeDelete: 'descendants',
  },

  parametrics: slabParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  system: {
    module: () => import('./system'),
    priority: 4,
  },

  toolHints: [
    { key: 'Left click', label: 'Trace slab outline' },
    { key: 'Enter', label: 'Finish slab' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Slab',
    description: 'A polygon-bounded floor surface that hosts items on top.',
    icon: { kind: 'iconify', name: 'lucide:square' },
    paletteSection: 'structure',
    paletteOrder: 30,
  },

  mcp: {
    description: 'A polygon-bounded slab (floor) with optional cutout holes.',
  },
}
