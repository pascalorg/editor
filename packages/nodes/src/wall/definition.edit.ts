import type { AnyNodeId, WallNode as WallNodeType } from '@pascal-app/core'

import {
  DRAFTING_SURFACE_EXTENSION_KEY,
  type DraftingSurfaceExtension,
  type FloorplanNodeExtension,
  getWallDrawVariant,
  type NodePanelModel,
  PANEL_MODEL_EXTENSION,
  selectedWallDimensions,
  useEditor,
  type WallDrawVariant,
} from '@pascal-app/editor'
import type { NodeEditContribution } from '../definition-contributions'
import { buildWallContextualDimensions } from './contextual-dimensions'
import { hasWallCurveBlockingChildren } from './curve-eligibility'
import {
  wallCurveAffordance,
  wallMoveEndpointAffordance,
  wallThicknessAffordance,
} from './floorplan-affordances'
import { wallFloorplanMoveTarget } from './floorplan-move'
import { wallFloorplanSiblingOverrides } from './floorplan-overrides'
import { wallPaint } from './paint'
import {
  type WallReferenceValue,
  wallAssemblyMultiControls,
  wallReferenceModel,
  wallSettings,
} from './panel-model'
import { wallParametrics } from './parametrics'
import type { WallNode } from './schema'
import { WALL_SPLIT_MAX_CUTS } from './split-preview'
import { setWallSplitCuts } from './split-session'
import { useWallSplit } from './split-store'

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
const SPLIT_CUT_COUNTS = Array.from({ length: WALL_SPLIT_MAX_CUTS }, (_, index) =>
  String(index + 1),
)

/** Show a tool hint only while the wall tool draws this Rooms variant. */
const whenWallVariant = (variant: WallDrawVariant) => ({
  subscribe: (onChange: () => void) => useEditor.subscribe(onChange),
  value: () => getWallDrawVariant() === variant,
})

export const wallEditContribution: NodeEditContribution<typeof WallNode> = {
  snapProfile: 'structural',
  extensions: {
    [PANEL_MODEL_EXTENSION]: {
      rows: ({ node, nodes, update }) => wallSettings(node, nodes, update),
      multiControls: ({ selection, nodes }) => {
        const reference = wallReferenceModel(selection, nodes)
        return [
          {
            id: 'wall-reference',
            kind: 'segmented',
            section: 'Dimensions',
            label: 'Reference',
            options: reference.options,
            value: reference.value,
            onChange: (value) => reference.apply(value as WallReferenceValue),
          },
          ...wallAssemblyMultiControls(selection),
        ]
      },
    } satisfies NodePanelModel<WallNodeType>,
    [DRAFTING_SURFACE_EXTENSION_KEY]: {
      kind: 'wall',
      classifyFace: (node, localNormal) => {
        if (node?.type !== 'wall') return null
        const dx = node.end[0] - node.start[0]
        const dz = node.end[1] - node.start[1]
        const length = Math.hypot(dx, dz)
        if (length <= 1e-9) return { face: 'unknown' }
        const sideDot = localNormal[0] * (-dz / length) + localNormal[2] * (dx / length)
        if (Math.abs(localNormal[1]) > 0.7) return { face: 'top' }
        if (Math.abs(localNormal[1]) < 0.25 && Math.abs(sideDot) > 0.7) {
          return { face: 'side', side: sideDot >= 0 ? 'front' : 'back' }
        }
        return { face: 'end' }
      },
    } satisfies DraftingSurfaceExtension,
    'pascal:editor/floorplan': {
      tool: () => import('./floorplan-tool'),
      reshapeLayers: { split: () => import('./split-floorplan-layer') },
      contextualDimensions: buildWallContextualDimensions,
      planHitSelectsNode: true,
      selectionDimensions: ({ node, nodes, faces }) => selectedWallDimensions(nodes, node, faces),
      actionMenu: {
        actions: () => import('./actions'),
        canCurve: ({ node, nodes }) =>
          !hasWallCurveBlockingChildren(
            node.children.flatMap((childId) => {
              const child = nodes[childId as AnyNodeId]
              return child ? [child] : []
            }),
          ),
      },
    } satisfies FloorplanNodeExtension<WallNode>,
  },
  capabilities: {
    // Paint dispatch for the interior / exterior side split. The
    // editor's selection-manager routes paint hover / click /
    // preview through this entry rather than carrying a kind-name
    // arm.
    paint: wallPaint,
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
    split: () => import('./split-tool'),
  },
  floorplanDependsOnSiblings: true,
  // 2D drag affordances triggered by `endpoint-handle` primitives in
  // `def.floorplan`'s output. Sister to `affordanceTools` (3D) — the
  // same legacy `MoveWallEndpointTool` flow, reachable from both the
  // R3F canvas and the floor-plan SVG.
  floorplanAffordances: {
    'move-endpoint': wallMoveEndpointAffordance,
    curve: wallCurveAffordance,
    thickness: wallThicknessAffordance,
  },
  floorplanMoveTarget: wallFloorplanMoveTarget,
  floorplanSiblingOverrides: wallFloorplanSiblingOverrides,
  // The gesture row follows the Rooms variant picked in the Build panel (the
  // HUD header names it); the variant itself is never cycled from here.
  toolHints: [
    {
      key: 'Left click',
      label: 'Set one corner, then the opposite',
      visible: whenWallVariant('rectangle'),
    },
    {
      key: 'Left click',
      label: 'Add a corner · click the first to close',
      visible: whenWallVariant('polygon'),
    },
    { key: 'Left click', label: 'Set wall start / end', visible: whenWallVariant('walls') },
    // A started Polygon room holds square; Alt lets it go.
    { key: 'Alt', label: 'Free angle', visible: whenWallVariant('polygon') },
    { key: 'Esc', label: 'Cancel' },
  ],
  // The split session (`split-session.ts`) is the wall's own reshape; the HUD
  // shows these while it runs. The snapping chip comes from the scope.
  affordanceHints: {
    split: [
      { key: 'Left click', label: 'Split at the marks' },
      {
        key: 'Scroll',
        label: 'Cuts',
        chip: {
          subscribe: (onChange) => useWallSplit.subscribe(onChange),
          value: () => String(useWallSplit.getState().draft?.cuts ?? 1),
          cycle: () => {
            const cuts = useWallSplit.getState().draft?.cuts ?? 1
            setWallSplitCuts(cuts >= WALL_SPLIT_MAX_CUTS ? 1 : cuts + 1)
          },
          labels: Object.fromEntries(
            SPLIT_CUT_COUNTS.map((count) => [
              count,
              count === '1' ? 'Cuts: 1' : `Cuts: ${count}, even`,
            ]),
          ),
          icons: Object.fromEntries(SPLIT_CUT_COUNTS.map((count) => [count, 'lucide:scissors'])),
          tooltip: 'Number of cuts — scroll or click to change',
        },
      },
      {
        key: 'Alt',
        label: 'Free placement',
        // Several cuts are evenly spaced, so there is nothing to place freely.
        visible: {
          subscribe: (onChange) => useWallSplit.subscribe(onChange),
          value: () => (useWallSplit.getState().draft?.cuts ?? 1) === 1,
        },
      },
      { key: 'Esc', label: 'Cancel' },
    ],
  },
}
