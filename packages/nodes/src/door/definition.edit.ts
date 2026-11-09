import type {
  AnyNodeId,
  DoorNode as DoorNodeType,
  HandleDescriptor,
  WallNode,
} from '@pascal-app/core'

import { getDoorOpeningSize } from '@pascal-app/core'

import type { FloorplanNodeExtension } from '@pascal-app/editor'
import type { NodeEditContribution } from '../definition-contributions'
import { curtainOpeningResizeMax } from '../shared/curtain-opening-limits'
import {
  buildDoorFloorplanSchedule,
  computeDoorFloorplanLevelData,
} from '../shared/opening-documentation'
import { publishOpeningResizeGuides } from '../shared/opening-guides-runtime'
import { createOpeningPropertyPreview } from '../shared/opening-property-preview'
import { openingPropertyPreviewHost } from '../shared/opening-property-preview-host'
import { readRoofFaceHeightMax, readRoofFaceWidthMax } from '../shared/roof-opening-host'
import { scriptedOpeningHandles } from '../shared/scripted-opening-handles'
import { readHostWallCeiling, readHostWallCeilingMaxWidth } from '../shared/wall-opening-ceiling'
import { wallFloorplanSiblingOverrides } from '../wall/floorplan-overrides'
import { buildDoorContextualDimensions } from './contextual-dimensions'
import { scaleHandleHeight } from './door-math'
import { buildDoorFloorplan } from './floorplan'
import { doorWidthAffordance } from './floorplan-affordances'
import { doorFloorplanMoveTarget } from './floorplan-move'
import { doorPaint } from './paint'
import { doorParametrics } from './parametrics'
import { DOOR_PLACEMENT_HINTS } from './placement'
import type { DoorNode } from './schema'

const SIDE_HANDLE_OFFSET = 0.24

const HEIGHT_HANDLE_OFFSET = 0.24

const MIN_DOOR_HEIGHT = 0.5

const MIN_DOOR_WIDTH = 0.3

// How far the move cross floats off the wall face (+Z, the door's facing
// normal) so it's grabbable instead of buried in the leaf/frame.
const MOVE_HANDLE_LIFT = 0.12

function readWallLength(door: DoorNodeType, scene: { get: (id: AnyNodeId) => unknown }): number {
  const hostId = door.wallId || door.parentId
  if (!hostId) return Number.POSITIVE_INFINITY
  const wall = scene.get(hostId as AnyNodeId) as WallNode | undefined
  if (wall?.type !== 'wall' || !wall.start || !wall.end) return Number.POSITIVE_INFINITY
  return Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
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
      // Roof-hosted doors clamp against the face profile.
      const roofMax = readRoofFaceWidthMax(n, scene, sign)
      if (roofMax !== null) return Math.max(MIN_DOOR_WIDTH, roofMax)
      const curtainMax = curtainOpeningResizeMax(n, scene.nodes(), 'x', sign)
      if (curtainMax !== undefined) return curtainMax
      const lengthMax = readWallLength(n, scene) - (getDoorOpeningSize(n).width - n.width)
      // rotation[1] = π flips the door, so its visual right edge moves toward lower wall-local S.
      const growSign = sign * Math.cos(n.rotation[1]) > 0 ? 1 : -1
      const fixedEdgeS = n.position[0] - (growSign * n.width) / 2
      const topY = n.position[1] - n.height / 2 + getDoorOpeningSize(n).height
      return Math.max(
        MIN_DOOR_WIDTH,
        readHostWallCeilingMaxWidth(
          n.wallId || n.parentId,
          scene,
          fixedEdgeS,
          growSign,
          topY,
          lengthMax,
          n,
        ),
      )
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
      position: (n) => [
        -getDoorOpeningSize(n).leafOffsetX +
          sign * (getDoorOpeningSize(n).width / 2 + SIDE_HANDLE_OFFSET),
        0,
        0,
      ],
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
      const curtainMax = curtainOpeningResizeMax(n, scene.nodes(), 'y', 1)
      if (curtainMax !== undefined) return curtainMax
      const bottom = n.position[1] - n.height / 2
      return Math.max(
        MIN_DOOR_HEIGHT,
        readHostWallCeiling(n.wallId || n.parentId, scene, n) -
          bottom -
          (getDoorOpeningSize(n).height - n.height),
      )
    },
    currentValue: (n) => n.height,
    onDrag: (node) => publishOpeningResizeGuides(node, true),
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
      position: (n) => [0, getDoorOpeningSize(n).height - n.height / 2 + HEIGHT_HANDLE_OFFSET, 0],
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

function doorRadiusHandle(index: 0 | 1): HandleDescriptor<DoorNodeType> {
  const sign = index === 0 ? -1 : 1
  return {
    kind: 'corner-radius',
    corner: [sign, 1],
    width: (node) => node.width,
    height: (node) => node.height,
    currentValue: (node) =>
      node.openingRadiusMode === 'individual'
        ? (node.openingTopRadii[index] ?? 0)
        : node.cornerRadius,
    max: (node) => Math.min(node.width / 2, node.height),
    apply: (node, radius, _scene, modifiers) => {
      if (!modifiers.shiftKey) {
        return { openingShape: 'rounded', openingRadiusMode: 'all', cornerRadius: radius }
      }
      const radii =
        node.openingRadiusMode === 'individual'
          ? [...node.openingTopRadii]
          : [node.cornerRadius, node.cornerRadius]
      radii[index] = radius
      return {
        openingShape: 'rounded',
        openingRadiusMode: 'individual',
        openingTopRadii: radii as [number, number],
      }
    },
    createPreview: (node) =>
      createOpeningPropertyPreview<DoorNodeType>(node.id, openingPropertyPreviewHost),
    visible: (node) => node.openingShape !== 'arch',
    portal: 'grandparent',
  }
}

const doorHandles: HandleDescriptor<DoorNodeType>[] = [
  doorMoveHandle(),
  doorWidthHandle('left'),
  doorWidthHandle('right'),
  doorHeightHandle(),
  doorRadiusHandle(0),
  doorRadiusHandle(1),
]

export const doorEditContribution: NodeEditContribution<typeof DoorNode> = {
  snapProfile: 'item',
  facingIndicator: true,
  extensions: {
    'pascal:editor/floorplan': {
      contextualDimensions: buildDoorContextualDimensions,
      schedule: buildDoorFloorplanSchedule,
      // Swap hinge / swing side from the action bar, in 2D and 3D.
      actionMenu: { actions: () => import('./actions') },
    } satisfies FloorplanNodeExtension<DoorNodeType>,
  },
  capabilities: {
    paint: doorPaint,
  },
  parametrics: doorParametrics,
  handles: (node) =>
    node.source
      ? [doorMoveHandle(), ...scriptedOpeningHandles(node, doorWidthHandle, doorHeightHandle)]
      : doorHandles,
  preview: () => import('./preview'),
  // Stage C: floor-plan polygon. Needs ctx.parent (the wall) to compute
  // direction + perpendicular for the cutout footprint.
  floorplan: buildDoorFloorplan,
  computeFloorplanLevelData: computeDoorFloorplanLevelData,
  floorplanDependsOnSiblings: true,
  // Opening symbols position from `ctx.parent` (the host wall); merge the
  // walls' live drag overrides so the symbol tracks a wall / group drag in
  // realtime instead of jumping on commit.
  floorplanSiblingOverrides: wallFloorplanSiblingOverrides,
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
    ...DOOR_PLACEMENT_HINTS,
    { key: 'R', label: 'Flip side' },
    { key: 'Alt', label: 'Force place' },
    { key: 'Esc', label: 'Cancel' },
  ],
}
