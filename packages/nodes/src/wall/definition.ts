import type { AnyNodeId, NodeDefinition } from '@pascal-app/core'
import { wallSlots } from '@pascal-app/core'
import { type FloorplanNodeExtension, useEditor } from '@pascal-app/editor'
import { buildWallContextualDimensions } from './contextual-dimensions'
import { buildWallFloorplan, computeWallFloorplanLevelData } from './floorplan'
import { wallCurveAffordance, wallMoveEndpointAffordance } from './floorplan-affordances'
import { wallFloorplanMoveTarget } from './floorplan-move'
import { wallFloorplanSiblingOverrides } from './floorplan-overrides'
import {
  matchWallMeasurementFeature,
  resolveWallMeasurementFeature,
  wallMeasurementFeatures,
} from './measurement'
import { wallPaint } from './paint'
import { wallParametrics } from './parametrics'
import { wallQuantities } from './quantities'
import { wallQuickMeasurement } from './quick-measurement'
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
 *   polygon from shared floor-plan level data, with `ctx.siblings` as the
 *   direct-caller fallback.
 *   floorplan-panel.tsx's `wallPolygons` short-circuits to [] when
 *   wall is registered.
 */
export const wallDefinition: NodeDefinition<typeof WallNode> = {
  kind: 'wall',
  snapProfile: 'structural',
  schemaVersion: 7,
  schema: WallNode,
  quantities: wallQuantities,
  category: 'structure',
  surfaceRole: 'wall',
  extensions: {
    'pascal:editor/floorplan': {
      contextualDimensions: buildWallContextualDimensions,
      actionMenu: {
        canCurve: ({ node, nodes }) =>
          !node.children.some((childId) => {
            const child = nodes[childId as AnyNodeId]
            if (!child) return false
            if (child.type === 'door' || child.type === 'window') return true
            if (child.type !== 'item') return false
            return child.asset?.attachTo === 'wall' || child.asset?.attachTo === 'wall-side'
          }),
      },
    } satisfies FloorplanNodeExtension<WallNode>,
  },

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
    // The two build parameters the wall tool already accepts as tool
    // defaults. `start`/`end`/`curveOffset` describe where this wall was
    // drawn, and the support fields bind it to one slab, so none of them
    // travel. Materials stay out on purpose: they come from the paint
    // tool, and a painted wall should not repaint the next one.
    stickyParams: ['thickness', 'height'],
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
    // Declared paintable slots with their default appearance — the same
    // `{ slotId, label, default }` contract every other paintable kind exposes.
    // Paint still writes the legacy inline fields for base faces via
    // `wallPaint`; migrating those fully into `node.slots` is a later step.
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
  preview: () => import('./preview'),
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
  measurement: {
    features: (node) => wallMeasurementFeatures(node),
    quickMeasure: (node) => wallQuickMeasurement(node),
    match: (node, _ctx, point, maxDistance) =>
      matchWallMeasurementFeature(node, point, maxDistance),
    resolve: (node, _ctx, reference) => resolveWallMeasurementFeature(node, reference),
  },
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
    {
      key: 'J',
      label: 'Justify',
      // A live chip rather than a static key row: which side the wall grows on
      // is invisible until you draw, and the whole reason to justify is to put
      // the wall against a line you can see — the HUD has to say which side is
      // armed before the click, not after.
      chip: {
        subscribe: (onChange) => useEditor.subscribe(onChange),
        value: () => useEditor.getState().wallAlignment,
        cycle: () => useEditor.getState().cycleWallAlignment(),
        labels: {
          center: 'Justify: Centre',
          left: 'Justify: Left',
          right: 'Justify: Right',
        },
        icons: {
          center: 'lucide:align-center-horizontal',
          left: 'lucide:align-start-horizontal',
          right: 'lucide:align-end-horizontal',
        },
        tooltip:
          'Which part of the wall the drawn line is — its centre or one of its faces. Click or press J to cycle.',
      },
    },
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
