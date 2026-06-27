import type { HandleDescriptor, NodeDefinition, ShelfNode as ShelfNodeType } from '@pascal-app/core'
import { sanitizeShelfDimensions } from './dimensions'
import { buildShelfFloorplan } from './floorplan'
import { shelfResizeAffordance, shelfRotateAffordance } from './floorplan-affordances'
import { shelfFloorplanMoveTarget } from './floorplan-move'
import { buildShelfGeometry, shelfRowSurfaceYs } from './geometry'
import { shelfPaint } from './paint'
import { shelfParametrics } from './parametrics'
import { ShelfNode } from './schema'
import { shelfSlots } from './slots'

const SIDE_HANDLE_OFFSET = 0.18
const HEIGHT_HANDLE_OFFSET = 0.22
const ROTATE_CORNER_OFFSET = 0.32
const ROTATE_RING_OFFSET = 0.04
const MOVE_FRONT_OFFSET = 0.35
const MIN_SHELF_WIDTH = 0.3
const MIN_SHELF_DEPTH = 0.1
const MIN_SHELF_HEIGHT = 0.05

// Width arrow — anchor='center' so dragging the +X side grows the full
// width symmetrically (both edges move ±delta), matching the column /
// elevator pattern.
function shelfWidthHandle(): HandleDescriptor<ShelfNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'x',
    anchor: 'center',
    min: MIN_SHELF_WIDTH,
    currentValue: (n) => n.width,
    apply: (_n, newValue) => ({ width: newValue }),
    placement: {
      position: (n) => [n.width / 2 + SIDE_HANDLE_OFFSET, n.height / 2, 0],
    },
  }
}

// Depth arrow — symmetric on the +Z side.
function shelfDepthHandle(): HandleDescriptor<ShelfNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'z',
    anchor: 'center',
    min: MIN_SHELF_DEPTH,
    currentValue: (n) => n.depth,
    apply: (_n, newValue) => ({ depth: newValue }),
    placement: {
      position: (n) => [0, n.height / 2, n.depth / 2 + SIDE_HANDLE_OFFSET],
    },
  }
}

// Height arrow — anchor='min' so the base stays on the floor and the
// top edge follows the cursor.
function shelfHeightHandle(): HandleDescriptor<ShelfNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min',
    min: MIN_SHELF_HEIGHT,
    currentValue: (n) => n.height,
    apply: (_n, newValue) => ({ height: newValue }),
    placement: {
      position: (n) => [0, n.height + HEIGHT_HANDLE_OFFSET, 0],
    },
  }
}

// Whole-shelf rotation gizmo — curved two-headed arrow at the front of
// the footprint, guide ring traces the corner-diagonal radius on hover
// / drag. Same pattern as the elevator / column rotate gizmo; differs
// only because shelf stores rotation as a `[x, y, z]` tuple, so the
// apply patch writes back the whole tuple with Y mutated.
function shelfRotateHandle(): HandleDescriptor<ShelfNodeType> {
  return {
    kind: 'arc-resize',
    axis: 'angular',
    shape: 'rotate',
    apply: (initial, delta) => {
      const r = initial.rotation ?? [0, 0, 0]
      // Negate to match three.js Y-rotation handedness (cursor atan2
      // ticks opposite-handed from `rotation-y`).
      return { rotation: [r[0], (r[1] ?? 0) - delta, r[2]] as [number, number, number] }
    },
    placement: {
      position: (n) => {
        const halfZ = n.depth / 2
        const yMid = Math.max(n.height, MIN_SHELF_HEIGHT) / 2
        return [n.width / 2, yMid, halfZ + ROTATE_CORNER_OFFSET]
      },
      // Tilt the curve toward the shelf's front face.
      rotationY: () => -Math.PI / 4,
    },
    decoration: {
      kind: 'ring',
      radius: (n) => Math.hypot(n.width / 2, n.depth / 2) + ROTATE_RING_OFFSET,
      y: (n) => Math.max(n.height, MIN_SHELF_HEIGHT) / 2,
    },
  }
}

function shelfMoveHandle(): HandleDescriptor<ShelfNodeType> {
  return {
    kind: 'translate',
    placement: {
      // Low to the floor at the front edge (matches the item move grip) so it
      // reads as a floor-move grip and stays clear of the body resize / rotate
      // handles that sit at mid-height.
      position: (n) => {
        const shelf = sanitizeShelfDimensions(n as ShelfNode)
        return [0, 0.02, shelf.depth / 2 + MOVE_FRONT_OFFSET]
      },
    },
    apply: (_n, pos) => ({ position: [pos[0], pos[1], pos[2]] }),
    snapExtents: (n) => {
      const shelf = sanitizeShelfDimensions(n as ShelfNode)
      const swap = Math.abs(Math.sin(shelf.rotation[1] ?? 0)) > 0.9
      return [swap ? shelf.depth : shelf.width, swap ? shelf.width : shelf.depth]
    },
  }
}

function shelfHandles(_node: ShelfNodeType): HandleDescriptor<ShelfNodeType>[] {
  return [
    shelfWidthHandle(),
    shelfDepthHandle(),
    shelfHeightHandle(),
    shelfRotateHandle(),
    shelfMoveHandle(),
  ]
}

export const shelfDefinition: NodeDefinition<typeof ShelfNode> = {
  kind: 'shelf',
  snapProfile: 'item',
  facingIndicator: true,
  schemaVersion: 2,
  schema: ShelfNode,
  category: 'furnish',
  surfaceRole: 'joinery',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    width: 1,
    depth: 0.5,
    thickness: 0.05,
    height: 1.8,
    style: 'cubby',
    rows: 3,
    columns: 2,
    withBack: true,
    withSides: true,
    withBottom: true,
    bracketStyle: 'minimal',
    // material / materialPreset left undefined — geometry falls back to
    // the per-slot off-white default, and slot paint mode writes chosen
    // catalog materials into `slots`.
  }),

  capabilities: {
    movable: { axes: ['x', 'z'], gridSnap: true },
    rotatable: {
      axes: ['y'],
      snapAngles: [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI],
    },
    // Multi-row hosting: each row's top board exposes a surface so items
    // can stack on whichever row the cursor targets. `surfaces.top`
    // points at the topmost board (legacy compatibility — code that
    // assumes a single surface still works). `surfaces.custom` emits
    // one `SurfacePoint` per row centered on (0, rowY, 0) — the
    // placement coordinator's shelf strategy picks the closest by
    // cursor local-Y and snaps there.
    surfaces: {
      top: { height: (n) => shelfRowSurfaceYs(n as ShelfNode).at(-1) ?? 0 },
      custom: (n) =>
        shelfRowSurfaceYs(n as ShelfNode).map((y) => ({
          position: [0, y, 0] as const,
          normal: [0, 1, 0] as const,
        })),
    },
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    paint: shelfPaint,
    slots: (n) => shelfSlots(n as ShelfNode),
    // Slab elevation lift via the generic `<FloorElevationSystem>` — a
    // shelf sitting over a raised slab visually rests on top of it.
    floorPlaced: {
      footprint: (node) => {
        const shelf = sanitizeShelfDimensions(node as ShelfNode)
        return {
          dimensions: [shelf.width, shelf.height, shelf.depth] as [number, number, number],
          rotation: shelf.rotation,
        }
      },
      collides: true,
    },
  },

  // Items host on shelves the same way they host on slabs / other items —
  // declared here so the placement coordinator's shelf strategy can
  // confirm parent-kind compatibility before reparenting.
  relations: {
    hosts: ['item'],
    cascadeDelete: 'descendants',
  },

  parametrics: shelfParametrics,
  handles: shelfHandles,

  // Three-checkbox composition: shelf needs only pure builder functions.
  // The framework's <ParametricNodeRenderer> + <GeometrySystem> handle 3D
  // mount and rebuild on dirty; the <FloorplanRegistryLayer> calls
  // buildShelfFloorplan for the 2D top-down view. No renderer.tsx, no
  // system.tsx, no inline floor-plan SVG — see
  // `wiki/architecture/node-definitions.md`.
  geometry: buildShelfGeometry,
  // Boards/posts/back depend only on these fields — never on hosted
  // `children`. Lets <GeometrySystem> skip the dispose+rebuild (and the
  // pointer enter/leave churn it causes) when an item reparents onto a row.
  geometryKey: (n) => {
    const s = sanitizeShelfDimensions(n as ShelfNode)
    return JSON.stringify([
      s.style,
      s.width,
      s.depth,
      s.thickness,
      s.height,
      s.rows,
      s.columns,
      s.withBack,
      s.withSides,
      s.withBottom,
      s.bracketStyle,
      s.material,
      s.materialPreset,
      JSON.stringify(s.slots ?? null),
    ])
  },
  floorplan: buildShelfFloorplan,
  // 2D move handler — Path 1 in `FloorplanRegistryMoveOverlay`. Without
  // this the overlay falls through to Path 2 which stomps the SVG
  // entry's `transform` attribute (set by the floor-plan layer to
  // position the shelf at `node.position`), producing the "ultra slow,
  // wrong place" symptom the user observed. Path 1 writes live
  // transforms during drag for real-time 3D sync and commits via a
  // single tracked `updateNode`.
  floorplanMoveTarget: shelfFloorplanMoveTarget,
  // 2D drag affordances for the resize chevrons + rotate-arrow emitted
  // when the shelf is selected. `shelf-resize` handles width / depth
  // (the payload's `dim` discriminator); `shelf-rotate` is the corner
  // arc-arrow that drives `rotation[1]`. Body move stays on the
  // action-menu Move button → `shelfFloorplanMoveTarget` above.
  floorplanAffordances: {
    'shelf-resize': shelfResizeAffordance,
    'shelf-rotate': shelfRotateAffordance,
  },

  preview: () => import('./preview'),
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: 'Place shelf' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Shelf',
    description: 'A configurable shelving unit. Items host on each row.',
    icon: { kind: 'url', src: '/icons/shelf.webp' },
    paletteSection: 'furnish',
    paletteOrder: 30,
  },

  mcp: {
    description:
      'A parametric shelving unit. Four styles (wall-shelf / bookshelf / open-rack / cubby) with configurable rows, columns, sides, and back. Items host on each row.',
  },
}
