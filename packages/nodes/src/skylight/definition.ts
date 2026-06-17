import {
  type AnyNode,
  type HandleDescriptor,
  type NodeDefinition,
  type RoofSegmentNode,
  SkylightNode as SkylightNodeSchema,
  type SkylightNode as SkylightNodeType,
} from '@pascal-app/core'
import { buildSkylightFloorplan } from './floorplan'
import {
  closeSkylightOpenState,
  isOperableSkylightNode,
  toggleSkylightOpenState,
} from './interaction'
import { skylightParametrics } from './parametrics'
import { buildSkylightRoofCut } from './roof-cut'
import { SkylightNode } from './schema'

// In-world handle constants. Offsets are measured from the skylight's
// edge to the arrow's CENTER, so they need to clear half the chevron's
// own length (~13 cm at default scale) plus the frame's outward depth
// before there's any visible gap. 0.35 m leaves ~15 cm of clear space
// between the chevron's tail and the skylight frame for a typical
// flat / opening skylight; rotate gizmo gets a matching cushion.
const SIDE_HANDLE_OFFSET = 0.35
const ROTATE_CORNER_OFFSET = 0.35
// Small +X bump so the rotate gizmo reads as sitting *beside* the corner
// instead of perched on its edge — visually separates it from the
// width chevron that shares the +X side.
const ROTATE_CORNER_X_OFFSET = 0.2
// Lift the rotate gizmo a little off the surface so it floats above the
// frame instead of sinking into the curb / shingles around the corner.
const ROTATE_CORNER_Y_OFFSET = 0.18
const ROTATE_RING_OFFSET = 0.06
// Curb arrow sits a small distance above the current curb top so it stays
// grabbable when the curb collapses to zero (flat / walk-on look) and
// doesn't sink into the frame for tall lantern curbs.
const CURB_HANDLE_OFFSET = 0.18
const MIN_SKYLIGHT_DIM = 0.2
const MIN_FRAME_THICKNESS = 0.005

// Width arrows live on ±X (left / right edges of the skylight footprint).
// Asymmetric resize: each arrow only moves its own edge, the opposite
// edge stays put — same pattern as the door and the roof-segment width
// handles. `position` is in segment-surface-tangent coords, so after
// changing width we recenter `position` by half the delta along the
// skylight's own +X axis (rotated by `node.rotation` since the inner
// rotation-y group puts skylight-local X at an angle relative to
// segment-local X).
function skylightWidthHandle(side: 'left' | 'right'): HandleDescriptor<SkylightNodeType> {
  const sign = side === 'right' ? 1 : -1
  return {
    kind: 'linear-resize',
    axis: 'x',
    anchor: side === 'right' ? 'min' : 'max',
    min: MIN_SKYLIGHT_DIM,
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
      position: (n) => [sign * (n.width / 2 + SIDE_HANDLE_OFFSET), 0, 0],
      rotationY: () => (side === 'right' ? 0 : Math.PI),
    },
    // Grandparent so handles render inside the roof (visible) instead of
    // the segment mesh, which lives inside the roof renderer's
    // `<group visible={false}>` segments wrapper. See skylight/renderer
    // for the matching composed-transform group that backs this.
    portal: 'grandparent',
  }
}

// Height arrows on ±Z. Skylight `height` is the dimension along the
// roof's slope direction (X is across-slope). Same asymmetric pattern as
// width — anchored edge stays world-fixed, position recenters by half
// delta along the skylight's own +Z axis (rotated by `node.rotation`).
function skylightHeightHandle(side: 'top' | 'bottom'): HandleDescriptor<SkylightNodeType> {
  const sign = side === 'top' ? 1 : -1
  return {
    kind: 'linear-resize',
    axis: 'z',
    anchor: side === 'top' ? 'min' : 'max',
    min: MIN_SKYLIGHT_DIM,
    currentValue: (n) => n.height,
    apply: (initial, newHeight) => {
      const rotY = initial.rotation ?? 0
      // Skylight-local +Z projects onto segment-surface +X / +Z as
      // (sin r, cos r) — orthogonal to the (cos r, -sin r) basis used
      // for the +X axis above.
      const armX = Math.sin(rotY)
      const armZ = Math.cos(rotY)
      const anchorX = initial.position[0] - sign * (initial.height / 2) * armX
      const anchorZ = initial.position[2] - sign * (initial.height / 2) * armZ
      const newCenterX = anchorX + sign * (newHeight / 2) * armX
      const newCenterZ = anchorZ + sign * (newHeight / 2) * armZ
      return {
        height: newHeight,
        position: [newCenterX, initial.position[1], newCenterZ],
      }
    },
    placement: {
      position: (n) => [0, 0, sign * (n.height / 2 + SIDE_HANDLE_OFFSET)],
      // The +Z chevron points along +Z by default (axis 'z' auto-rotates
      // -π/2 in LinearArrow). For the -Z handle, add +π so it flips.
      rotationY: () => (side === 'top' ? 0 : Math.PI),
    },
    portal: 'grandparent',
  }
}

// Rotate gizmo at the +X+Z corner of the footprint, with a ring guide
// traced around the corner-diagonal radius — same idiom as the roof-
// segment / column / elevator rotate gizmos. Negate the cursor delta to
// match three.js Y-rotation handedness.
function skylightRotateHandle(): HandleDescriptor<SkylightNodeType> {
  return {
    kind: 'arc-resize',
    axis: 'angular',
    shape: 'rotate',
    apply: (initial, delta) => ({ rotation: (initial.rotation ?? 0) - delta }),
    placement: {
      position: (n) => {
        const halfX = n.width / 2
        const halfZ = n.height / 2
        return [
          halfX + ROTATE_CORNER_X_OFFSET,
          ROTATE_CORNER_Y_OFFSET,
          halfZ + ROTATE_CORNER_OFFSET,
        ]
      },
      rotationY: () => -Math.PI / 4,
    },
    decoration: {
      kind: 'ring',
      radius: (n) => Math.hypot(n.width / 2, n.height / 2) + ROTATE_RING_OFFSET,
      y: () => 0,
    },
    portal: 'grandparent',
  }
}

// Curb-height arrow — vertical chevron above the skylight, dragged up
// to raise the curb. Auto-enables `curb: true` when the user grows from
// zero so the geometry actually has a curb to show; preserves `curb`
// flag once it's been set. Placement floats just above the curb top so
// it tracks the value as the user drags and stays above the frame for
// tall lantern curbs.
function skylightCurbHeightHandle(): HandleDescriptor<SkylightNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min',
    min: 0,
    currentValue: (n) => n.curbHeight ?? 0,
    apply: (initial, newValue) => ({
      curbHeight: newValue,
      // Without this, dragging the arrow on a walk-on (curb: false)
      // skylight would change `curbHeight` invisibly because the
      // geometry path ignores it when `curb` is false.
      curb: initial.curb || newValue > 0,
    }),
    placement: {
      position: (n) => [0, (n.curbHeight ?? 0) + CURB_HANDLE_OFFSET, 0],
    },
    portal: 'grandparent',
  }
}

// Frame-thickness arrow — diagonal chevron at the -X+Z (top-left) corner,
// pointing outward along the corner bisector. Lives on the opposite
// corner from the rotate gizmo so they don't compete. axis='z' (instead
// of 'x') so dragging outward toward +Z grows the value 1:1; LinearArrow
// auto-rotates a 'z'-axis chevron by -π/2 (so it points +Z), and the
// extra -π/4 here swings the chevron to -X+Z. The X+Z offsets match
// SIDE_HANDLE_OFFSET on each axis, so the arrow sits the same visual
// distance from the corner that the side chevrons sit from their edges.
function skylightFrameThicknessHandle(): HandleDescriptor<SkylightNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'z',
    anchor: 'min',
    min: MIN_FRAME_THICKNESS,
    currentValue: (n) => n.frameThickness ?? 0.05,
    apply: (_n, newValue) => ({ frameThickness: newValue }),
    placement: {
      position: (n) => [-(n.width / 2) - SIDE_HANDLE_OFFSET, 0, n.height / 2 + SIDE_HANDLE_OFFSET],
      rotationY: () => -Math.PI / 4,
    },
    portal: 'grandparent',
  }
}

const skylightHandles: HandleDescriptor<SkylightNodeType>[] = [
  skylightWidthHandle('right'),
  skylightWidthHandle('left'),
  skylightHeightHandle('top'),
  skylightHeightHandle('bottom'),
  skylightCurbHeightHandle(),
  skylightFrameThicknessHandle(),
  skylightRotateHandle(),
]

/**
 * Skylight — a framed glass opening hosted on a roof segment. All five
 * type variants (flat / walk-on / lantern / opening / sliding) render
 * with the archive's full geometry; the animation system advances
 * `operationState` via `useInteractive.skylightAnimations`.
 */
export const skylightDefinition: NodeDefinition<typeof SkylightNode> = {
  kind: 'skylight',
  schemaVersion: 1,
  schema: SkylightNode,
  category: 'structure',
  surfaceRole: 'glazing',

  defaults: () => {
    const stub = SkylightNodeSchema.parse({
      id: 'skylight_default' as never,
      type: 'skylight',
    })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    // Mounts on a roof segment via `roofSegmentId`. Dirty marks
    // cascade to the host segment's parent roof so its merged shell
    // re-CSGs with the new cut. `buildCut` returns the segment-local
    // box that's subtracted from shin / deck / wall.
    roofAccessory: {
      buildCut: (node: AnyNode, hostSegment: AnyNode) =>
        buildSkylightRoofCut(node as SkylightNodeType, hostSegment as RoofSegmentNode),
    },
  },

  parametrics: skylightParametrics,
  handles: skylightHandles,
  floorplan: buildSkylightFloorplan,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  system: {
    module: () => import('./system'),
    priority: 3,
  },

  tool: () => import('./tool'),
  affordanceTools: {
    move: () => import('./move-tool'),
  },
  toolHints: [
    { key: 'Left click', label: 'Place skylight on roof' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Skylight',
    description: 'Framed glass opening on a roof segment.',
    icon: { kind: 'url', src: '/icons/roof.webp' },
    paletteSection: 'structure',
    paletteOrder: 124,
  },

  mcp: {
    description:
      'A skylight on a roof segment. Five type variants (flat / walk-on / lantern / opening / sliding) — geometry beyond box stub coming later.',
  },

  // R toggles open ↔ closed on operable types (opening / sliding); T
  // forces close. The animation runs through `useInteractive` and the
  // skylight system; see `./interaction.ts`.
  keyboardActions: {
    r: {
      appliesTo: (node: AnyNode) =>
        node.type === 'skylight' && isOperableSkylightNode(node as SkylightNodeType),
      run: (node: AnyNode) => toggleSkylightOpenState(node.id),
    },
    t: {
      appliesTo: (node: AnyNode) =>
        node.type === 'skylight' && isOperableSkylightNode(node as SkylightNodeType),
      run: (node: AnyNode) => closeSkylightOpenState(node.id),
    },
  },
}
