import type { NodeDefinition } from '@pascal-app/core'
import {
  nudgeSegmentPlan,
  routeEndpointLabel,
  ROUTE_ENDPOINT_Y_OFFSET,
} from '../shared/route-edit-actions'
import { wallSurfaceMaterialTargets } from '../shared/material-targets'
import { buildWallFloorplan } from './floorplan'
import { wallCurveAffordance, wallMoveEndpointAffordance } from './floorplan-affordances'
import { wallParametrics } from './parametrics'
import { WallNode } from './schema'

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
    sceneSelection: { role: 'zone-content', zoneFootprint: 'segment' },
    // Front + back faces host items (paintings, shelves, switches).
    surfaces: {
      sides: { faces: 'all' },
    },
    duplicable: true,
    deletable: true,
  },

  relations: {
    hosts: ['door', 'window', 'item'],
    affectsSpatial: ['slab', 'ceiling', 'zone'],
    linkedBy: 'endpoint-match',
    cascadeDelete: 'descendants',
  },

  parametrics: wallParametrics,
  materialTargets: wallSurfaceMaterialTargets,

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

  editActions: {
    nudgePlan: nudgeSegmentPlan,
  },

  actionMenu: {
    placement: 'linear',
    curve: {
      isAvailable: (node, { nodes }) =>
        !(node.children ?? []).some((childId) => {
          const child = nodes[childId]
          if (!child) return false
          if (child.type === 'door' || child.type === 'window') return true
          if (child.type === 'item') {
            const attachTo = child.asset?.attachTo
            return attachTo === 'wall' || attachTo === 'wall-side'
          }
          return false
        }),
    },
    endpointMove: {
      canDetach: true,
      label: (endpoint, ctx) => routeEndpointLabel('Wall', 'wall', endpoint, ctx),
      localPosition: (node, endpoint) => {
        if (endpoint === 'start') return [0, ROUTE_ENDPOINT_Y_OFFSET, 0]
        return [
          Math.hypot(node.end[0] - node.start[0], node.end[1] - node.start[1]),
          ROUTE_ENDPOINT_Y_OFFSET,
          0,
        ]
      },
    },
  },

  toolHints: [
    { key: 'Left click', label: '设置墙体起点 / 终点' },
    { key: 'Shift', label: '按住关闭角度吸附' },
    { key: 'Esc', label: '取消' },
  ],

  presentation: {
    label: 'Wall',
    description: 'A straight or curved wall segment. Hosts doors, windows, and wall-mounted items.',
    icon: { kind: 'url', src: '/icons/wall.webp' },
    paletteSection: 'structure',
    paletteOrder: 10,
  },

  mcp: {
    description: 'A wall segment defined by start + end points, with optional curve sagitta.',
  },
}
