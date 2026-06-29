import type { NodeDefinition } from '@pascal-app/core'
import { buildWallFloorplan, computeWallFloorplanLevelData } from './floorplan'
import { wallCurveAffordance, wallMoveEndpointAffordance } from './floorplan-affordances'
import { wallFloorplanMoveTarget } from './floorplan-move'
import { wallFloorplanSiblingOverrides } from './floorplan-overrides'
import { wallPaint } from './paint'
import { wallParametrics } from './parametrics'
import { WallNode } from './schema'
import { wallSlots } from './slots'

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
 *   polygon from shared floor-plan level data, with `ctx.siblings` as the
 *   direct-caller fallback.
 *   floorplan-panel.tsx's `wallPolygons` short-circuits to [] when
 *   wall is registered.
 */
export const wallDefinition: NodeDefinition<typeof WallNode> = {
  kind: 'wall',
  snapProfile: 'structural',
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
    // Declared paintable slots (interior / exterior) with their default
    // appearance — the same `{ slotId, label, default }` contract every other
    // paintable kind exposes. Paint still writes the legacy inline fields via
    // `wallPaint`; migrating those into `node.slots` is a later step.
    slots: () => wallSlots(),
  },

  relations: {
    hosts: ['door', 'window', 'item'],
    affectsSpatial: ['slab', 'ceiling', 'zone'],
    linkedBy: 'endpoint-match',
    cascadeDelete: 'descendants',
  },

  parametrics: wallParametrics,
  // Height arrow + side-move arrows + corner pickers all live in the legacy
  // `wall-move-side-handles.tsx` component. The registry handle path didn't
  // render correctly for walls specifically; revisit once that's diagnosed.

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
  // Stage C: floor-plan rendering. Precomputes the level miter graph once
  // per render pass, then the builder reads its own junctions by wall id.
  computeFloorplanLevelData: computeWallFloorplanLevelData,
  floorplan: buildWallFloorplan,
  floorplanDependsOnSiblings: true,
  // 2D drag affordances triggered by `endpoint-handle` primitives in
  // `def.floorplan`'s output. Sister to `affordanceTools` (3D) — the
  // same legacy `MoveWallEndpointTool` flow, reachable from both the
  // R3F canvas and the floor-plan SVG.
  floorplanAffordances: {
    'move-endpoint': wallMoveEndpointAffordance,
    curve: wallCurveAffordance,
  },
  floorplanMoveTarget: wallFloorplanMoveTarget,
  floorplanSiblingOverrides: wallFloorplanSiblingOverrides,

  toolHints: [
    { key: 'Left click', label: 'Set wall start / end' },
    { key: 'Esc', label: 'Cancel' },
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
