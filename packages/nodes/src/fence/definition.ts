import {
  type FenceNode as FenceNodeType,
  type HandleDescriptor,
  type NodeDefinition,
} from '@pascal-app/core'
import { buildFenceFloorplan } from './floorplan'
import { fenceMoveEndpointAffordance } from './floorplan-affordances'
import { buildFenceGeometry } from './geometry'
import { fenceParametrics } from './parametrics'
import { FenceNode } from './schema'

const SIDE_HANDLE_OFFSET = 0.27
const SIDE_HANDLE_MIN_OFFSET = 0.33
const SIDE_HANDLE_TOP_INSET = 0.08
const SIDE_HANDLE_MIN_HEIGHT = 0.4
const HEIGHT_HANDLE_OFFSET = 0.45
const MIN_FENCE_HEIGHT = 0.3

function fenceMidpointFrame(n: FenceNodeType): {
  midX: number
  midZ: number
  normalX: number
  normalZ: number
} {
  const dx = n.end[0] - n.start[0]
  const dz = n.end[1] - n.start[1]
  const len = Math.max(Math.hypot(dx, dz), 1e-6)
  return {
    midX: (n.start[0] + n.end[0]) / 2,
    midZ: (n.start[1] + n.end[1]) / 2,
    normalX: -dz / len,
    normalZ: dx / len,
  }
}

// Side-move arrows: click to hand the fence to its move tool. Same shape
// as wall — front + back faces, positioned past the fence thickness near
// the top so they don't compete with endpoint pickers in the floating
// menu (which is where fence endpoint move lives today).
function fenceSideMoveHandle(side: 'front' | 'back'): HandleDescriptor<FenceNodeType> {
  const sign = side === 'front' ? 1 : -1
  return {
    kind: 'tap-action',
    onActivate: (node, _scene, editor) => editor.engageMove(node),
    placement: {
      position: (n) => {
        const { midX, midZ, normalX, normalZ } = fenceMidpointFrame(n)
        const offset = Math.max(
          (n.thickness ?? 0.1) / 2 + SIDE_HANDLE_OFFSET,
          SIDE_HANDLE_MIN_OFFSET,
        )
        const h = n.height ?? 1.8
        const handleY = Math.max(h - SIDE_HANDLE_TOP_INSET, SIDE_HANDLE_MIN_HEIGHT)
        return [midX + sign * normalX * offset, handleY, midZ + sign * normalZ * offset]
      },
      rotationY: (n) => {
        const { normalX, normalZ } = fenceMidpointFrame(n)
        return Math.atan2(-sign * normalZ, sign * normalX)
      },
    },
    cursor: 'move',
  }
}

// Height arrow — anchored at the floor (Y=0), grows upward. Sits over
// the fence midpoint at the top edge with enough clearance to clear the
// side-move arrows that hug the rail. `rotationY` orients the chevron's
// broad face along the fence's perpendicular (same direction the front
// side-move arrow points), so the chevron reads frontally when viewing
// the fence from either side rather than going edge-on.
function fenceHeightHandle(): HandleDescriptor<FenceNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min',
    min: MIN_FENCE_HEIGHT,
    currentValue: (n) => n.height ?? 1.8,
    apply: (_n, newHeight) => ({ height: newHeight }),
    placement: {
      position: (n) => {
        const { midX, midZ } = fenceMidpointFrame(n)
        return [midX, (n.height ?? 1.8) + HEIGHT_HANDLE_OFFSET, midZ]
      },
      rotationY: (n) => {
        const { normalX, normalZ } = fenceMidpointFrame(n)
        return Math.atan2(-normalZ, normalX)
      },
    },
  }
}

// Corner picker — dashed vertical leader + billboarded hex disc at the
// endpoint. Tap engages the endpoint-move flow (sister to the wall
// pickers). nodeHeight controls the leader's vertical reach so the
// dashes span the full fence height.
function fenceCornerPicker(endpoint: 'start' | 'end'): HandleDescriptor<FenceNodeType> {
  return {
    kind: 'tap-action',
    shape: 'corner-picker',
    cursor: 'move',
    nodeHeight: (n) => n.height ?? 1.8,
    onActivate: (node, _scene, editor) => editor.engageEndpointMove(node, endpoint),
    placement: {
      position: (n) => {
        const corner = endpoint === 'start' ? n.start : n.end
        return [corner[0], 0, corner[1]]
      },
    },
  }
}

const fenceHandles: HandleDescriptor<FenceNodeType>[] = [
  fenceSideMoveHandle('front'),
  fenceSideMoveHandle('back'),
  fenceHeightHandle(),
  fenceCornerPicker('start'),
  fenceCornerPicker('end'),
]

/**
 * Fence — Phase 5 batch kind. Stage B complete: `def.geometry` drives
 * the rebuild via the generic `<GeometrySystem>`; `<ParametricNodeRenderer>`
 * mounts the empty group. No per-kind renderer or system file.
 *
 * Capabilities:
 *  - **No `movable`**: fence move is bespoke endpoint-drag. Capability-
 *    driven dispatch keeps the legacy MoveFenceTool until the
 *    affordance port (Stage D).
 *  - `surfaces.sides`, `selectable`, `duplicable`, `deletable` standard.
 *
 * Relations: `linkedBy: 'endpoint-match'` for corner cascade.
 */
export const fenceDefinition: NodeDefinition<typeof FenceNode> = {
  kind: 'fence',
  schemaVersion: 1,
  schema: FenceNode,
  category: 'structure',
  surfaceRole: 'wall',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    start: [0, 0],
    end: [3, 0],
    height: 1.8,
    thickness: 0.08,
    baseHeight: 0.22,
    postSpacing: 2,
    postSize: 0.1,
    topRailHeight: 0.04,
    groundClearance: 0,
    edgeInset: 0.015,
    baseStyle: 'grounded',
    showInfill: true,
    color: '#ffffff',
    style: 'slat',
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    surfaces: { sides: { faces: 'all' } },
    duplicable: true,
    deletable: true,
  },

  relations: {
    linkedBy: 'endpoint-match',
    cascadeDelete: 'none',
  },

  parametrics: fenceParametrics,
  handles: fenceHandles,

  // Stage D: kind-owned placement tool. Two-click flow (start → end)
  // with live preview, length / angle HUD, snap to walls / fences /
  // grid. Mounted by ToolManager when `useEditor.tool === 'fence'`
  // via the registry's getRegistryTool() — falls back to the legacy
  // tools[phase][tool] map when missing.
  tool: () => import('./tool'),

  // Stage B: pure geometry function. Generic <GeometrySystem> rebuilds
  // on dirtyNodes; <ParametricNodeRenderer> mounts the empty group.
  // `renderer` + `system` fields dropped along with their files.
  geometry: buildFenceGeometry,
  // Stage C: floor-plan rendering. FloorplanRegistryLayer iterates kinds
  // with `floorplan` set and renders via FloorplanGeometryRenderer.
  // Legacy `floorplanFenceEntries` short-circuits to [] when fence is
  // registered (see floorplan-panel.tsx).
  floorplan: buildFenceFloorplan,
  // 2D drag affordance — sister to `actions/move-endpoint.ts`. The 3D
  // DragAction drives R3F grid events through `createDragSession`; this
  // one drives SVG pointer events through the floor-plan registry
  // dispatcher's snapshot + single-undo dance. Same legacy semantics.
  floorplanAffordances: {
    'move-endpoint': fenceMoveEndpointAffordance,
  },
  // Stage D — all four fence drag-affordances live in this folder.
  // curve / move-endpoint / move are 1:1 ports of the legacy tools
  // (same snap pipeline, same history dance, same cursor render),
  // relocated under `@pascal-app/nodes` and dispatched via
  // `def.affordanceTools`. Placement lives in `def.tool` (see below).
  affordanceTools: {
    curve: () => import('./curve-tool'),
    'move-endpoint': () => import('./move-endpoint-tool'),
    move: () => import('./move-tool'),
  },

  toolHints: [
    { key: 'Left click', label: 'Set fence start / end' },
    { key: 'Shift', label: 'Allow non-45° angles' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Fence',
    description: 'A straight or curved fence segment with configurable posts and infill.',
    icon: { kind: 'url', src: '/icons/fence.png' },
    paletteSection: 'structure',
    paletteOrder: 20,
  },

  mcp: {
    description: 'A fence segment defined by start + end points, with optional curve sagitta.',
  },
}
