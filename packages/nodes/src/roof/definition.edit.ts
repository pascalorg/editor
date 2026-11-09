import type {
  AnyNodeId,
  HandleDescriptor,
  RoofNode as RoofNodeType,
  RoofSegmentNode,
  SceneApi,
} from '@pascal-app/core'
import {
  DRAFTING_SURFACE_EXTENSION_KEY,
  type DraftingSurfaceExtension,
  FLOORPLAN_NODE_EXTENSION_KEY,
  type FloorplanNodeExtension,
  PANEL_MODEL_EXTENSION,
} from '@pascal-app/editor'
import type { NodeEditContribution } from '../definition-contributions'
import { MIN_ROOF_FOOTPRINT } from './definition.render'
import { buildRoofFloorplan } from './floorplan'
import { roofFloorplanAffectedIds, roofFloorplanSiblingOverrides } from './floorplan-overrides'
import { roofPaint } from './paint'
import { roofPanelModel } from './panel-model'
import { roofParametrics } from './parametrics'
import useRoofFootprintSource, {
  irregularRoomHintVisibility,
  noRoomHintVisibility,
} from './roof-footprint-source'
import useRoofPlacementMode, {
  conicalRoofToolHintVisibility,
  standardRoofToolHintVisibility,
} from './roof-placement-mode'
import useRoofRidgeMode from './roof-ridge-mode'
import type { RoofNode } from './schema'

const MOVE_FRONT_OFFSET = 0.35

type RoofFootprintBounds = {
  maxX: number
  maxZ: number
  minX: number
  minZ: number
}

function getRoofFootprintBounds(node: RoofNodeType, sceneApi: SceneApi): RoofFootprintBounds {
  let bounds: RoofFootprintBounds | null = null

  for (const childId of node.children ?? []) {
    const segment = sceneApi.get<RoofSegmentNode>(childId as AnyNodeId)
    if (segment?.type !== 'roof-segment') continue

    const halfWidth = Math.max(segment.width, MIN_ROOF_FOOTPRINT) / 2
    const halfDepth = Math.max(segment.depth, MIN_ROOF_FOOTPRINT) / 2
    const cos = Math.cos(segment.rotation ?? 0)
    const sin = Math.sin(segment.rotation ?? 0)
    const corners = [
      [-halfWidth, -halfDepth],
      [halfWidth, -halfDepth],
      [halfWidth, halfDepth],
      [-halfWidth, halfDepth],
    ] as const

    for (const [x, z] of corners) {
      const localX = segment.position[0] + x * cos + z * sin
      const localZ = segment.position[2] - x * sin + z * cos
      bounds =
        bounds === null
          ? { maxX: localX, maxZ: localZ, minX: localX, minZ: localZ }
          : {
              maxX: Math.max(bounds.maxX, localX),
              maxZ: Math.max(bounds.maxZ, localZ),
              minX: Math.min(bounds.minX, localX),
              minZ: Math.min(bounds.minZ, localZ),
            }
    }
  }

  return bounds ?? { maxX: 0.5, maxZ: 0.5, minX: -0.5, minZ: -0.5 }
}

function roofMoveHandle(): HandleDescriptor<RoofNodeType> {
  return {
    kind: 'translate',
    placement: {
      position: (node, sceneApi) => {
        const bounds = getRoofFootprintBounds(node, sceneApi)
        return [(bounds.minX + bounds.maxX) / 2, 0.02, bounds.maxZ + MOVE_FRONT_OFFSET]
      },
    },
    apply: (node, position) => ({
      position: [position[0], position[1], position[2]],
      ...(node.support?.kind === 'walls' && Math.abs(position[1] - node.position[1]) > 1e-4
        ? { support: { kind: 'level' as const } }
        : {}),
    }),
    snapExtents: (node, sceneApi) => {
      const bounds = getRoofFootprintBounds(node, sceneApi)
      const width = Math.max(bounds.maxX - bounds.minX, MIN_ROOF_FOOTPRINT)
      const depth = Math.max(bounds.maxZ - bounds.minZ, MIN_ROOF_FOOTPRINT)
      const swap = Math.abs(Math.sin(node.rotation ?? 0)) > 0.9
      return [swap ? depth : width, swap ? width : depth]
    },
  }
}

const roofHandles: HandleDescriptor<RoofNodeType>[] = [roofMoveHandle()]

function isManagedLeanToRoof(node: RoofNodeType): boolean {
  const metadata = node.metadata
  if (!(metadata && typeof metadata === 'object' && !Array.isArray(metadata))) return false
  const record = metadata as Record<string, unknown>
  return record.managedByLeanTo !== undefined && record.leanToRole === 'roof'
}

function resolveRoofHandles(node: RoofNodeType): HandleDescriptor<RoofNodeType>[] {
  return isManagedLeanToRoof(node) ? [] : roofHandles
}

export const roofEditContribution: NodeEditContribution<typeof RoofNode> = {
  snapProfile: 'structural',
  // Drafted as a 2-corner footprint (axis-aligned bbox), not a directional
  // edge → no angle-lock mode (grid / lines / off only).
  snapDraftDirectional: false,
  extensions: {
    [PANEL_MODEL_EXTENSION]: roofPanelModel,
    [DRAFTING_SURFACE_EXTENSION_KEY]: {
      kind: 'roof',
    } satisfies DraftingSurfaceExtension,
    [FLOORPLAN_NODE_EXTENSION_KEY]: {
      tool: () => import('./floorplan-tool'),
    } satisfies FloorplanNodeExtension,
  },
  capabilities: {
    paint: roofPaint,
  },
  // Bespoke free-floating move (drag-to-place with R/T rotation and
  // wall/fence snapping). Routes through `MoveTool`'s registry-affordance
  // lookup — no hardcoded dispatcher arm. Shared with roof-segment / stair
  // / stair-segment via `shared/move-roof-tool`.
  affordanceTools: {
    move: () => import('../shared/move-roof-tool'),
  },
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: 'Set roof footprint' },
    {
      key: 'P',
      label: 'Placement',
      visible: conicalRoofToolHintVisibility,
      chip: {
        subscribe: (onChange) => useRoofPlacementMode.subscribe(onChange),
        value: () => useRoofPlacementMode.getState().mode,
        cycle: () => useRoofPlacementMode.getState().cycleMode(),
        labels: {
          auto: 'Placement: Auto',
          ground: 'Placement: Ground',
          roof: 'Placement: Roof',
        },
        icons: {
          auto: 'lucide:scan-search',
          ground: 'lucide:land-plot',
          roof: 'lucide:house',
        },
        tooltip: 'Placement surface - click or press P to cycle',
      },
    },
    {
      key: 'R',
      label: 'Ridge direction',
      visible: standardRoofToolHintVisibility,
      chip: {
        subscribe: (onChange) => useRoofRidgeMode.subscribe(onChange),
        value: () => useRoofRidgeMode.getState().mode,
        cycle: () => useRoofRidgeMode.getState().toggle(),
        labels: {
          long: 'Ridge: Long side',
          short: 'Ridge: Short side',
        },
        icons: {
          long: 'lucide:rectangle-horizontal',
          short: 'lucide:rectangle-vertical',
        },
        tooltip: 'Ridge direction - click or press R to turn it 90°',
      },
    },
    // Room makes nothing where there is no room to roof: say why, where a click would do nothing.
    {
      key: 'Room',
      label: 'Not a rectangle: draw this roof instead',
      visible: irregularRoomHintVisibility,
    },
    { key: 'Room', label: 'Point inside a room, porch or deck', visible: noRoomHintVisibility },
    { key: 'Esc', label: 'Cancel' },
  ],
  toolOptions: [
    {
      id: 'footprintSource',
      label: 'Create from',
      choices: [
        {
          value: 'draw',
          label: 'Draw',
          description: 'Draw the roof footprint with two corner clicks.',
        },
        {
          value: 'room',
          label: 'Room',
          description: 'Hover a room to preview its boundary, then click to place.',
        },
      ],
      subscribe: (onChange) => useRoofFootprintSource.subscribe(onChange),
      value: () => useRoofFootprintSource.getState().source,
      set: (value) =>
        useRoofFootprintSource.getState().setSource(value === 'room' ? 'room' : 'draw'),
      // Conical roofs always build from a curved wall pick; the row would lie.
      visible: standardRoofToolHintVisibility,
    },
  ],
  parametrics: roofParametrics,
  handles: resolveRoofHandles,
  floorplan: buildRoofFloorplan,
  floorplanSiblingOverrides: roofFloorplanSiblingOverrides,
  floorplanAffectedIds: roofFloorplanAffectedIds,
}
