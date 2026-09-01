import {
  type AnyNode,
  DormerNode as DormerNodeSchema,
  type DormerNode as DormerNodeType,
  type HandleDescriptor,
  type NodeDefinition,
} from '@pascal-app/core'
import { buildDormerRoofCut } from './csg-geometry'
import { buildDormerFloorplan } from './floorplan'
import { dormerPaint } from './paint'
import { dormerParametrics } from './parametrics'
import { DormerNode } from './schema'

const SIDE_HANDLE_OFFSET = 0.25
const HEIGHT_HANDLE_OFFSET = 0.25
const ROTATE_CORNER_OFFSET = 0.35
const ROTATE_RING_OFFSET = 0.08
// Schema/parametrics ranges — keep these aligned with `dormerParametrics`
// so the in-world drag and the inspector slider clamp identically.
const MIN_DIM = 0.5
const MIN_HEIGHT = 0
const MIN_ROOF_HEIGHT = 0
const MAX_ROOF_HEIGHT = 2
const MIN_SKIRT = 0.2
const MAX_SKIRT = 6
// Clamp used for handle Y placement so side chevrons stay reachable on
// dormers whose wall is flat (`height ≈ 0`). The dormer body is
// `height + roofHeight` tall; if that collapses too, the side arrows
// would bury into the deck — this floor keeps them visible.
const MIN_BODY_DISPLAY = 0.3

// Mid-Y of the dormer body in dormer-local frame. Y=0 is the eave
// (where wall meets skirt); body extends up to `height + roofHeight`.
// Side chevrons sit at the body midpoint so they read as "this is the
// dormer's footprint" rather than floating at the apex or the eave.
function getBodyMidY(n: DormerNodeType): number {
  return Math.max(n.height + n.roofHeight, MIN_BODY_DISPLAY) / 2
}

// Width arrow on the +X (right) or -X (left) side. Asymmetric resize:
// dragging one arrow grows the dormer outward from its own edge while
// the opposite edge stays world-fixed in segment frame. The dormer's
// registered ref frame is dormer-local (renderer applies position +
// rotation on the registered group), so placements are in dormer-local
// coords — no per-arrow rotation/translation compensation here.
//
// `apply` recomputes `position` so the anchored edge stays at the same
// segment-local point even when the dormer is Y-rotated: project the
// dormer's local +X onto segment frame via (cos r, -sin r), find the
// anchored edge's segment-local XZ from the pre-drag node, then place
// the new center half a new-width away from that anchor in the same
// direction. Mirrors chimney + roof-segment width handle math.
function dormerWidthHandle(side: 'left' | 'right'): HandleDescriptor<DormerNodeType> {
  const sign = side === 'right' ? 1 : -1
  return {
    kind: 'linear-resize',
    axis: 'x',
    // 'min' = -X edge anchored (right arrow grows the +X edge outward).
    // 'max' = +X edge anchored (left arrow grows the -X edge outward).
    anchor: side === 'right' ? 'min' : 'max',
    // Default 'parent' portal (no `'grandparent'` escape). Arrows
    // portal into the host roof segment's registered mesh, which lives
    // inside the roof renderer's `<group name="segments-wrapper">`.
    // That wrapper is `visible={false}` by default; `RoofEditSystem`
    // imperatively flips it to `visible={true}` whenever any accessory
    // hosted on a segment of this roof is selected, so the portaled
    // arrows become visible during selection without us reaching for
    // `portal: 'grandparent'` — which trips the same "Color target has
    // no corresponding fragment stage output" WebGPU pipeline error
    // chimney already documents.
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
      // generic LinearArrow only auto-orients for axis 'z'; +X / -X
      // facing is up to the descriptor.
      rotationY: () => (side === 'right' ? 0 : Math.PI),
    },
  }
}

// Depth arrow on the +Z (front) or -Z (back) side. Asymmetric resize:
// dragging one arrow grows the dormer outward from its own edge while
// the opposite edge stays world-fixed in segment frame — same pattern
// as `dormerWidthHandle`, just on the Z axis. `apply` recomputes
// `position` so the anchored edge stays at the same segment-local point
// even when the dormer is Y-rotated: project the dormer's local +Z onto
// segment frame via (sin r, cos r), find the anchored edge's segment-
// local XZ from the pre-drag node, then place the new center half a new-
// depth away from that anchor in the same direction.
function dormerDepthHandle(side: 'front' | 'back'): HandleDescriptor<DormerNodeType> {
  const sign = side === 'front' ? 1 : -1
  return {
    kind: 'linear-resize',
    axis: 'z',
    // 'min' = -Z edge anchored (front arrow grows the +Z edge outward).
    // 'max' = +Z edge anchored (back arrow grows the -Z edge outward).
    anchor: side === 'front' ? 'min' : 'max',
    min: MIN_DIM,
    currentValue: (n) => n.depth,
    apply: (initial, newDepth) => {
      const rotY = initial.rotation ?? 0
      const armX = Math.sin(rotY)
      const armZ = Math.cos(rotY)
      const anchorX = initial.position[0] - sign * (initial.depth / 2) * armX
      const anchorZ = initial.position[2] - sign * (initial.depth / 2) * armZ
      const newCenterX = anchorX + sign * (newDepth / 2) * armX
      const newCenterZ = anchorZ + sign * (newDepth / 2) * armZ
      return {
        depth: newDepth,
        position: [newCenterX, initial.position[1], newCenterZ],
      }
    },
    placement: {
      position: (n) => [0, getBodyMidY(n), sign * (n.depth / 2 + SIDE_HANDLE_OFFSET)],
      // The renderer auto-yaws axis-'z' chevrons by -π/2 so the default
      // points +Z (front). Flip the back chevron 180° to point -Z.
      rotationY: () => (side === 'front' ? 0 : Math.PI),
    },
  }
}

// Wall-height tracker — dashed vertical leader from the eave (y=0) up
// to a draggable cube at the wall top (y=height), centred on the
// footprint. Reads as "the dormer wall is THIS tall" without claiming
// the roof apex. Same `linear-resize axis='y'` pipeline as every other
// height handle; `shape: 'tracker'` only swaps the visual.
function dormerWallHeightHandle(): HandleDescriptor<DormerNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min',
    shape: 'tracker',
    min: MIN_HEIGHT,
    currentValue: (n) => n.height,
    apply: (_n, newValue) => ({ height: newValue }),
    placement: {
      position: (n) => [0, Math.max(n.height, 0.001), 0],
    },
    trackerBaseY: () => 0,
  }
}

// Wall-skirt chevron — sits BELOW the eave, at the bottom of the
// hung-wall skirt that extends down into the host roof. Drag pulls the
// skirt's bottom edge further down (or up) to grow / shrink
// `wallSkirtHeight`. Anchor 'max' keeps the eave (y=0) fixed; the
// linear-resize factor (-1 for anchor 'max') flips the drag sign so
// dragging the chevron downward increases the value 1:1.
//
// Plain arrow (not tracker) because tracker only renders an upward
// leader; the dashed line would point the wrong way for a downward
// span. The auto-orient logic in `ArrowHandle` flips the chevron to
// point -Y when placement.y < 0, so the arrow visibly points down.
function dormerWallSkirtHandle(): HandleDescriptor<DormerNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'max',
    min: MIN_SKIRT,
    max: MAX_SKIRT,
    currentValue: (n) => n.wallSkirtHeight,
    apply: (_n, newValue) => ({ wallSkirtHeight: newValue }),
    placement: {
      position: (n) => [0, -(n.wallSkirtHeight + HEIGHT_HANDLE_OFFSET), 0],
    },
  }
}

// Roof-height chevron at the dormer's peak. Drag adjusts `roofHeight`
// directly — unlike roof-segment there's no pitch back-solve because
// dormer stores roof height as a literal scalar, not a pitch angle.
// Placed slightly above the apex (height + roofHeight) so the chevron
// visually attaches to the ridge.
function dormerRoofHeightHandle(): HandleDescriptor<DormerNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min',
    min: MIN_ROOF_HEIGHT,
    max: MAX_ROOF_HEIGHT,
    currentValue: (n) => n.roofHeight,
    apply: (_n, newValue) => ({ roofHeight: newValue }),
    placement: {
      position: (n) => [0, n.height + n.roofHeight + HEIGHT_HANDLE_OFFSET, 0],
    },
  }
}

// Whole-dormer rotation gizmo at the +X / +Z corner of the footprint,
// guide ring traces the corner-diagonal radius on hover / drag.
// Dormer-local frame is the registered group (renderer applies
// node.position + node.rotation there), so the default rotation pivot
// (rideObject origin = dormer center) is correct — no
// `rotationCenter` override needed.
function dormerRotateHandle(): HandleDescriptor<DormerNodeType> {
  return {
    kind: 'arc-resize',
    axis: 'angular',
    shape: 'rotate',
    // Negate the cursor delta to match three.js Y-rotation handedness
    // (cursor atan2 ticks opposite-handed from `rotation-y`).
    apply: (initial, delta) => ({ rotation: (initial.rotation ?? 0) - delta }),
    placement: {
      position: (n) => {
        const halfX = n.width / 2 + ROTATE_CORNER_OFFSET
        const halfZ = n.depth / 2 + ROTATE_CORNER_OFFSET
        return [halfX, getBodyMidY(n), halfZ]
      },
      // The two-headed icon's natural bias points along +X; aim it at
      // the corner (45° outward from the dormer's local frame).
      rotationY: () => -Math.PI / 4,
    },
    decoration: {
      kind: 'ring',
      radius: (n) => Math.hypot(n.width / 2, n.depth / 2) + ROTATE_RING_OFFSET,
      y: (n) => getBodyMidY(n),
    },
  }
}

const dormerHandles: HandleDescriptor<DormerNodeType>[] = [
  dormerWidthHandle('right'),
  dormerWidthHandle('left'),
  dormerDepthHandle('front'),
  dormerDepthHandle('back'),
  dormerWallHeightHandle(),
  dormerRotateHandle(),
  // The wall-skirt (downward chevron), roof-height (peak chevron), and
  // the asymmetric front/back depth split stay out for now. Re-adding
  // any of them previously fired the "Color target has no
  // corresponding fragment stage output" WebGPU pipeline error chimney
  // already documented for its flue / cap-thickness / cap-overhang
  // extras — only reproducible while `portal: 'grandparent'` was set,
  // which we no longer rely on (RoofEditSystem reveals the wrapper
  // instead). The shapes themselves are valid; if the count budget
  // turns out to also be sensitive without grandparent portal, keep
  // the current compact set.
  // dormerWallSkirtHandle(),
  // dormerRoofHeightHandle(),
]

/**
 * Dormer — a small house-shaped protrusion sitting on top of a roof
 * segment. Windows are hosted child nodes; the legacy window* fields remain
 * in the schema only so scene migration can preserve older dormers.
 *
 * The renderer cuts each hosted window from the dormer shell and mounts
 * the regular WindowNode renderer in the selected wall-face frame.
 */
export const dormerDefinition: NodeDefinition<typeof DormerNode> = {
  kind: 'dormer',
  schemaVersion: 4,
  schema: DormerNode,
  category: 'structure',
  surfaceRole: 'roof',

  defaults: () => {
    // Zod fills in id/type via their .default() factories; we strip
    // both so the returned shape is a partial template a consumer can
    // spread into createNode() with a fresh id.
    const stub = DormerNodeSchema.parse({})
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    // Dormers own their WindowNode children. Duplicate the complete subtree
    // so the copied dormer never aliases windows from the source dormer.
    duplicable: { subtree: true },
    deletable: true,
    // Mounts on a roof segment via `roofSegmentId`. Dirty marks
    // cascade to the host segment's parent roof so its merged shell
    // re-CSGs with the new cut. `buildCut` returns the segment-local
    // geometry the merge loop subtracts from shin / deck / wall.
    roofAccessory: {
      buildCut: (node: AnyNode, _hostSegment: AnyNode) =>
        buildDormerRoofCut(node as DormerNodeType),
    },
    // Paint dispatch for the wall / side / top surface split. The
    // editor's selection-manager routes paint hover / click /
    // preview through this entry rather than carrying a kind-name
    // arm.
    paint: dormerPaint,
  },

  relations: {
    hosts: ['window'],
    cascadeDelete: 'descendants',
  },

  affordanceTools: {
    // Drag-to-place tool for duplicate + move. Reuses the placement
    // ghost preview but seeds it from the moving (cloned) node so the
    // duplicate keeps the source's dimensions, materials, and window
    // options.
    move: () => import('./move-tool'),
  },

  parametrics: dormerParametrics,
  handles: dormerHandles,
  floorplan: buildDormerFloorplan,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  preview: () => import('./preview'),

  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: 'nodes.dormer.toolHints.place' },
    { key: 'R / Shift+R', label: 'nodes.dormer.toolHints.rotateGhost' },
    { key: 'Esc', label: 'common.cancel' },
  ],

  presentation: {
    label: 'Dormer',
    description: 'House-shaped protrusion on a roof segment.',
    icon: { kind: 'url', src: '/icons/dormer.webp' },
    paletteSection: 'structure',
    paletteOrder: 125,
  },

  mcp: {
    description: 'A dormer on a roof segment. Its windows are hosted WindowNode children.',
  },
}
