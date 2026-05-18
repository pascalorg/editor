import type { NodeDefinition } from '@pascal-app/core'
import { buildWallFloorplan } from './floorplan'
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

  // Stage D — deferred for wall. The curve port (`curve-tool.tsx` +
  // `actions/curve.ts`) needs more work to match the legacy
  // CurveWallTool's UX (pre-snap on pointer position, 0.5m grid step,
  // Shift override, smooth scene.update without cascade overhead).
  // Legacy fallback runs until that lands. Endpoint move / whole-wall
  // move / placement are all still legacy too — they're the biggest
  // tools and have linked-wall corner cascade logic that needs a
  // careful port.

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

  presentation: {
    label: 'Wall',
    description: 'A straight or curved wall segment. Hosts doors, windows, and wall-mounted items.',
    icon: { kind: 'iconify', name: 'lucide:wall' },
    paletteSection: 'structure',
    paletteOrder: 10,
  },

  mcp: {
    description: 'A wall segment defined by start + end points, with optional curve sagitta.',
  },
}
