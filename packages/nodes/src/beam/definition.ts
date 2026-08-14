import type {
  BeamNode as BeamNodeType,
  EditorApi,
  HandleDescriptor,
  NodeDefinition,
  SceneApi,
} from '@pascal-app/core'
import { buildBeamFloorplan } from './floorplan'
import { beamMoveEndpointAffordance } from './floorplan-affordances'
import { beamFloorplanMoveTarget } from './floorplan-move'
import { buildBeamBody } from './geometry'
import { beamParametrics } from './parametrics'
import { BeamNode } from './schema'

const SIDE_HANDLE_OFFSET = 0.27
const SIDE_HANDLE_MIN_OFFSET = 0.33
const DEPTH_HANDLE_OFFSET = 0.45
const MIN_BEAM_DEPTH = 0.2

function beamMidpointFrame(n: BeamNodeType): {
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

// Side-move arrows: click to hand the beam to its move tool. Positioned
// past the beam's width at the mid-height of the body (the soffit at
// `elevation` up to `elevation + depth`), so the arrows read against the
// element they move.
function beamSideMoveHandle(side: 'front' | 'back'): HandleDescriptor<BeamNodeType> {
  const sign = side === 'front' ? 1 : -1
  return {
    kind: 'tap-action',
    onActivate: (node: BeamNodeType, _scene: SceneApi, editor: EditorApi) =>
      editor.engageMove(node),
    placement: {
      position: (n: BeamNodeType) => {
        const { midX, midZ, normalX, normalZ } = beamMidpointFrame(n)
        const offset = Math.max((n.width ?? 0.3) / 2 + SIDE_HANDLE_OFFSET, SIDE_HANDLE_MIN_OFFSET)
        const handleY = (n.elevation ?? 0) + (n.depth ?? 0.6) / 2
        return [midX + sign * normalX * offset, handleY, midZ + sign * normalZ * offset]
      },
      rotationY: (n: BeamNodeType) => {
        const { normalX, normalZ } = beamMidpointFrame(n)
        return Math.atan2(-sign * normalZ, sign * normalX)
      },
    },
    cursor: 'ew-resize',
  }
}

// Corner picker — dashed vertical leader + billboarded hex disc at the
// endpoint. Tap engages the endpoint-move flow (sister to the wall/fence
// pickers). The leader spans the beam's depth so the dashes reach the
// element being reshaped.
function beamCornerPicker(endpoint: 'start' | 'end'): HandleDescriptor<BeamNodeType> {
  return {
    kind: 'tap-action',
    shape: 'corner-picker',
    cursor: 'move',
    nodeHeight: (n: BeamNodeType) => n.depth ?? 0.6,
    onActivate: (node: BeamNodeType, _scene: SceneApi, editor: EditorApi) =>
      editor.engageEndpointMove(node, endpoint),
    placement: {
      position: (n: BeamNodeType) => {
        const corner = endpoint === 'start' ? n.start : n.end
        return [corner[0], n.elevation ?? 0, corner[1]]
      },
    },
  }
}

// Depth arrow — anchored at the soffit (Y = elevation), grows upward so
// the side shutters get taller. Sits over the beam midpoint at the top
// edge with enough clearance to clear the side-move arrows that hug the
// body; `rotationY` orients the chevron's broad face along the beam's
// perpendicular so it reads frontally from either side.
function beamDepthHandle(): HandleDescriptor<BeamNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min',
    min: MIN_BEAM_DEPTH,
    // Drives the floating dimension pill and suppresses the arrow's own
    // inline chip, matching the fence/wall height handles.
    measureLabel: 'depth',
    currentValue: (n: BeamNodeType) => n.depth ?? 0.6,
    apply: (_n: BeamNodeType, newDepth: number) => ({ depth: newDepth }),
    placement: {
      position: (n: BeamNodeType) => {
        const { midX, midZ, normalX, normalZ } = beamMidpointFrame(n)
        return [midX, (n.elevation ?? 0) + (n.depth ?? 0.6) + DEPTH_HANDLE_OFFSET, midZ]
      },
      rotationY: (n: BeamNodeType) => {
        const { normalX, normalZ } = beamMidpointFrame(n)
        return Math.atan2(-normalZ, normalX)
      },
    },
  }
}

const beamHandles = (): HandleDescriptor<BeamNodeType>[] => [
  beamDepthHandle(),
  beamSideMoveHandle('front'),
  beamSideMoveHandle('back'),
  beamCornerPicker('start'),
  beamCornerPicker('end'),
]

/**
 * A horizontal castable element — two side shutters tied across the width, a
 * soffit under it propped off the floor below, and a stop-end at each end.
 *
 * The beam's own `geometry` draws only its concrete body: the shutter is built
 * by the formwork assemblies the beam hosts, the same attach path walls and
 * slabs use, so drawing it here too would render every shutter twice.
 */
export const beamDefinition: NodeDefinition<typeof BeamNode> = {
  kind: 'beam',
  snapProfile: 'structural',
  schemaVersion: 1,
  category: 'structure',
  schema: BeamNode,

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    start: [0, 0],
    end: [4, 0],
    width: 0.3,
    depth: 0.6,
    elevation: 3,
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    // No generic `movable`: the beam body is built from world `start` /
    // `end`, so the generic translate-on-XZ mover (which writes
    // `position`) would move nothing. The bespoke `affordanceTools.move`
    // translates both endpoints instead, keeping the centreline parallel.
  },

  geometry: buildBeamBody,

  parametrics: beamParametrics,

  handles: beamHandles,

  // Two-click centreline draw, the wall convention a beam runs on.
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: 'Start beam' },
    { key: 'Left click again', label: 'End beam' },
    { key: 'Esc', label: 'Cancel' },
  ],

  // 2D floor-plan rendering: a width band along the centreline.
  floorplan: buildBeamFloorplan,
  // 2D endpoint drag — sister to `actions/move-endpoint.ts`, driven from
  // SVG pointer events instead of R3F grid events.
  floorplanAffordances: {
    'move-endpoint': beamMoveEndpointAffordance,
  },
  // 2D body move — the side arrows the floor-plan builder emits at the
  // midpoint route here (translate both endpoints by the same delta).
  floorplanMoveTarget: beamFloorplanMoveTarget,

  // 3D affordances: bespoke whole-move (start/end translate) + endpoint
  // reshape via the corner pickers.
  affordanceTools: {
    move: () => import('./move-tool'),
    'move-endpoint': () => import('./move-endpoint-tool'),
  },

  presentation: {
    label: 'Beam',
    icon: { kind: 'iconify', name: 'lucide:rows-3' },
  },

  mcp: {
    description:
      'A horizontal castable element: two side shutters tied across the width, a propped soffit under it, and a stop-end at each end. Runs on a centreline like a wall (start/end in the level plane); width is the dimension across the centreline and depth is the vertical dimension the side shutters span. Nothing is formed until formworkType names a system, and the shutter is attached as a formwork-assembly child like any other castable host.',
  },
}
