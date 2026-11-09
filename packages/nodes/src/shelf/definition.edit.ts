import type { HandleDescriptor, ShelfNode as ShelfNodeType } from '@pascal-app/core'
import type { NodeEditContribution } from '../definition-contributions'
import { restingFloorplanAffectedIds } from '../shared/resting-surface-plan'
import { sanitizeShelfDimensions } from './dimensions'
import { buildShelfFloorplan } from './floorplan'
import { shelfResizeAffordance, shelfRotateAffordance } from './floorplan-affordances'
import { shelfFloorplanMoveTarget } from './floorplan-move'
import { shelfPaint } from './paint'
import { shelfParametrics } from './parametrics'
import type { ShelfNode } from './schema'

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

export const shelfEditContribution: NodeEditContribution<typeof ShelfNode> = {
  snapProfile: 'item',
  facingIndicator: true,
  capabilities: {
    paint: shelfPaint,
  },
  parametrics: shelfParametrics,
  handles: shelfHandles,
  floorplan: buildShelfFloorplan,
  floorplanAffectedIds: restingFloorplanAffectedIds,
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
}
