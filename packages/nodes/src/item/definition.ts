import {
  getScaledDimensions,
  type HandleDescriptor,
  type ItemNode as ItemNodeType,
  type NodeDefinition,
} from '@pascal-app/core'
import { buildItemFloorplan } from './floorplan'
import { itemFloorplanMoveTarget } from './floorplan-move'
import { itemParametrics } from './parametrics'
import { ItemNode } from './schema'

// Gizmo sits just past the front-right footprint corner; the guide ring
// traces a circle slightly outside the footprint's bounding circle.
const ROTATE_CORNER_OFFSET = 0.25
const ROTATE_RING_OFFSET = 0.06
// How far past the item's front edge the move cross floats.
const MOVE_FRONT_OFFSET = 0.35

// Whole-item rotation handle — the two-headed curved arrow. `arc-resize`
// does the angular drag math (raycasts a horizontal plane at the gizmo's
// Y, measures cursor bearing around the item's local origin, returns the
// delta). Holding Shift snaps to 15° increments (handled generically in
// node-arrow-handles for any `shape: 'rotate'`), matching the R/T rotate
// step for placed items. Item rotation is stored as `[x, y, z]`; only the
// Y component turns.
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
      // Front-right corner of the footprint at mid-height. The registered
      // item mesh carries position + rotation only (scale lives on an
      // inner mesh), so the scaled footprint maps straight to world.
      position: (n) => {
        const [w, h, d] = getScaledDimensions(n)
        return [w / 2, h / 2, d / 2 + ROTATE_CORNER_OFFSET]
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

// Free ground-plane move gizmo — the 4-way cross just outside the front edge.
// Press-drag-release slides the item across the floor (live preview, commit
// on release). `snapExtents` aligns the item's edges to the grid the same
// way placement does, swapping width / depth at 90° turns.
function itemMoveHandle(): HandleDescriptor<ItemNodeType> {
  return {
    kind: 'translate',
    placement: {
      // Sit just outside the item's front edge (centred in X, clear of the
      // model), low to the floor so it reads as a floor-move grip.
      position: (n) => {
        const [, , d] = getScaledDimensions(n)
        return [0, 0.02, d / 2 + MOVE_FRONT_OFFSET]
      },
    },
    apply: (_n, pos) => ({ position: [pos[0], pos[1], pos[2]] }),
    snapExtents: (n) => {
      const [dimX, , dimZ] = getScaledDimensions(n)
      const swap = Math.abs(Math.sin(n.rotation[1] ?? 0)) > 0.9
      return [swap ? dimZ : dimX, swap ? dimX : dimZ]
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

// Slide the item across the wall face — constrained to the wall plane (along
// the wall + up/down), depth pinned. Sits just past the item's left edge.
function itemWallMoveHandle(): HandleDescriptor<ItemNodeType> {
  return {
    kind: 'translate',
    plane: 'node-normal',
    portal: 'grandparent',
    placement: {
      position: (n) => {
        const [w] = getScaledDimensions(n)
        return [-(w / 2 + WALL_SIDE_OFFSET), 0, WALL_GIZMO_LIFT]
      },
    },
    apply: (_n, pos) => ({ position: [pos[0], pos[1], pos[2]] }),
    snapExtents: (n) => {
      const [dimX, dimY] = getScaledDimensions(n)
      // A 90° roll about the normal swaps the item's along-wall + vertical
      // footprint.
      const swap = Math.abs(Math.sin(n.rotation[2] ?? 0)) > 0.9
      return [swap ? dimY : dimX, swap ? dimX : dimY]
    },
  }
}

/**
 * Item — Phase 5 batch kind. Catalog-backed, GLB-rendered, multi-host.
 *
 * Demonstrates the **custom `def.renderer` escape hatch** (see
 * plans/editor-node-registry.md): items use `useGLTF` from drei to
 * load CDN assets, plus a non-trivial interactive-widget layer inside
 * the rendered scene. Not expressible as a pure `def.geometry`. The
 * registry mounts the custom React renderer as-is.
 *
 * Capabilities:
 *  - **No `movable`**: item's move is bespoke `MoveItemContent` —
 *    handles attachTo transitions mid-drag (floor ↔ wall ↔ ceiling),
 *    asset.attachTo lookups, scale-preserving Y math for surface
 *    placement. The smooth generic mover can't express that. Legacy
 *    mover keeps running via capability-driven dispatch.
 *  - `selectable`, `duplicable`, `deletable` standard.
 *
 * Stages:
 *  - A: registered.
 *  - B: N/A — def.renderer escape hatch (GLB / useGLTF).
 *  - C: `def.floorplan` resolves parent chain via `ctx.resolve`,
 *    returns a rotated rectangle (width × depth). Mirrors the legacy
 *    `getItemFloorplanTransform` math. Legacy `floorplanItemEntries`
 *    short-circuits when item is registered.
 *
 * `toolHints`: matches the legacy ItemHelper UI (mouse / R / T / Shift /
 * Esc) — registry-driven placement panel.
 */
export const itemDefinition: NodeDefinition<typeof ItemNode> = {
  kind: 'item',
  schemaVersion: 1,
  schema: ItemNode,
  category: 'furnish',
  surfaceRole: 'furnishing',

  // Defaults shape is cast: the schema requires a fully-typed `asset`
  // field, but in practice items are always created from the catalog
  // (the asset is supplied at placement time). `createNode` re-parses
  // through the schema, so any missing zod defaults fill at runtime.
  defaults: () =>
    ({
      object: 'node',
      parentId: null,
      visible: true,
      metadata: {},
      children: [],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      asset: {
        id: 'placeholder',
        category: 'misc',
        name: 'Item',
        thumbnail: '',
        src: 'asset:placeholder',
        dimensions: [1, 1, 1],
        source: 'library',
      },
    }) as unknown as Omit<ItemNodeType, 'id' | 'type'>,

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    // Floor items get lifted by slabs underneath via the generic
    // `<FloorElevationSystem>`. Wall- / ceiling-attached items live in
    // their parent's local frame and skip the lift via `applies`.
    floorPlaced: {
      footprint: (node) => {
        const item = node as ItemNodeType
        return { dimensions: getScaledDimensions(item), rotation: item.rotation }
      },
      applies: (node) => !(node as ItemNodeType).asset.attachTo,
    },
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

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  system: {
    module: () => import('./system'),
    // Same priority as the legacy ItemSystem.
    priority: 2,
  },
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
  // 2D move-on-floorplan handler. Branches on `asset.attachTo`:
  // wall items snap to walls (like door / window), ceiling items
  // snap to ceiling polygons, floor items snap to slabs. attachTo
  // *transitions* (drop a wall item on a ceiling) remain canonical
  // in the 3D path; 2D only re-anchors within the same family.
  floorplanMoveTarget: itemFloorplanMoveTarget,

  toolHints: [
    { key: 'Left click', label: 'Place item' },
    { key: 'R', label: 'Rotate counterclockwise' },
    { key: 'T', label: 'Rotate clockwise' },
    { key: 'Shift', label: 'Free place' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Item',
    description: 'A catalog-backed item (furniture, fixtures, decorations).',
    icon: { kind: 'url', src: '/icons/item.png' },
    paletteSection: 'furnish',
    paletteOrder: 10,
  },

  mcp: {
    description:
      'A catalog-backed item with asset reference, transforms, and optional attachTo for wall/ceiling mounting.',
  },
}
