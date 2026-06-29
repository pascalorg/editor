import type {
  AnyNodeId,
  DoorNode as DoorNodeType,
  HandleDescriptor,
  NodeDefinition,
  RoofSegmentNode,
  WallNode,
} from '@pascal-app/core'
import { publishOpeningResizeGuides } from '../shared/opening-guides-runtime'
import { readRoofFaceHeightMax, readRoofFaceWidthMax } from '../shared/roof-opening-host'
import { buildRoofWallOpeningCut } from '../shared/roof-wall-opening-cut'
import { scaleHandleHeight } from './door-math'
import { buildDoorFloorplan } from './floorplan'
import { doorWidthAffordance } from './floorplan-affordances'
import { doorFloorplanMoveTarget } from './floorplan-move'
import { doorPaint } from './paint'
import { doorParametrics } from './parametrics'
import { DoorNode } from './schema'
import { doorSlots } from './slots'

const SIDE_HANDLE_OFFSET = 0.24
const HEIGHT_HANDLE_OFFSET = 0.24
const MIN_DOOR_HEIGHT = 0.5
const MIN_DOOR_WIDTH = 0.3
// How far the move cross floats off the wall face (+Z, the door's facing
// normal) so it's grabbable instead of buried in the leaf/frame.
const MOVE_HANDLE_LIFT = 0.12

function readWallLength(door: DoorNodeType, scene: { get: (id: AnyNodeId) => unknown }): number {
  if (!door.wallId) return Number.POSITIVE_INFINITY
  const wall = scene.get(door.wallId as AnyNodeId) as WallNode | undefined
  if (!wall) return Number.POSITIVE_INFINITY
  return Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
}

function readWallHeight(door: DoorNodeType, scene: { get: (id: AnyNodeId) => unknown }): number {
  if (!door.wallId) return Number.POSITIVE_INFINITY
  const wall = scene.get(door.wallId as AnyNodeId) as WallNode | undefined
  return wall?.height ?? Number.POSITIVE_INFINITY
}

// Width arrow on the door-local +X (right) or -X (left) side. Drag grows
// the door from the anchored OPPOSITE edge; the door's wall-local center
// re-centers so the anchored edge stays put.
function doorWidthHandle(side: 'left' | 'right'): HandleDescriptor<DoorNodeType> {
  const sign = side === 'right' ? 1 : -1
  return {
    kind: 'linear-resize',
    axis: 'x',
    // 'min' = -X edge anchored (right arrow grows the +X edge outward).
    // 'max' = +X edge anchored (left arrow grows the -X edge outward).
    anchor: side === 'right' ? 'min' : 'max',
    min: MIN_DOOR_WIDTH,
    max: (n, scene) => {
      // Roof-hosted doors clamp against the face profile (the wall-based
      // limits read Infinity when wallId is unset).
      const roofMax = readRoofFaceWidthMax(n, scene, sign)
      if (roofMax !== null) return Math.max(MIN_DOOR_WIDTH, roofMax)
      return readWallLength(n, scene)
    },
    currentValue: (n) => n.width,
    onDrag: (node) => publishOpeningResizeGuides(node, false),
    apply: (initial, newWidth) => {
      // Anchored edge stays fixed in wall-local coords. Door rotation is
      // applied by the inner ride group (the renderer mounts a nested
      // <group> at the door's pose), so the apply math here is in
      // door-local coords AND the patch.position must be in wall-local
      // coords. We compute the anchored wall-local point from the
      // initial node, then derive the new wall-local center from it.
      const rotY = initial.rotation[1]
      const armX = Math.cos(rotY)
      const armZ = -Math.sin(rotY)
      const anchorX = initial.position[0] - sign * (initial.width / 2) * armX
      const anchorZ = initial.position[2] - sign * (initial.width / 2) * armZ
      const newCenterX = anchorX + sign * (newWidth / 2) * armX
      const newCenterZ = anchorZ + sign * (newWidth / 2) * armZ
      return {
        width: newWidth,
        position: [newCenterX, initial.position[1], newCenterZ],
      }
    },
    placement: {
      // door-local: +X axis lives along door's own X. Inner ride group
      // applies door.rotation, so we sit purely on door-local +X / -X.
      position: (n) => [sign * (n.width / 2 + SIDE_HANDLE_OFFSET), 0, 0],
      rotationY: () => (side === 'right' ? 0 : Math.PI),
    },
    portal: 'grandparent',
  }
}

function doorHeightHandle(): HandleDescriptor<DoorNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min', // bottom anchored at wall-local Y = position[1] - height/2
    min: MIN_DOOR_HEIGHT,
    max: (n, scene) => {
      const roofMax = readRoofFaceHeightMax(n, scene, 1)
      if (roofMax !== null) return Math.max(MIN_DOOR_HEIGHT, roofMax)
      const bottom = n.position[1] - n.height / 2
      return Math.max(MIN_DOOR_HEIGHT, readWallHeight(n, scene) - bottom)
    },
    currentValue: (n) => n.height,
    onDrag: (node) => publishOpeningResizeGuides(node, false),
    apply: (initial, newHeight) => {
      const bottom = initial.position[1] - initial.height / 2
      // Scale the handle so it tracks the door instead of staying glued to a
      // fixed floor height (shared with the panel's Height slider).
      return {
        height: newHeight,
        position: [initial.position[0], bottom + newHeight / 2, initial.position[2]],
        handleHeight: scaleHandleHeight(initial.handleHeight, initial.height, newHeight),
      }
    },
    placement: {
      position: (n) => [0, n.height / 2 + HEIGHT_HANDLE_OFFSET, 0],
    },
    portal: 'grandparent',
  }
}

// Press-drag move grip at the door centre, standing in the wall face. Routes
// through the same move tool as the floating Move button (3D
// `affordanceTools.move`, 2D `floorplanMoveTarget`) — wall slide + re-host onto
// another wall — but `engageMoveDrag` commits on release, with no second click.
function doorMoveHandle(): HandleDescriptor<DoorNodeType> {
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

const doorHandles: HandleDescriptor<DoorNodeType>[] = [
  doorMoveHandle(),
  doorWidthHandle('left'),
  doorWidthHandle('right'),
  doorHeightHandle(),
]

/**
 * Door — Phase 5 batch kind. Hosted on walls, cuts holes in them,
 * animated open/close state.
 *
 * Capabilities:
 *  - **No `movable`**: door's move is bespoke wall-bound drag (slide
 *    along the wall, snap to wall start/end). Capability-driven dispatch
 *    keeps legacy `MoveDoorTool`.
 *  - `selectable`, `duplicable`, `deletable` standard.
 *
 * Stages:
 *  - A: registered.
 *  - B: deferred — door geometry (frame / leaf / glass / hardware /
 *    segments) is ~800 lines in DoorSystem; extraction is a focused
 *    session. `def.renderer` (wrap-export of legacy DoorRenderer) +
 *    `def.system` (DoorSystem + DoorAnimationSystem bundle) hold parity.
 *  - C: `def.floorplan` polygon sits in parent wall's cutout. Legacy
 *    `openingPolygons` short-circuits door entries when registered.
 */
export const doorDefinition: NodeDefinition<typeof DoorNode> = {
  kind: 'door',
  snapProfile: 'item',
  facingIndicator: true,
  schemaVersion: 1,
  schema: DoorNode,
  category: 'structure',
  surfaceRole: 'joinery',

  // Leverage the schema's zod `.default()` annotations to compute the
  // full default shape — door has 40+ fields, listing them inline would
  // duplicate the schema. Parse a minimal stub, drop id/type, return rest.
  defaults: () => {
    const stub = DoorNode.parse({ id: 'door_default' as never, type: 'door' })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    wallOpeningPlacement: true,
    // Doors also host on roof-segment wall faces (base walls under the
    // roof, gable ends). `buildCut` punches the opening into the
    // segment's wall brush; `dirtyHandledByOwnSystem` keeps the roof-merge
    // loop from consuming door dirty marks (DoorSystem owns them and
    // already cascades to the host via parentId).
    roofAccessory: {
      buildCut: (node, hostSegment) =>
        buildRoofWallOpeningCut(node as DoorNodeType, hostSegment as RoofSegmentNode),
      cutScope: 'wall',
      dirtyHandledByOwnSystem: true,
    },
    // `wallId` / `roofSegmentId` tie the door to its host and are
    // re-derived from the surface under the cursor when a preset is
    // placed. Host apps strip these at preset-save time via
    // `getHostRefFields(def)`.
    hostRefFields: ['wallId', 'roofSegmentId', 'roofFace'],
    // Panel / glass slots painted through the registry. The door system tags
    // each mesh with its `userData.slotId`; paint writes `node.slots`.
    slots: () => doorSlots(),
    paint: doorPaint,
  },

  parametrics: doorParametrics,
  handles: doorHandles,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  system: {
    module: () => import('./system'),
    // Priority 3 mirrors the legacy DoorSystem (after animation at 2,
    // before wall mitering at 4).
    priority: 3,
  },
  // Stage C: floor-plan polygon. Needs ctx.parent (the wall) to compute
  // direction + perpendicular for the cutout footprint.
  floorplan: buildDoorFloorplan,
  floorplanDependsOnSiblings: true,
  // Stage D — placement (`def.tool`) + move-on-wall (`def.
  // affordanceTools.move`). Both ports of the legacy tools at
  // `editor/components/tools/door/`, relocated into the kind folder and
  // wired through ToolManager's registry-first dispatch (`def.tool` for
  // build-mode placement, `getRegistryAffordanceTool` for the move-on-
  // pick flow). Same legacy semantics: wall-event-driven snap, clamped
  // wall-local coords, hasWallChildOverlap guard, live mesh updates.
  tool: () => import('./tool'),
  affordanceTools: {
    move: () => import('./move-tool'),
  },
  // 2D move-on-floorplan handler. When `useEditor.movingNode` is a
  // door and the floor plan is active, `FloorplanRegistryMoveOverlay`
  // dispatches to this instead of the generic translate path — pointer
  // snaps to the nearest wall, projects onto the wall axis, snaps
  // local-X to 0.5m, clamps inside wall bounds.
  floorplanMoveTarget: doorFloorplanMoveTarget,

  // 2D drag affordances. `resize-width` drives the door's two side
  // arrows — pointer-down on either arrow starts an anchored width drag
  // (opposite edge stays fixed, clamped to wall bounds).
  floorplanAffordances: {
    'resize-width': doorWidthAffordance,
  },

  toolHints: [
    { key: 'Left click', label: 'Place door on wall' },
    { key: 'R', label: 'Flip side' },
    { key: 'Alt', label: 'Force place' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Door',
    description: 'A door cut into a wall. Animated open/close state.',
    icon: { kind: 'url', src: '/icons/door.webp' },
    paletteSection: 'structure',
    paletteOrder: 50,
  },

  mcp: {
    description: 'A door mounted on a wall, with type / dimensions / hardware options.',
  },
}
