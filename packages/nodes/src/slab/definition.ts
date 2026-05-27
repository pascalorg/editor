import type { HandleDescriptor, NodeDefinition, SlabNode as SlabNodeType } from '@pascal-app/core'
import { buildSlabFloorplan } from './floorplan'
import {
  slabAddVertexAffordance,
  slabMoveEdgeAffordance,
  slabMoveVertexAffordance,
} from './floorplan-affordances'
import { slabFloorplanMoveTarget } from './floorplan-move'
import { buildSlabGeometry } from './geometry'
import { slabParametrics } from './parametrics'
import { SlabNode } from './schema'

const HEIGHT_HANDLE_OFFSET = 0.22
const MIN_SLAB_ELEVATION = 0.02

function slabPolygonCenter(n: SlabNodeType): [number, number] {
  const polygon = n.polygon ?? []
  if (polygon.length === 0) return [0, 0]
  let cx = 0
  let cz = 0
  for (const [x, z] of polygon) {
    cx += x
    cz += z
  }
  return [cx / polygon.length, cz / polygon.length]
}

// Slab height arrow — vertical chevron at the polygon centroid, just
// above the slab's top face. Drags elevation (the extrusion thickness)
// with `anchor: 'min'` so the bottom stays at world Y=0 and the top
// follows the pointer. Same registry-handle pipeline as the column
// height arrow, so live override + commit-on-release come for free.
function slabHeightHandle(): HandleDescriptor<SlabNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min',
    min: MIN_SLAB_ELEVATION,
    currentValue: (n) => n.elevation ?? 0.05,
    apply: (_n, newValue) => ({ elevation: newValue }),
    placement: {
      position: (n) => {
        const [cx, cz] = slabPolygonCenter(n)
        const elevation = n.elevation ?? 0.05
        return [cx, elevation + HEIGHT_HANDLE_OFFSET, cz]
      },
    },
  }
}

function slabHandles(_node: SlabNodeType): HandleDescriptor<SlabNodeType>[] {
  return [slabHeightHandle()]
}

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
  surfaceRole: 'floor',

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
  handles: slabHandles,

  // Stage D: kind-owned placement tool. Multi-click polygon drawing
  // with axis/45° snap (Shift to defeat).
  tool: () => import('./tool'),

  // Stage D — all four slab drag-affordances live in this folder.
  // boundary-edit / hole-edit are thin <PolygonEditor> wrappers; move
  // is a 1:1 port of the legacy MoveSlabTool (scene.update per tick
  // with the same history dance, no live-drag exception).
  affordanceTools: {
    'boundary-edit': () => import('./boundary-editor'),
    'hole-edit': () => import('./hole-editor'),
    move: () => import('./move-tool'),
  },

  // Stage B: pure geometry function.
  geometry: buildSlabGeometry,
  // Stage C: floor-plan rendering. Legacy `slabPolygons` short-circuits
  // to [] when slab is registered (see floorplan-panel.tsx).
  floorplan: buildSlabFloorplan,
  // 2D move handler — translates polygon by cursor delta from first
  // pointer position. The 3D `MoveSlabTool` in `affordanceTools.move`
  // skips events sourced from the 2D scene so the two paths don't
  // double-write on commit.
  floorplanMoveTarget: slabFloorplanMoveTarget,
  // Sister to `affordanceTools['boundary-edit']` (the 3D `PolygonEditor`
  // wrapper). The 2D version edits the same `polygon` field via SVG
  // pointer events on the vertex handles emitted by `def.floorplan`.
  floorplanAffordances: {
    'move-vertex': slabMoveVertexAffordance,
    'add-vertex': slabAddVertexAffordance,
    'move-edge': slabMoveEdgeAffordance,
  },

  toolHints: [
    { key: 'Left click', label: 'Trace slab outline' },
    { key: 'Enter', label: 'Finish slab' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Slab',
    description: 'A polygon-bounded floor surface that hosts items on top.',
    icon: { kind: 'url', src: '/icons/floor.png' },
    paletteSection: 'structure',
    paletteOrder: 30,
  },

  mcp: {
    description: 'A polygon-bounded slab (floor) with optional cutout holes.',
  },
}
