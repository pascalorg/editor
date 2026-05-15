import type { NodeDefinition } from '@pascal-app/core'
import { buildSlabFloorplan } from './floorplan'
import { buildSlabGeometry } from './geometry'
import { slabParametrics } from './parametrics'
import { SlabNode } from './schema'

/**
 * Slab — Phase 5 batch kind, polygon-based. Stage B: `def.geometry`
 * drives the rebuild via generic <GeometrySystem>; <ParametricNodeRenderer>
 * mounts the empty group. No per-kind renderer or system file.
 *
 * Capabilities:
 *  - **No `movable`**: slab's "move" today is whole-slab translation via
 *    legacy `MoveSlabTool`, which integrates with the floor-plan boundary /
 *    hole editors. Capability-driven dispatch keeps the legacy mover.
 *  - **`surfaces.top`**: items host on the slab top at `elevation`.
 *  - `selectable`, `duplicable`, `deletable` standard.
 *
 * Relations:
 *  - `hosts: ['item']` — items mount on the slab top.
 *  - `cascadeDelete: 'descendants'` — deleting a slab removes hosted items.
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

  // Stage B: pure geometry function.
  geometry: buildSlabGeometry,
  // Stage C: floor-plan rendering. Legacy `slabPolygons` short-circuits
  // to [] when slab is registered (see floorplan-panel.tsx).
  floorplan: buildSlabFloorplan,

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
