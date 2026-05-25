import {
  DEFAULT_WALL_HEIGHT,
  getWallCurveFrameAt,
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

// Wall's height arrow sits at the wall's visual centerline — apex for
// curved walls, chord midpoint for straight. Migrated to the registry;
// side-move arrows + corner pickers stay on `wall-move-side-handles.tsx`
// because they're click-to-engage-mode affordances (move whole wall /
// move endpoint) rather than drag-resize, and tap-action descriptors
// would need editor-state plumbing the descriptor union doesn't have yet.
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
        // Curved walls: apex at t=0.5. Straight: chord midpoint.
        const curve = isCurvedWall(n) ? getWallCurveFrameAt(n, 0.5) : null
        const midX = curve ? curve.point.x : (n.start[0] + n.end[0]) / 2
        const midZ = curve ? curve.point.y : (n.start[1] + n.end[1]) / 2
        const h = n.height ?? DEFAULT_WALL_HEIGHT
        return [midX, h + HEIGHT_HANDLE_OFFSET, midZ]
      },
      // Align the arrow with the wall's tangent at the apex so the chevron
      // points along the wall, matching the legacy WallHeightArrowHandle.
      rotationY: (n) => {
        const curve = isCurvedWall(n) ? getWallCurveFrameAt(n, 0.5) : null
        const dirX = curve ? curve.tangent.x : n.end[0] - n.start[0]
        const dirZ = curve ? curve.tangent.y : n.end[1] - n.start[1]
        return Math.atan2(-dirZ, dirX)
      },
    },
  }
}

const wallHandles: HandleDescriptor<WallNodeType>[] = [wallHeightHandle()]

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
