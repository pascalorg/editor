import {
  getEffectiveCutterNode,
  getScaledDimensions,
  type HandleDescriptor,
  type ItemNode as ItemNodeType,
  resolveCutterHost,
  toggleMechanism,
} from '@pascal-app/core'

import type { FloorplanNodeExtension } from '@pascal-app/editor'
import type { NodeEditContribution } from '../definition-contributions'
import { itemHasLights, itemMechanism, toggleItemLights } from '../shared/item-interactions'
import { restingFloorplanAffectedIds } from '../shared/resting-surface-plan'
import { buildItemContextualDimensions, buildItemFloorplan } from './floorplan'
import { itemFloorplanMoveTarget } from './floorplan-move'
import { itemPaint } from './paint'
import { itemParametrics } from './parametrics'
import { itemPlacementNotice } from './placement-notice'
import type { ItemNode } from './schema'

// The two floor gizmos flank the item at mid-height so they never overlap,
// even on small items: move sits past the left edge, rotate past the right
// edge, both floated the same distance in front of the item. Mirrors the
// wall-item layout below (WALL_SIDE_OFFSET / WALL_GIZMO_LIFT). The guide ring
// traces a circle slightly outside the footprint's bounding circle.
const GIZMO_SIDE_OFFSET = 0.3

const GIZMO_FRONT_OFFSET = 0.3

const ROTATE_RING_OFFSET = 0.06

// Whole-item rotation handle — the two-headed curved arrow. `arc-resize`
// does the angular drag math (raycasts a horizontal plane at the gizmo's
// Y, measures cursor bearing around the item's local origin, returns the
// delta). Rotation snaps to 15° increments by default; holding Shift
// bypasses that snap (handled generically in node-arrow-handles for any
// `shape: 'rotate'`), matching the R/T rotate step for placed items. Item
// rotation is stored as `[x, y, z]`; only the Y component turns.
function itemRotateHandle(): HandleDescriptor<ItemNodeType> {
  return {
    kind: 'arc-resize',
    axis: 'angular',
    shape: 'rotate',
    // Negate the cursor delta to match three.js Y-rotation handedness
    // (positive Ry takes +X → −Z, while atan2(z, x) increases +X → +Z).
    apply: (initial, delta) => {
      const [rx, ry, rz] = initial.rotation ?? [0, 0, 0]
      return { rotation: [rx, ry - delta, rz] }
    },
    placement: {
      // Past the item's right edge at mid-height, floated in front. The
      // registered item mesh carries position + rotation only (scale lives on
      // an inner mesh), so the scaled footprint maps straight to world.
      position: (n) => {
        const [w, h, d] = getScaledDimensions(n)
        return [w / 2 + GIZMO_SIDE_OFFSET, h / 2, d / 2 + GIZMO_FRONT_OFFSET]
      },
      // Fixed −45° tilt leans the curve toward the item's front face.
      rotationY: () => -Math.PI / 4,
    },
    decoration: {
      kind: 'ring',
      radius: (n) => {
        const [w, , d] = getScaledDimensions(n)
        return Math.hypot(w / 2, d / 2) + ROTATE_RING_OFFSET
      },
      y: (n) => getScaledDimensions(n)[1] / 2,
    },
  }
}

// The 4-way move cross, just past the item's left edge. Press-drag hands the
// item to its placement coordinator (showing the bounding box, dimension labels
// and grid-snap ticker) and commits on release — press-drag-release motion with
// the full placement feedback.
function itemMoveHandle(): HandleDescriptor<ItemNodeType> {
  return {
    kind: 'tap-action',
    shape: 'move-cross',
    cursor: 'move',
    onActivate: (node, _scene, editor) => editor.engageMoveDrag(node),
    placement: {
      // Past the item's left edge at mid-height, mirroring the rotate grip on
      // the right so the two never overlap on small items.
      position: (n) => {
        const [w, h, d] = getScaledDimensions(n)
        return [-(w / 2 + GIZMO_SIDE_OFFSET), h / 2, d / 2 + GIZMO_FRONT_OFFSET]
      },
    },
  }
}

// ---- Wall-mounted items (attachTo 'wall' / 'wall-side') ----
// These live in the wall's local frame: position is [along-wall, up, depth]
// and the item faces along the wall normal (its local +Z). Both gizmos use
// `portal: 'grandparent'` so they render in the wall frame like door / window
// handles, and sit a little off the wall surface (+Z) so they're grabbable.

// How far off the wall surface (along the normal) the wall gizmos float, and
// how far to either side of the item they sit.
const WALL_GIZMO_LIFT = 0.12

const WALL_SIDE_OFFSET = 0.3

// Spin the item flat against the wall — rotation about its local +Z (the wall
// normal), written to rotation[2]. Sits just past the item's right edge.
function itemWallRotateHandle(): HandleDescriptor<ItemNodeType> {
  return {
    kind: 'arc-resize',
    axis: 'angular',
    shape: 'rotate',
    rotationPlane: 'node-normal',
    portal: 'grandparent',
    apply: (initial, delta) => {
      const [rx, ry, rz] = initial.rotation ?? [0, 0, 0]
      return { rotation: [rx, ry, rz + delta] }
    },
    placement: {
      position: (n) => {
        const [w] = getScaledDimensions(n)
        return [w / 2 + WALL_SIDE_OFFSET, 0, WALL_GIZMO_LIFT]
      },
    },
  }
}

// Move cross past the item's left edge on the wall face. Tap to hand the item
// to its placement coordinator (`engageMove`) — same feedback as the floating
// move button, and the coordinator handles the wall ↔ floor ↔ ceiling
// transitions the generic translate drag couldn't. `plane: 'node-normal'`
// stands the cross up against the wall face.
function itemWallMoveHandle(): HandleDescriptor<ItemNodeType> {
  return {
    kind: 'tap-action',
    shape: 'move-cross',
    plane: 'node-normal',
    portal: 'grandparent',
    cursor: 'move',
    onActivate: (node, _scene, editor) => editor.engageMoveDrag(node),
    placement: {
      position: (n) => {
        const [w] = getScaledDimensions(n)
        return [-(w / 2 + WALL_SIDE_OFFSET), 0, WALL_GIZMO_LIFT]
      },
    },
  }
}

export const itemEditContribution: NodeEditContribution<typeof ItemNode> = {
  snapProfile: 'item',
  facingIndicator: true,
  extensions: {
    'pascal:editor/floorplan': {
      contextualDimensions: buildItemContextualDimensions,
      actionMenu: { actions: () => import('../shared/item-interaction-actions') },
    } satisfies FloorplanNodeExtension<ItemNodeType>,
  },
  capabilities: {
    paint: itemPaint,
  },
  parametrics: itemParametrics,
  // In-world rotate + move gizmos for selected items.
  //  - Floor items: world-Y rotate + free floor-plane move cross.
  //  - Wall items: wall-normal rotate (spin flat against the wall) + a move
  //    cross constrained to the wall face. Both ride the wall frame.
  //  - Ceiling items: no gizmos yet (move via the move tool).
  handles: (node) => {
    const attachTo = (node as ItemNodeType).asset.attachTo
    if (attachTo === 'wall' || attachTo === 'wall-side') {
      return [itemWallRotateHandle(), itemWallMoveHandle()]
    }
    if (attachTo) return []
    return [itemRotateHandle(), itemMoveHandle()]
  },
  preview: () => import('./renderer').then(({ ItemPreview }) => ({ default: ItemPreview })),
  // Catalog placement tool — mounted when `useEditor.tool === 'item'`.
  // Wraps the same placement coordinator the move-tool uses (surface
  // strategies for floor / wall / ceiling / item-surface). Replaces
  // the legacy `editor/src/components/tools/item/item-tool.tsx`.
  tool: () => import('./tool'),
  // Stage D — 3D move-tool (registry-driven). Adopts the moving node
  // and runs the placement coordinator with surface strategies for
  // floor / wall / ceiling / item-surface, including attachTo
  // *transitions* (drop a wall item on a ceiling and have it switch).
  // Replaces the legacy `MoveItemContent` in editor's dispatcher; the
  // `getRegistryAffordanceTool('item', 'move')` lookup picks this up.
  affordanceTools: {
    move: () => import('./move-tool'),
  },
  // Stage C: floor-plan polygon. ctx.resolve walks the parent chain
  // (wall / nested item / level) to compute the world-space transform.
  floorplan: buildItemFloorplan,
  floorplanAffectedIds: (args) => {
    const ids = [...restingFloorplanAffectedIds(args)]
    for (const node of [args.node, getEffectiveCutterNode(args.node)]) {
      if (node.type !== 'item') continue
      for (const cutter of node.source?.manifest.cutters ?? []) {
        const host = resolveCutterHost(
          node,
          cutter.host === 'mounted' ? 'cutout' : `cut:${cutter.host}`,
          args.nodes,
        )
        if (host) ids.push(host.id)
      }
    }
    return ids
  },
  // 2D move-on-floorplan handler. Branches on `asset.attachTo`:
  // wall items snap to walls (like door / window), ceiling items
  // snap to ceiling polygons, floor items snap to slabs. attachTo
  // *transitions* (drop a wall item on a ceiling) remain canonical
  // in the 3D path; 2D only re-anchors within the same family.
  floorplanMoveTarget: itemFloorplanMoveTarget,
  placementNotice: itemPlacementNotice,
  keyboardActions: {
    e: {
      appliesTo: (node) => itemMechanism.has(node) || itemHasLights(node),
      // Same as the action bar: mechanisms when the item has them, otherwise its light.
      run: (node) =>
        itemMechanism.has(node) ? toggleMechanism(itemMechanism, node) : toggleItemLights(node),
    },
  },
  toolHints: [
    { key: 'Left click', label: 'Place item' },
    { key: 'R / T', label: 'Rotate' },
    { key: 'Shift', label: 'Cycle snapping mode' },
    { key: 'Alt', label: 'Force place' },
    { key: 'Esc', label: 'Cancel' },
  ],
}
