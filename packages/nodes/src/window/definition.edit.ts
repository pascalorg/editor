import type {
  AnyNodeId,
  DormerNode,
  HandleDescriptor,
  SceneApi,
  WallNode,
  WindowNode as WindowNodeType,
} from '@pascal-app/core'
import {
  getDormerWallHorizontalBoundsAtHeight,
  getDormerWallOpeningVerticalBounds,
} from '@pascal-app/core'
import type { FloorplanNodeExtension } from '@pascal-app/editor'
import type { NodeEditContribution } from '../definition-contributions'
import { curtainOpeningResizeMax } from '../shared/curtain-opening-limits'
import { buildWindowFloorplanSchedule } from '../shared/opening-documentation'
import { publishOpeningResizeGuides } from '../shared/opening-guides-runtime'
import { createOpeningPropertyPreview } from '../shared/opening-property-preview'
import { openingPropertyPreviewHost } from '../shared/opening-property-preview-host'
import { readRoofFaceHeightMax, readRoofFaceWidthMax } from '../shared/roof-opening-host'
import { scriptedOpeningHandles } from '../shared/scripted-opening-handles'
import { readHostWallCeiling, readHostWallCeilingMaxWidth } from '../shared/wall-opening-ceiling'
import { wallFloorplanSiblingOverrides } from '../wall/floorplan-overrides'
import { buildWindowContextualDimensions } from './contextual-dimensions'
import { resolveWindowHandlePortalTarget } from './definition.render'
import { windowWidthAffordance } from './floorplan-affordances'
import { windowFloorplanMoveTarget } from './floorplan-move'
import { windowPaint } from './paint'
import { windowParametrics } from './parametrics'
import {
  WINDOW_CORNER_HINTS,
  WINDOW_PLACEMENT_HINTS,
  WINDOW_PLAIN_PLACE_VISIBLE,
} from './placement'
import type { WindowNode } from './schema'

const SIDE_HANDLE_OFFSET = 0.24

const HEIGHT_HANDLE_OFFSET = 0.24

const MIN_WINDOW_HEIGHT = 0.3

const MIN_WINDOW_WIDTH = 0.3

function readWallLength(w: WindowNodeType, scene: { get: (id: AnyNodeId) => unknown }): number {
  const hostId = w.wallId || w.parentId
  if (!hostId) return Number.POSITIVE_INFINITY
  const wall = scene.get(hostId as AnyNodeId) as WallNode | undefined
  if (wall?.type !== 'wall' || !wall.start || !wall.end) return Number.POSITIVE_INFINITY
  return Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
}

function resolveDormerHost(
  window: WindowNodeType,
  scene: Pick<SceneApi, 'get'>,
): DormerNode | null {
  const dormerId = window.dormerId ?? window.parentId
  if (!dormerId) return null
  const dormer = scene.get(dormerId as AnyNodeId) as DormerNode | undefined
  return dormer?.type === 'dormer' ? dormer : null
}

function readDormerFaceWidthMax(
  window: WindowNodeType,
  scene: Pick<SceneApi, 'get'>,
  localGrowSign: number,
): number | null {
  const dormer = resolveDormerHost(window, scene)
  if (!dormer) return null
  const bounds = getDormerWallHorizontalBoundsAtHeight(
    dormer,
    window.dormerFace ?? 'front',
    window.position[1] + window.height / 2,
  )
  const faceGrowSign = Math.cos(window.rotation[1]) >= 0 ? localGrowSign : -localGrowSign
  const anchorX = window.position[0] - (faceGrowSign * window.width) / 2
  return faceGrowSign > 0 ? bounds.max - anchorX : anchorX - bounds.min
}

function readDormerFaceHeightMax(
  window: WindowNodeType,
  scene: Pick<SceneApi, 'get'>,
  growSign: number,
): number | null {
  const dormer = resolveDormerHost(window, scene)
  if (!dormer) return null
  const bounds = getDormerWallOpeningVerticalBounds(
    dormer,
    window.dormerFace ?? 'front',
    window.position[0],
    window.width,
  )
  const anchorY = window.position[1] - (growSign * window.height) / 2
  return growSign > 0 ? bounds.max - anchorY : anchorY - bounds.min
}

function windowWidthHandle(side: 'left' | 'right'): HandleDescriptor<WindowNodeType> {
  const sign = side === 'right' ? 1 : -1
  return {
    kind: 'linear-resize',
    axis: 'x',
    // Stand the blade up into the wall face so it reads face-on from the
    // front instead of edge-on (the window sits on a vertical wall).
    faceNormal: true,
    anchor: side === 'right' ? 'min' : 'max',
    gridSnap: true,
    min: MIN_WINDOW_WIDTH,
    max: (n, scene) => {
      const dormerMax = readDormerFaceWidthMax(n, scene, sign)
      if (dormerMax !== null) return Math.max(MIN_WINDOW_WIDTH, dormerMax)
      // Roof-hosted windows clamp against the face profile.
      const roofMax = readRoofFaceWidthMax(n, scene, sign)
      if (roofMax !== null) return Math.max(MIN_WINDOW_WIDTH, roofMax)
      const curtainMax = curtainOpeningResizeMax(n, scene.nodes(), 'x', sign)
      if (curtainMax !== undefined) return curtainMax
      // rotation[1] = π flips the window, so its visual right edge moves toward lower wall-local S.
      const growSign = sign * Math.cos(n.rotation[1]) > 0 ? 1 : -1
      const fixedEdgeS = n.position[0] - (growSign * n.width) / 2
      return Math.max(
        MIN_WINDOW_WIDTH,
        readHostWallCeilingMaxWidth(
          n.wallId || n.parentId,
          scene,
          fixedEdgeS,
          growSign,
          n.position[1] + n.height / 2,
          readWallLength(n, scene),
          n,
        ),
      )
    },
    currentValue: (n) => n.width,
    onDrag: (node) => publishOpeningResizeGuides(node, true),
    apply: (initial, newWidth) => {
      const rotY = initial.rotation[1]
      const armX = Math.cos(rotY)
      const armZ = -Math.sin(rotY)
      const anchorX = initial.position[0] - sign * (initial.width / 2) * armX
      const anchorZ = initial.position[2] - sign * (initial.width / 2) * armZ
      return {
        width: newWidth,
        position: [
          anchorX + sign * (newWidth / 2) * armX,
          initial.position[1],
          anchorZ + sign * (newWidth / 2) * armZ,
        ],
      }
    },
    placement: {
      position: (n) => [sign * (n.width / 2 + SIDE_HANDLE_OFFSET), 0, 0],
      rotationY: () => (side === 'right' ? 0 : Math.PI),
    },
    portal: 'grandparent',
    portalTarget: resolveWindowHandlePortalTarget,
  }
}

// Window height has two arrows (top + bottom edge) — each anchors at the
// opposite edge so dragging the top grows the window upward and dragging
// the bottom grows it downward without the opposite edge moving.
function windowHeightHandle(edge: 'top' | 'bottom'): HandleDescriptor<WindowNodeType> {
  const sign = edge === 'top' ? 1 : -1
  return {
    kind: 'linear-resize',
    axis: 'y',
    // top arrow anchors at -Y (bottom stays fixed); bottom at +Y (top stays).
    anchor: edge === 'top' ? 'min' : 'max',
    gridSnap: true,
    min: MIN_WINDOW_HEIGHT,
    max: (n, scene) => {
      const dormerMax = readDormerFaceHeightMax(n, scene, sign)
      if (dormerMax !== null) return Math.max(MIN_WINDOW_HEIGHT, dormerMax)
      const roofMax = readRoofFaceHeightMax(n, scene, sign)
      if (roofMax !== null) return Math.max(MIN_WINDOW_HEIGHT, roofMax)
      // Maximum: distance from the anchored edge to the wall's allowed bounds. Top arrow caps at the wall's resolved ceiling - bottom;
      // bottom arrow caps at top (positive Y room above the floor).
      const curtainMax = curtainOpeningResizeMax(n, scene.nodes(), 'y', sign)
      if (curtainMax !== undefined) return curtainMax
      const wallH = readHostWallCeiling(n.wallId || n.parentId, scene, n)
      const anchored = edge === 'top' ? n.position[1] - n.height / 2 : n.position[1] + n.height / 2
      return edge === 'top'
        ? Math.max(MIN_WINDOW_HEIGHT, wallH - anchored)
        : Math.max(MIN_WINDOW_HEIGHT, anchored)
    },
    currentValue: (n) => n.height,
    onDrag: (node) => publishOpeningResizeGuides(node, true),
    apply: (initial, newHeight) => {
      // Anchored edge stays in wall-local Y; opposite edge moves.
      const anchorY =
        edge === 'top'
          ? initial.position[1] - initial.height / 2 // bottom anchored
          : initial.position[1] + initial.height / 2 // top anchored
      const newCenterY = anchorY + sign * (newHeight / 2)
      return {
        height: newHeight,
        position: [initial.position[0], newCenterY, initial.position[2]],
      }
    },
    placement: {
      position: (n) => [0, sign * (n.height / 2 + HEIGHT_HANDLE_OFFSET), 0],
    },
    portal: 'grandparent',
    portalTarget: resolveWindowHandlePortalTarget,
  }
}

function windowRadiusHandle(index: 0 | 1 | 2 | 3): HandleDescriptor<WindowNodeType> {
  const corners = [
    [-1, 1],
    [1, 1],
    [1, -1],
    [-1, -1],
  ] as const
  return {
    kind: 'corner-radius',
    corner: corners[index],
    width: (node) => node.width,
    height: (node) => node.height,
    currentValue: (node) =>
      node.openingRadiusMode === 'individual'
        ? (node.openingCornerRadii[index] ?? 0)
        : node.cornerRadius,
    max: (node) => Math.min(node.width, node.height) / 2,
    apply: (node, radius, _scene, modifiers) => {
      if (!modifiers.shiftKey) {
        return { openingShape: 'rounded', openingRadiusMode: 'all', cornerRadius: radius }
      }
      const radii =
        node.openingRadiusMode === 'individual'
          ? [...node.openingCornerRadii]
          : [node.cornerRadius, node.cornerRadius, node.cornerRadius, node.cornerRadius]
      radii[index] = radius
      return {
        openingShape: 'rounded',
        openingRadiusMode: 'individual',
        openingCornerRadii: radii as [number, number, number, number],
      }
    },
    createPreview: (node) =>
      createOpeningPropertyPreview<WindowNodeType>(node.id, openingPropertyPreviewHost),
    visible: (node) => node.openingShape !== 'arch',
    portal: 'grandparent',
    portalTarget: resolveWindowHandlePortalTarget,
  }
}

const windowHandles: HandleDescriptor<WindowNodeType>[] = [
  windowWidthHandle('left'),
  windowWidthHandle('right'),
  windowHeightHandle('top'),
  windowHeightHandle('bottom'),
  windowRadiusHandle(0),
  windowRadiusHandle(1),
  windowRadiusHandle(2),
  windowRadiusHandle(3),
]

export const windowEditContribution: NodeEditContribution<typeof WindowNode> = {
  snapProfile: 'item',
  facingIndicator: true,
  extensions: {
    'pascal:editor/floorplan': {
      contextualDimensions: buildWindowContextualDimensions,
      schedule: buildWindowFloorplanSchedule,
      // Swap a casement's hinge side from the action bar, in 2D and 3D.
      actionMenu: { actions: () => import('./actions') },
    } satisfies FloorplanNodeExtension<WindowNodeType>,
  },
  capabilities: {
    paint: windowPaint,
  },
  parametrics: windowParametrics,
  handles: (node) =>
    node.source
      ? scriptedOpeningHandles(node, windowWidthHandle, () => windowHeightHandle('top'))
      : windowHandles,
  preview: () => import('./preview'),
  floorplanDependsOnSiblings: true,
  // Opening symbols position from `ctx.parent` (the host wall); merge the
  // walls' live drag overrides so the symbol tracks a wall / group drag in
  // realtime instead of jumping on commit.
  floorplanSiblingOverrides: wallFloorplanSiblingOverrides,
  // Stage D — placement + move-on-wall. Same recipe as door. See
  // `nodes/src/window/{tool,move-tool,window-math}.ts`.
  tool: () => import('./tool'),
  affordanceTools: {
    move: () => import('./move-tool'),
  },
  // 2D move-on-floorplan handler — same shape as door.
  floorplanMoveTarget: windowFloorplanMoveTarget,
  // 2D drag affordances. `resize-width` drives the window's two side
  // arrows — pointer-down on either arrow starts an anchored width drag
  // (opposite edge stays fixed, clamped to wall bounds). Mirrors the
  // door wiring.
  floorplanAffordances: {
    'resize-width': windowWidthAffordance,
  },
  toolHints: [
    { key: 'Left click', label: 'Place window on wall', visible: WINDOW_PLAIN_PLACE_VISIBLE },
    ...WINDOW_CORNER_HINTS,
    ...WINDOW_PLACEMENT_HINTS,
    { key: 'R', label: 'Flip side' },
    { key: 'Alt', label: 'Force place' },
    { key: 'Esc', label: 'Cancel' },
  ],
}
