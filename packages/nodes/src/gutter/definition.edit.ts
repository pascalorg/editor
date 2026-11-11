import type { GutterNode as GutterNodeType, HandleDescriptor } from '@pascal-app/core'
import type { NodeEditContribution } from '../definition-contributions'
import { snapLengthToCorner } from './length-snap'
import { gutterPaint } from './paint'
import { gutterParametrics } from './parametrics'
import type { GutterNode } from './schema'

// Edge-to-arrow-center offset, matching the box-vent / ridge-vent
// cadence so a roof's worth of accessories all read at the same scale.
const SIDE_HANDLE_OFFSET = 0.2

// Gutter chevrons sit BELOW the gutter (the trough hangs below the
// eave); the Y handle places its arrow under the cross-section apex.
const SIZE_HANDLE_OFFSET = 0.15

// Minimums — well below the inspector defaults (2.0 m length, 0.13 m
// profile) so users can shrink freely without locking.
const MIN_LENGTH = 0.2

const MIN_SIZE = 0.05

// Centre of the gutter cross-section in vertical (Y) terms. The gutter
// hangs from the eave (Y=0 in vent-mesh-local) down to Y=-size; chevrons
// that want to read "beside the body" sit at -size/2.
function getBodyMidY(n: GutterNodeType): number {
  return -Math.max(MIN_SIZE, n.size) / 2
}

// Outward Z midpoint — the gutter's back wall sits at Z=0 and the rim
// hangs out to Z≈+size (k-style) / +size (half-round / box). Side
// handles place at Z=0 so they sit ABOVE the eave's fascia line.
function getRimZ(n: GutterNodeType): number {
  return Math.max(MIN_SIZE, n.size) / 2
}

// Length arrow on ±X (the eave direction). Asymmetric resize: drag one
// end outward while the opposite end stays world-fixed by recentering
// `position` along the gutter's own +X arm in segment frame. Same
// yaw-aware projection as the box-vent / ridge-vent / chimney width
// handles.
//
// Corner snap: when the dragged endpoint nears the geometric corner it
// would form with another gutter (the crossing of their length axes),
// `snapLengthToCorner` is the handle's magnetic snap, so Lines mode lands the
// endpoint exactly on that corner, Grid mode uses the chosen step, and Off
// leaves the cursor raw. Only this gutter's length changes.
function gutterLengthHandle(side: 'left' | 'right'): HandleDescriptor<GutterNodeType> {
  const sign = side === 'right' ? 1 : -1
  return {
    kind: 'linear-resize',
    axis: 'x',
    anchor: side === 'right' ? 'min' : 'max',
    min: MIN_LENGTH,
    gridSnap: true,
    currentValue: (n) => n.length,
    magneticSnap: (initial, newLength, sceneApi) => {
      const rotY = initial.rotation ?? 0
      const armX = Math.cos(rotY)
      const armZ = -Math.sin(rotY)
      const anchorX = initial.position[0] - sign * (initial.length / 2) * armX
      const anchorZ = initial.position[2] - sign * (initial.length / 2) * armZ
      return snapLengthToCorner(
        initial,
        newLength,
        sign,
        anchorX,
        anchorZ,
        armX,
        armZ,
        MIN_LENGTH,
        sceneApi,
      ).length
    },
    apply: (initial, newLength) => {
      const rotY = initial.rotation ?? 0
      const armX = Math.cos(rotY)
      const armZ = -Math.sin(rotY)
      const anchorX = initial.position[0] - sign * (initial.length / 2) * armX
      const anchorZ = initial.position[2] - sign * (initial.length / 2) * armZ
      const newCenterX = anchorX + sign * (newLength / 2) * armX
      const newCenterZ = anchorZ + sign * (newLength / 2) * armZ
      return {
        length: newLength,
        position: [newCenterX, initial.position[1], newCenterZ],
      }
    },
    placement: {
      position: (n) => [sign * (n.length / 2 + SIDE_HANDLE_OFFSET), getBodyMidY(n), getRimZ(n)],
      rotationY: () => (side === 'right' ? 0 : Math.PI),
    },
  }
}

// Profile-size arrow below the rim. axis='y', anchor='max' pins the
// top of the trough (Y=0, the eave line) and grows the bottom edge
// downward as the user drags toward -Y. Plain chevron — at typical
// sizes (5″–6″) a dashed tracker would clutter the eave line.
function gutterSizeHandle(): HandleDescriptor<GutterNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    // 'max' = +Y edge anchored (top of the trough stays at Y=0); drag
    // pulls the bottom edge further down. The base linear-resize
    // factor for `max` is -1, which flips the cursor delta so dragging
    // downward grows the value 1:1.
    anchor: 'max',
    min: MIN_SIZE,
    gridSnap: true,
    currentValue: (n) => n.size,
    apply: (_n, newValue) => ({ size: Math.max(MIN_SIZE, newValue) }),
    placement: {
      // Sit at the bottom of the trough, pushed a bit further down so
      // the chevron clears the rim and reads as a downward indicator.
      position: (n) => [0, -Math.max(n.size, MIN_SIZE) - SIZE_HANDLE_OFFSET, getRimZ(n)],
    },
  }
}

const gutterHandles: HandleDescriptor<GutterNodeType>[] = [
  gutterLengthHandle('right'),
  gutterLengthHandle('left'),
  gutterSizeHandle(),
]

export const gutterEditContribution: NodeEditContribution<typeof GutterNode> = {
  snapProfile: 'item',
  capabilities: {
    paint: gutterPaint,
  },
  parametrics: gutterParametrics,
  handles: gutterHandles,
  floorplanDependsOnSiblings: true,
  preview: () => import('./preview'),
  tool: () => import('./tool'),
  affordanceTools: {
    move: () => import('./move-tool'),
  },
  toolHints: [
    { key: 'Left click', label: 'Place gutter on roof eave' },
    { key: 'Esc', label: 'Cancel' },
  ],
}
