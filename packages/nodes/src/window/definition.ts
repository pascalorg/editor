import type {
  AnyNodeId,
  HandleDescriptor,
  NodeDefinition,
  RoofSegmentNode,
  WallNode,
  WindowNode as WindowNodeType,
} from '@pascal-app/core'
import { publishOpeningResizeGuides } from '../shared/opening-guides-runtime'
import { readRoofFaceHeightMax, readRoofFaceWidthMax } from '../shared/roof-opening-host'
import { buildRoofWallOpeningCut } from '../shared/roof-wall-opening-cut'
import { buildWindowFloorplan } from './floorplan'
import { windowWidthAffordance } from './floorplan-affordances'
import { windowFloorplanMoveTarget } from './floorplan-move'
import { windowPaint } from './paint'
import { windowParametrics } from './parametrics'
import { WindowNode } from './schema'
import { windowSlots } from './slots'

const SIDE_HANDLE_OFFSET = 0.24
const HEIGHT_HANDLE_OFFSET = 0.24
const MIN_WINDOW_HEIGHT = 0.3
const MIN_WINDOW_WIDTH = 0.3
// How far the move cross floats off the wall face (+Z, the window's facing
// normal) so it's grabbable instead of buried in the sash/frame.
const MOVE_HANDLE_LIFT = 0.12

function readWallLength(w: WindowNodeType, scene: { get: (id: AnyNodeId) => unknown }): number {
  if (!w.wallId) return Number.POSITIVE_INFINITY
  const wall = scene.get(w.wallId as AnyNodeId) as WallNode | undefined
  if (!wall) return Number.POSITIVE_INFINITY
  return Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
}

function readWallHeight(w: WindowNodeType, scene: { get: (id: AnyNodeId) => unknown }): number {
  if (!w.wallId) return Number.POSITIVE_INFINITY
  const wall = scene.get(w.wallId as AnyNodeId) as WallNode | undefined
  return wall?.height ?? Number.POSITIVE_INFINITY
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
    min: MIN_WINDOW_WIDTH,
    max: (n, scene) => {
      // Roof-hosted windows clamp against the face profile (the
      // wall-based limits read Infinity when wallId is unset).
      const roofMax = readRoofFaceWidthMax(n, scene, sign)
      if (roofMax !== null) return Math.max(MIN_WINDOW_WIDTH, roofMax)
      return readWallLength(n, scene)
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
    min: MIN_WINDOW_HEIGHT,
    max: (n, scene) => {
      const roofMax = readRoofFaceHeightMax(n, scene, sign)
      if (roofMax !== null) return Math.max(MIN_WINDOW_HEIGHT, roofMax)
      // Maximum: distance from the anchored edge to the wall's allowed Y
      // bounds. Top arrow caps at wall.height - bottom; bottom arrow caps
      // at top (positive Y room above the floor).
      const wallH = readWallHeight(n, scene)
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
  }
}

// Press-drag move grip at the window centre, standing in the wall face. Routes
// through the same move tool as the floating Move button (3D
// `affordanceTools.move`, 2D `floorplanMoveTarget`) — slide within the wall
// plane + re-host onto another wall — committing on release, no second click.
function windowMoveHandle(): HandleDescriptor<WindowNodeType> {
  return {
    kind: 'tap-action',
    shape: 'move-cross',
    plane: 'node-normal',
    portal: 'grandparent',
    cursor: 'move',
    onActivate: (node, _scene, editor) => editor.engageMoveDrag(node),
    placement: {
      position: () => [0, 0, MOVE_HANDLE_LIFT],
    },
  }
}

const windowHandles: HandleDescriptor<WindowNodeType>[] = [
  windowMoveHandle(),
  windowWidthHandle('left'),
  windowWidthHandle('right'),
  windowHeightHandle('top'),
  windowHeightHandle('bottom'),
]

/**
 * Window — Phase 5 batch kind. Mirrors door's shape: hosted on walls,
 * cuts holes in them, animated open/close state for opening windows.
 *
 * Stages:
 *  - A: registered.
 *  - B: deferred — window geometry ~800 lines; extraction is a focused
 *    session. `def.renderer` + `def.system` wrap-export legacy.
 *  - C: `def.floorplan` polygon sits in parent wall's cutout. Legacy
 *    `openingPolygons` short-circuits window entries when registered.
 */
export const windowDefinition: NodeDefinition<typeof WindowNode> = {
  kind: 'window',
  snapProfile: 'item',
  facingIndicator: true,
  schemaVersion: 1,
  schema: WindowNode,
  category: 'structure',

  // Same schema-driven defaults trick as door: parse a stub, strip
  // id/type. Window also has many fields with zod `.default()` set.
  defaults: () => {
    const stub = WindowNode.parse({ id: 'window_default' as never, type: 'window' })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    wallOpeningPlacement: true,
    // Windows also host on roof-segment wall faces (base walls under the
    // roof, gable ends) — same wiring as door; see the door capability
    // for why `dirtyHandledByOwnSystem` is required.
    roofAccessory: {
      buildCut: (node, hostSegment) =>
        buildRoofWallOpeningCut(node as WindowNodeType, hostSegment as RoofSegmentNode),
      cutScope: 'wall',
      dirtyHandledByOwnSystem: true,
    },
    // `wallId` / `roofSegmentId` are re-derived from the surface under
    // the cursor at preset placement time — see door for the pattern.
    hostRefFields: ['wallId', 'roofSegmentId', 'roofFace'],
    // Frame / glass slots painted through the registry. The window system tags
    // each mesh with its `userData.slotId`; paint writes `node.slots`.
    slots: () => windowSlots(),
    paint: windowPaint,
  },

  parametrics: windowParametrics,
  handles: windowHandles,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  system: {
    module: () => import('./system'),
    priority: 3,
  },
  // Stage C: floor-plan polygon. ctx.parent gives the wall for direction
  // + thickness — same shape as door.
  floorplan: buildWindowFloorplan,
  floorplanDependsOnSiblings: true,
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
    { key: 'Left click', label: 'Place window on wall' },
    { key: 'R', label: 'Flip side' },
    { key: 'Alt', label: 'Force place' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Window',
    description: 'A window cut into a wall. Animated open/close for opening windows.',
    icon: { kind: 'url', src: '/icons/window.webp' },
    paletteSection: 'structure',
    paletteOrder: 60,
  },

  mcp: {
    description: 'A window mounted on a wall, with type / dimensions / opening options.',
  },
}
