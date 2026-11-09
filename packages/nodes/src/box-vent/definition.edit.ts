import type { BoxVentNode as BoxVentNodeType, HandleDescriptor } from '@pascal-app/core'
import type { NodeEditContribution } from '../definition-contributions'
import { buildBoxVentFloorplan } from './floorplan'
import { boxVentPaint } from './paint'
import { boxVentParametrics } from './parametrics'
import type { BoxVentNode } from './schema'

// Edge-to-arrow-center offset, matching the chimney / dormer cadence.
const SIDE_HANDLE_OFFSET = 0.25

const HEIGHT_HANDLE_OFFSET = 0.2

// Snug to the vent corner — vents are small (default 0.4 m), so the big
// chimney/dormer offset floated the rotate icon far off the item.
const ROTATE_CORNER_OFFSET = 0.1

// Min sizes — vents are small (default 0.4 × 0.4 × 0.15), so the floor
// is well below the default values to allow shrinking without locking.
const MIN_DIM = 0.1

const MIN_HEIGHT = 0.05

// Mid-Y of the vent body in vent-mesh-local. The vent sits with its base
// at y=0 on the slope, so mid is half the height. Side / depth / rotate
// chevrons all place their handle at this Y to read as "this dimension
// is the vent body".
function getBodyMidY(n: BoxVentNodeType): number {
  return Math.max(0.001, n.height) / 2
}

// Width arrow on the +X (right) or -X (left) side of the vent body.
// Asymmetric resize — anchored edge stays world-fixed by recentering
// `position` along the vent's own +X arm in segment frame (matches the
// chimney / dormer width handle math). The slope tilt rotates around
// the vent's base point, so segment-local XZ of the anchored edge stays
// the same regardless of tilt; only the yaw matters for the projection.
function boxVentWidthHandle(side: 'left' | 'right'): HandleDescriptor<BoxVentNodeType> {
  const sign = side === 'right' ? 1 : -1
  return {
    kind: 'linear-resize',
    axis: 'x',
    anchor: side === 'right' ? 'min' : 'max',
    min: MIN_DIM,
    currentValue: (n) => n.width,
    apply: (initial, newWidth) => {
      const rotY = initial.rotation ?? 0
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
      position: (n) => [sign * (n.width / 2 + SIDE_HANDLE_OFFSET), getBodyMidY(n), 0],
      // Flip the left chevron so it points outward toward -X. The
      // generic LinearArrow auto-orients for axis 'z'; +X / -X facing
      // is up to the descriptor.
      rotationY: () => (side === 'right' ? 0 : Math.PI),
    },
  }
}

// Depth arrow on the +Z side. Symmetric (anchor 'center') matches the
// chimney / dormer handle count budget — splitting into asymmetric front /
// back chevrons here would push the vent over the same TSL/MRT pipeline
// threshold those nodes already document. Single symmetric chevron grows
// the depth from the centre.
function boxVentDepthHandle(): HandleDescriptor<BoxVentNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'z',
    anchor: 'center',
    min: MIN_DIM,
    currentValue: (n) => n.depth,
    apply: (_n, newValue) => ({ depth: newValue }),
    placement: {
      position: (n) => [0, getBodyMidY(n), n.depth / 2 + SIDE_HANDLE_OFFSET],
    },
  }
}

// Height arrow above the top of the vent. anchor='min' so the base stays
// pinned to the slope at vent-local y=0 and the top edge follows the
// pointer. Plain chevron (not tracker) — at default sizes (~0.15 m) a
// dashed leader from base to top reads as visual noise rather than a
// dimension cue.
function boxVentHeightHandle(): HandleDescriptor<BoxVentNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min',
    min: MIN_HEIGHT,
    currentValue: (n) => n.height,
    apply: (_n, newValue) => ({ height: Math.max(MIN_HEIGHT, newValue) }),
    placement: {
      position: (n) => [0, Math.max(n.height, MIN_HEIGHT) + HEIGHT_HANDLE_OFFSET, 0],
    },
  }
}

// Whole-vent rotation gizmo at the +X/+Z corner of the body footprint.
// The registered group already centres on the vent and applies its
// composed slope+yaw quaternion, so the default rotation pivot is
// correct — no `rotationCenter` override needed.
function boxVentRotateHandle(): HandleDescriptor<BoxVentNodeType> {
  return {
    kind: 'arc-resize',
    axis: 'angular',
    shape: 'rotate',
    apply: (initial, delta) => ({ rotation: (initial.rotation ?? 0) - delta }),
    placement: {
      position: (n) => [
        n.width / 2 + ROTATE_CORNER_OFFSET,
        getBodyMidY(n),
        n.depth / 2 + ROTATE_CORNER_OFFSET,
      ],
      // Aim the two-headed icon along the +X+Z corner bisector.
      rotationY: () => -Math.PI / 4,
    },
    // Guide ring centred on the vent (drawn at the handle-frame origin),
    // sized to pass through the corner icon so the icon rides the ring and
    // the whole control reads as encircling the item — matches solar-panel.
    decoration: {
      kind: 'ring',
      radius: (n) =>
        Math.hypot(n.width / 2 + ROTATE_CORNER_OFFSET, n.depth / 2 + ROTATE_CORNER_OFFSET),
      y: (n) => getBodyMidY(n),
    },
  }
}

// `portal: 'grandparent'` on every handle: the vent mesh is mounted under
// the roof's `roof-elements` group (reproducing the segment transform), so
// the handle rig must ride the roof→segment→node frame chain — same as
// solar-panel / skylight. Without it the handles (and the rotate arc) mount
// in the bare segment-mesh frame and render offset from the vent.
const boxVentHandles: HandleDescriptor<BoxVentNodeType>[] = [
  boxVentWidthHandle('right'),
  boxVentWidthHandle('left'),
  boxVentDepthHandle(),
  boxVentHeightHandle(),
  boxVentRotateHandle(),
].map((h): HandleDescriptor<BoxVentNodeType> => ({ ...h, portal: 'grandparent' }))

export const boxVentEditContribution: NodeEditContribution<typeof BoxVentNode> = {
  snapProfile: 'item',
  capabilities: {
    paint: boxVentPaint,
  },
  parametrics: boxVentParametrics,
  handles: boxVentHandles,
  floorplan: buildBoxVentFloorplan,
  preview: () => import('./preview'),
  tool: () => import('./tool'),
  affordanceTools: {
    move: () => import('./move-tool'),
  },
  toolHints: [
    { key: 'Left click', label: 'Place box vent on roof' },
    { key: 'Esc', label: 'Cancel' },
  ],
}
