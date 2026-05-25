import {
  DEFAULT_WALL_HEIGHT,
  getWallCurveFrameAt,
  getWallThickness,
  type HandleDescriptor,
  isCurvedWall,
  type NodeDefinition,
  type WallNode as WallNodeType,
} from '@pascal-app/core'
import { buildWallFloorplan } from './floorplan'
import { wallCurveAffordance, wallMoveEndpointAffordance } from './floorplan-affordances'
import { wallFloorplanMoveTarget } from './floorplan-move'
import { wallPaint } from './paint'
import { wallParametrics } from './parametrics'
import { WallNode } from './schema'

const HEIGHT_HANDLE_OFFSET = 0.26
const MIN_WALL_HEIGHT = 0.5
const SIDE_HANDLE_OFFSET = 0.27
const SIDE_HANDLE_MIN_OFFSET = 0.33
const SIDE_HANDLE_TOP_INSET = 0.08
const SIDE_HANDLE_MIN_HEIGHT = 0.4

// Curve-aware midpoint + outward-normal at the wall's t=0.5 point. For
// straight walls that's the chord midpoint + perpendicular; for curved
// walls it's the arc apex + true normal.
function wallApexFrame(n: WallNodeType): {
  midX: number
  midZ: number
  normalX: number
  normalZ: number
  tangentX: number
  tangentZ: number
} {
  if (isCurvedWall(n)) {
    const f = getWallCurveFrameAt(n, 0.5)
    return {
      midX: f.point.x,
      midZ: f.point.y,
      normalX: f.normal.x,
      normalZ: f.normal.y,
      tangentX: f.tangent.x,
      tangentZ: f.tangent.y,
    }
  }
  const dx = n.end[0] - n.start[0]
  const dz = n.end[1] - n.start[1]
  const len = Math.max(Math.hypot(dx, dz), 1e-6)
  return {
    midX: (n.start[0] + n.end[0]) / 2,
    midZ: (n.start[1] + n.end[1]) / 2,
    normalX: -dz / len,
    normalZ: dx / len,
    tangentX: dx / len,
    tangentZ: dz / len,
  }
}

// Height arrow: drag the +Y end, anchor at the floor (Y = 0). Curve-aware
// placement so it sits over the visual centre of the wall (arc apex /
// chord midpoint).
function wallHeightHandle(): HandleDescriptor<WallNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min',
    min: MIN_WALL_HEIGHT,
    currentValue: (n) => n.height ?? DEFAULT_WALL_HEIGHT,
    apply: (_n, newHeight) => ({ height: newHeight }),
    placement: {
      position: (n) => {
        const { midX, midZ } = wallApexFrame(n)
        const h = n.height ?? DEFAULT_WALL_HEIGHT
        return [midX, h + HEIGHT_HANDLE_OFFSET, midZ]
      },
      rotationY: (n) => {
        const { tangentX, tangentZ } = wallApexFrame(n)
        return Math.atan2(-tangentZ, tangentX)
      },
    },
  }
}

// Side-move arrows: front + back faces of the wall. Clicking either hands
// the wall to the move tool. Positioned just past each wall face at the
// upper-third of the wall so they don't collide with door / window
// handles on the same wall.
function wallSideMoveHandle(side: 'front' | 'back'): HandleDescriptor<WallNodeType> {
  const sign = side === 'front' ? 1 : -1
  return {
    kind: 'tap-action',
    onActivate: (node, _scene, editor) => editor.engageMove(node),
    placement: {
      position: (n) => {
        const { midX, midZ, normalX, normalZ } = wallApexFrame(n)
        const offset = Math.max(
          getWallThickness(n) / 2 + SIDE_HANDLE_OFFSET,
          SIDE_HANDLE_MIN_OFFSET,
        )
        const h = n.height ?? DEFAULT_WALL_HEIGHT
        const handleY = Math.max(h - SIDE_HANDLE_TOP_INSET, SIDE_HANDLE_MIN_HEIGHT)
        return [midX + sign * normalX * offset, handleY, midZ + sign * normalZ * offset]
      },
      // Arrow chevron points outward along the (signed) normal direction.
      rotationY: (n) => {
        const { normalX, normalZ } = wallApexFrame(n)
        return Math.atan2(-sign * normalZ, sign * normalX)
      },
    },
    cursor: 'move',
  }
}

// Corner pickers: dashed leader from floor up to wall.height + billboarded
// hex disc at the corner. Clicking the hex engages endpoint move on that
// corner.
function wallCornerPickerHandle(endpoint: 'start' | 'end'): HandleDescriptor<WallNodeType> {
  return {
    kind: 'tap-action',
    shape: 'corner-picker',
    onActivate: (node, _scene, editor) => editor.engageEndpointMove(node, endpoint),
    nodeHeight: (n) => n.height ?? DEFAULT_WALL_HEIGHT,
    placement: {
      position: (n) => {
        const corner = endpoint === 'start' ? n.start : n.end
        return [corner[0], 0, corner[1]]
      },
    },
  }
}

const wallHandles: HandleDescriptor<WallNodeType>[] = [
  wallHeightHandle(),
  wallSideMoveHandle('front'),
  wallSideMoveHandle('back'),
  wallCornerPickerHandle('start'),
  wallCornerPickerHandle('end'),
]

/**
 * Wall — the Phase 3 stress test of the registry-driven node model.
 *
 * Stage A: registered (capabilities, relations, parametrics, presentation).
 * Stage B: deferred — wall geometry depends on level-batch miter data that
 *   doesn't fit the generic `(node, ctx) => Group` shape without `ctx.
 *   levelData?.miters`. See plan's "GeometryContext" extension note.
 *   `renderer` + `system` keep wrap-exporting legacy WallRenderer +
 *   WallSystem + WallCutout.
 * Stage C: `def.floorplan` builder produces the mitered plan footprint
 *   polygon using `ctx.siblings` to assemble miter context.
 *   floorplan-panel.tsx's `wallPolygons` short-circuits to [] when
 *   wall is registered.
 */
export const wallDefinition: NodeDefinition<typeof WallNode> = {
  kind: 'wall',
  schemaVersion: 1,
  schema: WallNode,
  category: 'structure',
  surfaceRole: 'wall',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    start: [0, 0],
    end: [3, 0],
    frontSide: 'unknown',
    backSide: 'unknown',
  }),

  capabilities: {
    // Wall move is bespoke (endpoint drag, linked-wall corner cascade,
    // ALT-detach). Omitting `movable` keeps the legacy MoveWallTool via
    // capability-driven dispatch.
    selectable: { hitVolume: 'bbox' },
    // Front + back faces host items (paintings, shelves, switches).
    surfaces: {
      sides: { faces: 'all' },
    },
    duplicable: true,
    deletable: true,
    // Paint dispatch for the interior / exterior side split. The
    // editor's selection-manager routes paint hover / click /
    // preview through this entry rather than carrying a kind-name
    // arm.
    paint: wallPaint,
  },

  relations: {
    hosts: ['door', 'window', 'item'],
    affectsSpatial: ['slab', 'ceiling', 'zone'],
    linkedBy: 'endpoint-match',
    cascadeDelete: 'descendants',
  },

  parametrics: wallParametrics,
  handles: wallHandles,

  // Stage D — all four wall drag affordances live in this folder.
  // curve / move-endpoint / move are 1:1 ports of the legacy tools
  // (same snap pipelines, linked-wall corner cascade with
  // `planWallMoveJunctions`, ALT-detach, bridge wall previews,
  // auto-slab live preview, history dances). Placement is wired via
  // `def.tool`.
  tool: () => import('./tool'),
  affordanceTools: {
    curve: () => import('./curve-tool'),
    'move-endpoint': () => import('./move-endpoint-tool'),
    move: () => import('./move-tool'),
  },

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  system: {
    module: () => import('./system'),
    // Priority 4 mirrors the legacy WallSystem's useFrame priority.
    priority: 4,
  },
  // Stage C: floor-plan rendering. ctx.siblings provides other walls in
  // the level so `calculateLevelMiters` can compute correct corner joins.
  floorplan: buildWallFloorplan,
  // 2D drag affordances triggered by `endpoint-handle` primitives in
  // `def.floorplan`'s output. Sister to `affordanceTools` (3D) — the
  // same legacy `MoveWallEndpointTool` flow, reachable from both the
  // R3F canvas and the floor-plan SVG.
  floorplanAffordances: {
    'move-endpoint': wallMoveEndpointAffordance,
    curve: wallCurveAffordance,
  },
  floorplanMoveTarget: wallFloorplanMoveTarget,

  toolHints: [
    { key: 'Left click', label: 'Set wall start / end' },
    { key: 'Shift', label: 'Allow non-45° angles' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Wall',
    description: 'A straight or curved wall segment. Hosts doors, windows, and wall-mounted items.',
    icon: { kind: 'url', src: '/icons/wall.png' },
    paletteSection: 'structure',
    paletteOrder: 10,
  },

  mcp: {
    description: 'A wall segment defined by start + end points, with optional curve sagitta.',
  },
}
