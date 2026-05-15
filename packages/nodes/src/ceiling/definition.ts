import type { NodeDefinition } from '@pascal-app/core'
import { ceilingParametrics } from './parametrics'
import { CeilingNode } from './schema'

/**
 * Ceiling — Phase 5 batch kind, polygon-based. Structurally identical
 * to slab but mounted at `height` rather than `elevation`.
 *
 * Capabilities:
 *  - **No `movable`**: ceiling move is bespoke via legacy `MoveCeilingTool`
 *    + the floor-plan boundary / hole editors. Capability-driven dispatch
 *    keeps the legacy mover (preserves polygon-aware behavior).
 *  - **`surfaces.top`**: items host on the ceiling at `height`.
 *  - `selectable`, `duplicable`, `deletable` standard.
 *
 * Relations: `hosts: ['item']` for ceiling-mounted items (lights, fans).
 * `cascadeDelete: 'descendants'` removes hosted items on ceiling delete.
 */
export const ceilingDefinition: NodeDefinition<typeof CeilingNode> = {
  kind: 'ceiling',
  schemaVersion: 1,
  schema: CeilingNode,
  category: 'structure',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    polygon: [],
    holes: [],
    holeMetadata: [],
    height: 2.5,
    autoFromWalls: false,
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    surfaces: {
      top: { height: (n) => (n as CeilingNode).height },
    },
    duplicable: true,
    deletable: true,
  },

  relations: {
    hosts: ['item'],
    cascadeDelete: 'descendants',
  },

  parametrics: ceilingParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  system: {
    module: () => import('./system'),
    priority: 4,
  },

  toolHints: [
    { key: 'Left click', label: 'Trace ceiling outline' },
    { key: 'Enter', label: 'Finish ceiling' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Ceiling',
    description: 'A polygon-bounded ceiling surface that hosts ceiling-mounted items.',
    icon: { kind: 'iconify', name: 'lucide:square-dashed' },
    paletteSection: 'structure',
    paletteOrder: 40,
  },

  mcp: {
    description: 'A polygon-bounded ceiling with optional cutout holes.',
  },
}
