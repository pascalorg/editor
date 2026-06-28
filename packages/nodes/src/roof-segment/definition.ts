import {
  getActiveRoofHeight,
  getPitchFromActiveRoofHeight,
  type HandleDescriptor,
  type NodeDefinition,
  RoofSegmentNode as RoofSegmentNodeSchema,
  type RoofSegmentNode as RoofSegmentNodeType,
} from '@pascal-app/core'
import { buildRoofSegmentFloorplan } from './floorplan'
import {
  roofSegmentMoveTarget,
  roofSegmentResizeAffordance,
  roofSegmentRotateAffordance,
} from './floorplan-affordances'
import { roofSegmentParametrics } from './parametrics'
import { RoofSegmentNode } from './schema'

const SIDE_HANDLE_OFFSET = 0.3
const HEIGHT_HANDLE_OFFSET = 0.3
const ROTATE_CORNER_OFFSET = 0.4
const ROTATE_RING_OFFSET = 0.08
const MIN_ROOF_DIM = 1
const MIN_WALL_HEIGHT = 0
// Clamp used for handle Y placement so arrows stay visible on flat /
// wall-less segments where `wallHeight ≈ 0` would put them on the floor.
const MIN_WALL_DISPLAY = 0.3
// Pitch is stored in degrees on the schema; same clamp the panel applies.
const MIN_PITCH = 0
const MAX_PITCH = 85

// Floor-to-peak height of the assembled segment. Pitch drag drives this
// value directly and back-solves the pitch angle via the slope-frame
// math in core.
function getPeakHeight(n: RoofSegmentNodeType): number {
  return n.wallHeight + getActiveRoofHeight(n)
}

// Width arrow on the +X (right) or -X (left) side. Asymmetric resize:
// dragging one arrow grows the segment outward from its own edge while
// the opposite edge stays world-fixed — the same pattern doors use
// (`door/definition.ts:35-73`). The arrow's chevron points outward
// (`rotationY: Math.PI` flips the left arrow's chevron to face -X) so
// you read "this edge is what moves" at a glance.
//
// `apply` recomputes `position` so the anchored edge stays at the same
// world point even when the segment is Y-rotated: project the segment's
// local +X onto world via (cos r, -sin r), find the anchored edge's
// world XZ from the pre-drag node, then place the new center half a
// new-width away from that anchor in the same direction.
function roofSegmentWidthHandle(side: 'left' | 'right'): HandleDescriptor<RoofSegmentNodeType> {
  const sign = side === 'right' ? 1 : -1
  return {
    kind: 'linear-resize',
    axis: 'x',
    // 'min' = -X edge anchored (right arrow grows the +X edge outward).
    // 'max' = +X edge anchored (left arrow grows the -X edge outward).
    anchor: side === 'right' ? 'min' : 'max',
    min: MIN_ROOF_DIM,
    gridSnap: true,
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
      position: (n) => [
        sign * (n.width / 2 + SIDE_HANDLE_OFFSET),
        Math.max(n.wallHeight, MIN_WALL_DISPLAY) / 2,
        0,
      ],
      // Flip the left chevron so it points outward toward -X. The
      // generic LinearArrow only auto-orients for axis 'z' (rotates the
      // chevron 90° to face +Z); +X / -X facing is up to the descriptor.
      rotationY: () => (side === 'right' ? 0 : Math.PI),
    },
  }
}

// Depth arrow on the +Z (front) or -Z (back) side. Asymmetric: the
// dragged edge follows the pointer, the opposite edge stays world-fixed
// — mirrors the width-handle pattern (`roofSegmentWidthHandle`). Because
// segment depth feeds the pitch math via `getActiveRoofHeight`, growing
// depth at constant pitch ramps the peak up too, which reads as
// scaling. We hold the peak height constant by back-solving a new pitch
// for the new depth (same recipe the pitch handle uses, run in
// reverse). MIN/MAX_PITCH clamps cover degenerate cases where the new
// depth would demand a negative or beyond-vertical pitch.
function roofSegmentDepthHandle(side: 'front' | 'back'): HandleDescriptor<RoofSegmentNodeType> {
  const sign = side === 'front' ? 1 : -1
  return {
    kind: 'linear-resize',
    axis: 'z',
    anchor: side === 'front' ? 'min' : 'max',
    min: MIN_ROOF_DIM,
    gridSnap: true,
    currentValue: (n) => n.depth,
    apply: (initial, newDepth) => {
      // Recenter so the anchored Z edge stays at the same world point.
      // Same math as the width handle but along the Z arm: yaw maps
      // segment-local +Z to (sin r, cos r) in world.
      const rotY = initial.rotation ?? 0
      const armX = Math.sin(rotY)
      const armZ = Math.cos(rotY)
      const anchorX = initial.position[0] - sign * (initial.depth / 2) * armX
      const anchorZ = initial.position[2] - sign * (initial.depth / 2) * armZ
      const newCenterX = anchorX + sign * (newDepth / 2) * armX
      const newCenterZ = anchorZ + sign * (newDepth / 2) * armZ

      // Preserve peak height — back-solve pitch for the new depth so
      // the assembled roof height matches what it was before the drag.
      const originalRoofHeight = getActiveRoofHeight(initial)
      const newPitch = getPitchFromActiveRoofHeight({
        roofType: initial.roofType,
        width: initial.width,
        depth: newDepth,
        roofHeight: originalRoofHeight,
        gambrelLowerWidthRatio: initial.gambrelLowerWidthRatio,
        gambrelLowerHeightRatio: initial.gambrelLowerHeightRatio,
        mansardSteepWidthRatio: initial.mansardSteepWidthRatio,
        mansardSteepHeightRatio: initial.mansardSteepHeightRatio,
        dutchHipWidthRatio: initial.dutchHipWidthRatio,
        dutchHipHeightRatio: initial.dutchHipHeightRatio,
      })

      return {
        depth: newDepth,
        position: [newCenterX, initial.position[1], newCenterZ],
        pitch: Math.max(MIN_PITCH, Math.min(MAX_PITCH, newPitch)),
      }
    },
    placement: {
      position: (n) => [
        0,
        Math.max(n.wallHeight, MIN_WALL_DISPLAY) / 2,
        sign * (n.depth / 2 + SIDE_HANDLE_OFFSET),
      ],
      // For axis 'z', `LinearArrow` adds -π/2 around Y so the chevron
      // points +Z by default. Flip the back arrow by π so it points -Z.
      rotationY: () => (side === 'front' ? 0 : Math.PI),
    },
  }
}

// Wall-height tracker — dashed vertical leader from the floor up to a
// draggable cube at the wall top, centred on the footprint. Replaces
// the old -X-side chevron so the wall-top control reads as "the wall is
// THIS tall" instead of "there's an arrow on the side." Drag math is
// unchanged: same linear-resize axis='y' / anchor='min' pipeline as
// every other height handle; the `shape: 'tracker'` flag only swaps the
// visual. Wall-height clamps to MIN_WALL_DISPLAY for placement so the
// cube stays grabbable on flat / wall-less segments where the real
// `wallHeight` is ~0 and the leader would collapse to nothing.
function roofSegmentWallHeightHandle(): HandleDescriptor<RoofSegmentNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min',
    shape: 'tracker',
    min: MIN_WALL_HEIGHT,
    currentValue: (n) => n.wallHeight,
    apply: (_n, newValue) => ({ wallHeight: newValue }),
    placement: {
      position: (n) => [0, Math.max(n.wallHeight, MIN_WALL_DISPLAY), 0],
    },
  }
}

// Pitch arrow — drag the peak vertically to steepen / flatten the roof.
// The handle exposes the floor-to-peak height as its currentValue so the
// drag delta is a meters value the user can read in the dimension chip;
// `apply` inverts the slope-frame math (run = primary-slope footprint
// span, rise fraction depends on roofType) to recover the pitch degrees
// the new peak corresponds to. Clamped to the schema range [0, 85].
//
// Placed at the peak's center so it visually attaches to the ridge for
// gable / hip / dutch / mansard / gambrel; on shed roofs the geometric
// peak sits at one edge, so the arrow floats slightly inboard of the
// ridge — acceptable as a "peak-height" affordance and matches the
// floorplan-center origin every other handle uses.
function roofSegmentPitchHandle(): HandleDescriptor<RoofSegmentNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min',
    min: (n) => n.wallHeight,
    currentValue: (n) => getPeakHeight(n),
    apply: (initial, newPeakHeight) => {
      const roofHeight = Math.max(0, newPeakHeight - initial.wallHeight)
      const pitch = getPitchFromActiveRoofHeight({
        roofType: initial.roofType,
        width: initial.width,
        depth: initial.depth,
        roofHeight,
        gambrelLowerWidthRatio: initial.gambrelLowerWidthRatio,
        gambrelLowerHeightRatio: initial.gambrelLowerHeightRatio,
        mansardSteepWidthRatio: initial.mansardSteepWidthRatio,
        mansardSteepHeightRatio: initial.mansardSteepHeightRatio,
        dutchHipWidthRatio: initial.dutchHipWidthRatio,
        dutchHipHeightRatio: initial.dutchHipHeightRatio,
      })
      return { pitch: Math.max(MIN_PITCH, Math.min(MAX_PITCH, pitch)) }
    },
    placement: {
      position: (n) => [0, getPeakHeight(n) + HEIGHT_HANDLE_OFFSET, 0],
    },
  }
}

// Whole-segment rotation gizmo — curved two-headed arrow at the +X / +Z
// corner of the footprint, guide ring traces the corner-diagonal radius
// on hover / drag. Same pattern as the elevator / column rotate gizmo;
// roof-segment stores rotation as a scalar (radians) so the apply patch
// just writes back the new scalar.
function roofSegmentRotateHandle(): HandleDescriptor<RoofSegmentNodeType> {
  return {
    kind: 'arc-resize',
    axis: 'angular',
    shape: 'rotate',
    // Negate the cursor delta to match three.js Y-rotation handedness
    // (cursor atan2 ticks opposite-handed from `rotation-y`).
    apply: (initial, delta) => ({ rotation: (initial.rotation ?? 0) - delta }),
    placement: {
      position: (n) => {
        const halfX = n.width / 2
        const halfZ = n.depth / 2
        const yMid = Math.max(n.wallHeight, MIN_WALL_DISPLAY) / 2
        return [halfX, yMid, halfZ + ROTATE_CORNER_OFFSET]
      },
      rotationY: () => -Math.PI / 4,
    },
    decoration: {
      kind: 'ring',
      radius: (n) => Math.hypot(n.width / 2, n.depth / 2) + ROTATE_RING_OFFSET,
      y: (n) => Math.max(n.wallHeight, MIN_WALL_DISPLAY) / 2,
    },
  }
}

const roofSegmentHandles: HandleDescriptor<RoofSegmentNodeType>[] = [
  roofSegmentWidthHandle('right'),
  roofSegmentWidthHandle('left'),
  roofSegmentDepthHandle('front'),
  roofSegmentDepthHandle('back'),
  roofSegmentWallHeightHandle(),
  roofSegmentPitchHandle(),
  roofSegmentRotateHandle(),
]

/**
 * Roof segment — Stage A. Child of a roof node, owns the per-segment
 * polygon + pitch. Geometry is generated by `RoofSystem` (registered
 * under the parent roof's `def.system`), so the segment kind itself
 * only needs a renderer wrap.
 */
export const roofSegmentDefinition: NodeDefinition<typeof RoofSegmentNode> = {
  kind: 'roof-segment',
  schemaVersion: 1,
  schema: RoofSegmentNode,
  category: 'structure',
  surfaceRole: 'roof',
  // Mirrors the parent roof: a body-move resolves the no-angle `polygon`
  // snap context (grid / lines / off), so dragging a segment shows the
  // snapping chip and honours the active mode like every other structural
  // move. Resize / rotate run through their own reshaping scope.
  snapProfile: 'structural',

  defaults: () => {
    const stub = RoofSegmentNodeSchema.parse({
      id: 'roof-segment_default' as never,
      type: 'roof-segment',
    })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
  },

  // Bespoke move shared with roof / stair / stair-segment via
  // `shared/move-roof-tool` — routed through `MoveTool`'s registry-
  // affordance lookup rather than a hardcoded dispatcher arm.
  affordanceTools: {
    move: () => import('../shared/move-roof-tool'),
  },

  parametrics: roofSegmentParametrics,
  handles: roofSegmentHandles,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  floorplan: buildRoofSegmentFloorplan,
  // Body-move target. The generic Path 2 fallback writes plan coords
  // directly to `position`, which is wrong here because the segment's
  // position is roof-local. `roofSegmentMoveTarget` inverts the parent
  // roof's transform so the segment lands at the world-plan cursor.
  floorplanMoveTarget: roofSegmentMoveTarget,
  // 2D drag affordances for the side resize arrows + corner rotate
  // arrow emitted by `buildRoofSegmentFloorplan`.
  floorplanAffordances: {
    'roof-segment-resize': roofSegmentResizeAffordance,
    'roof-segment-rotate': roofSegmentRotateAffordance,
  },

  presentation: {
    label: 'Roof Segment',
    description: 'A single pitched plane of a parent roof.',
    icon: { kind: 'url', src: '/icons/roof.webp' },
    paletteSection: 'structure',
    paletteOrder: 101,
  },

  mcp: {
    description: 'A single roof segment with polygon footprint + pitch.',
  },
}
