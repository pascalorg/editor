import {
  getActiveRoofHeight,
  getPitchFromActiveRoofHeight,
  type HandleDescriptor,
  type NodeDefinition,
  type RoofSegmentNode as RoofSegmentNodeType,
  RoofSegmentNode as RoofSegmentNodeSchema,
} from '@pascal-app/core'
import { buildRoofSegmentFloorplan } from './floorplan'
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

// Width arrow — anchor='center' so dragging the +X side grows the full
// footprint symmetrically (both edges move ±delta). Same idiom as the
// elevator / column / shelf width arrow.
function roofSegmentWidthHandle(): HandleDescriptor<RoofSegmentNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'x',
    anchor: 'center',
    min: MIN_ROOF_DIM,
    currentValue: (n) => n.width,
    apply: (_n, newValue) => ({ width: newValue }),
    placement: {
      position: (n) => [
        n.width / 2 + SIDE_HANDLE_OFFSET,
        Math.max(n.wallHeight, MIN_WALL_DISPLAY) / 2,
        0,
      ],
    },
  }
}

// Depth arrow — symmetric on the +Z side.
function roofSegmentDepthHandle(): HandleDescriptor<RoofSegmentNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'z',
    anchor: 'center',
    min: MIN_ROOF_DIM,
    currentValue: (n) => n.depth,
    apply: (_n, newValue) => ({ depth: newValue }),
    placement: {
      position: (n) => [
        0,
        Math.max(n.wallHeight, MIN_WALL_DISPLAY) / 2,
        n.depth / 2 + SIDE_HANDLE_OFFSET,
      ],
    },
  }
}

// Wall-height arrow — `anchor: 'min'` keeps the base on the floor and
// grows the wall upward. Placed on the -X side at the wall's top edge
// so it doesn't stack on the centered pitch arrow when wallHeight ≈ 0
// (flat roof / no walls).
function roofSegmentWallHeightHandle(): HandleDescriptor<RoofSegmentNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min',
    min: MIN_WALL_HEIGHT,
    currentValue: (n) => n.wallHeight,
    apply: (_n, newValue) => ({ wallHeight: newValue }),
    placement: {
      position: (n) => [
        -(n.width / 2 + SIDE_HANDLE_OFFSET),
        Math.max(n.wallHeight, MIN_WALL_DISPLAY),
        0,
      ],
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
  roofSegmentWidthHandle(),
  roofSegmentDepthHandle(),
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
    duplicable: false,
    deletable: true,
  },

  parametrics: roofSegmentParametrics,
  handles: roofSegmentHandles,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  floorplan: buildRoofSegmentFloorplan,

  presentation: {
    label: 'Roof Segment',
    description: 'A single pitched plane of a parent roof.',
    icon: { kind: 'url', src: '/icons/roof.png' },
    paletteSection: 'structure',
    paletteOrder: 101,
  },

  mcp: {
    description: 'A single roof segment with polygon footprint + pitch.',
  },
}
