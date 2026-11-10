import {
  type BeamNode as BeamNodeType,
  beamPlan,
  beamTopElevation,
  type HandleDescriptor,
  type SceneApi,
} from '@pascal-app/core'

import {
  clearStructuralElevationGuide,
  FLOORPLAN_NODE_EXTENSION_KEY,
  type FloorplanNodeExtension,
  PANEL_MODEL_EXTENSION,
  publishStructuralElevationGuide,
  resolveStructuralElevationSnap,
} from '@pascal-app/editor'

import { useViewer } from '@pascal-app/viewer'
import type { NodeEditContribution } from '../definition-contributions'
import { beamToolOptions } from './draft-settings'
import { buildBeamFloorplan } from './floorplan'
import { beamEndpointAffordance } from './floorplan-affordances'
import { beamFloorplanMoveTarget } from './floorplan-move'
import { beamPanelModel } from './panel-model'
import { beamParametrics } from './parametrics'
import type { BeamNode } from './schema'

const SIDE_HANDLE_OFFSET = 0.22

const INCH = 0.0254

/** Where a beam's top is in the live scene (a descriptor may run before the scene has a level). */
function topOf(beam: BeamNodeType, sceneApi?: SceneApi): number {
  return beamTopElevation(sceneApi?.nodes() ?? {}, beam)
}

function midFrame(beam: BeamNodeType) {
  const plan = beamPlan(beam)
  return {
    mid: [(plan.start[0] + plan.end[0]) / 2, (plan.start[1] + plan.end[1]) / 2] as const,
    normal: plan.normal,
  }
}

/** The beam's top, as the elevation guides read a structural datum. */
function guideSource(beam: BeamNodeType) {
  const { mid } = midFrame(beam)
  return { nodeId: beam.id, levelId: beam.parentId, anchor: mid }
}

// Side arrows: a tap hands the beam to its move tool, either side of its middle at mid-depth.
function beamSideMoveHandle(side: 1 | -1): HandleDescriptor<BeamNodeType> {
  return {
    kind: 'tap-action',
    onActivate: (node, _scene, editor) => editor.engageMove(node),
    placement: {
      position: (n, sceneApi) => {
        const { mid, normal } = midFrame(n)
        const offset = (n.width / 2 + SIDE_HANDLE_OFFSET) * side
        return [
          mid[0] + normal[0] * offset,
          topOf(n, sceneApi) - n.depth / 2,
          mid[1] + normal[1] * offset,
        ]
      },
      rotationY: (n) => {
        const { normal } = midFrame(n)
        return Math.atan2(-normal[1] * side, normal[0] * side)
      },
    },
    cursor: 'ew-resize',
  }
}

// End pickers: a dashed leader down the beam's depth and a disc at its end; a tap drags the end.
function beamEndPicker(endpoint: 'start' | 'end'): HandleDescriptor<BeamNodeType> {
  return {
    kind: 'tap-action',
    shape: 'corner-picker',
    cursor: 'move',
    nodeHeight: (n) => n.depth,
    onActivate: (node, _scene, editor) => editor.engageEndpointMove(node, endpoint),
    placement: {
      position: (n, sceneApi) => {
        const point = n[endpoint]
        return [point[0], topOf(n, sceneApi) - n.depth, point[1]]
      },
    },
  }
}

/**
 * The beam's top, dragged up and down: it stores the top it lands on, caught by the levels'
 * structural heights (a ceiling plane, a slab top) and otherwise to the half inch (the centimetre
 * on a metric plan).
 */
function beamTopHandle(current: number): HandleDescriptor<BeamNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min',
    shape: 'tracker',
    currentValue: () => current,
    magneticSnap: (n, value, sceneApi) => {
      const snapped = resolveStructuralElevationSnap(guideSource(n), value, sceneApi.nodes())
      if (snapped !== value) return snapped
      const step = useViewer.getState().unit === 'imperial' ? INCH / 2 : 0.01
      return Math.round(value / step) * step
    },
    onDrag: (n, sceneApi) =>
      publishStructuralElevationGuide(guideSource(n), topOf(n, sceneApi), sceneApi.nodes()),
    onDragEnd: (n) => clearStructuralElevationGuide(n.id),
    apply: (_n, top) => ({ topElevation: top }),
    placement: {
      position: (n, sceneApi) => {
        const { mid } = midFrame(n)
        return [mid[0], topOf(n, sceneApi), mid[1]]
      },
    },
  }
}

const beamHandles = (node: BeamNodeType, sceneApi?: SceneApi): HandleDescriptor<BeamNodeType>[] => [
  beamSideMoveHandle(1),
  beamSideMoveHandle(-1),
  beamEndPicker('start'),
  beamEndPicker('end'),
  beamTopHandle(topOf(node, sceneApi)),
]

export const beamEditContribution: NodeEditContribution<typeof BeamNode> = {
  snapProfile: 'structural',
  extensions: {
    [FLOORPLAN_NODE_EXTENSION_KEY]: {
      // In 2D-only view the 3D tool never mounts: the plan drafts beams itself.
      tool: () => import('./tool').then((module) => ({ default: module.BeamFloorplanTool })),
      // A beam crosses rooms: a plan click on it picks the beam, not the room.
      planHitSelectsNode: true,
    } satisfies FloorplanNodeExtension,
    [PANEL_MODEL_EXTENSION]: beamPanelModel,
  },
  parametrics: beamParametrics,
  handles: beamHandles,
  tool: () => import('./tool'),
  toolOptions: beamToolOptions,
  toolHints: [
    { key: 'Left click', label: 'Set beam start / end; the next beam starts there' },
    { key: 'Alt', label: 'Free place' },
    { key: 'Esc', label: 'End the run' },
  ],
  floorplan: buildBeamFloorplan,
  floorplanMoveTarget: beamFloorplanMoveTarget,
  floorplanAffordances: {
    'move-endpoint': beamEndpointAffordance,
  },
  affordanceTools: {
    move: () => import('./move-tool'),
    'move-endpoint': () => import('./move-endpoint-tool'),
  },
}
