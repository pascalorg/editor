import {
  type HandleDescriptor,
  type NodeDefinition,
  StairSegmentNode as StairSegmentNodeSchema,
  type StairSegmentNode as StairSegmentNodeType,
} from '@pascal-app/core'
import { stairSegmentParametrics } from './parametrics'
import { StairSegmentNode } from './schema'

const SIDE_HANDLE_OFFSET = 0.24
const LENGTH_HANDLE_OFFSET = 0.24
const HEIGHT_HANDLE_OFFSET = 0.24
const MIN_SEGMENT_WIDTH = 0.4
const MIN_SEGMENT_LENGTH = 0.4
const MIN_SEGMENT_HEIGHT = 0.1

// Width grows symmetrically around the chain centerline — the chain owns
// segment.position so writing a new center here would be clobbered next
// frame by `syncSegmentMeshTransforms`. We just write `width` and let the
// chain re-center.
function stairSegmentWidthHandle(side: 'left' | 'right'): HandleDescriptor<StairSegmentNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'x',
    // 'min' factor=+1 / 'max' factor=-1 lets each arrow grow the value
    // when dragged outward (right edge: drag +X grows; left edge: drag -X
    // grows). Matches the legacy `widthDelta = sign * pointerDelta`.
    anchor: side === 'right' ? 'min' : 'max',
    min: MIN_SEGMENT_WIDTH,
    currentValue: (n) => n.width,
    apply: (_n, newValue) => ({ width: newValue }),
    placement: {
      position: (n) => [
        (side === 'right' ? 1 : -1) * (n.width / 2 + SIDE_HANDLE_OFFSET),
        n.height / 2,
        n.length / 2,
      ],
      rotationY: () => (side === 'right' ? 0 : Math.PI),
    },
    portal: 'grandparent',
  }
}

// Length: segment's back-face (Z = length) anchors against the chain end,
// so the run simply extends toward +Z as length grows. anchor='min' →
// drag +Z grows length 1:1.
//
// `rotationY` is intentionally omitted. The generic linear-arrow renderer
// already auto-rotates `axis: 'z'` chevrons by `-π/2` so the local +X tip
// faces +Z (see `axisRotationY` in `node-arrow-handles.tsx`). Adding our
// own `-π/2` here stacks to `-π`, which spins the tip to `-X` and the
// chevron reads as sideways across the front edge instead of pointing
// forward off the run. Shelf / roof-segment depth handles match this —
// neither sets `rotationY` for their `axis: 'z'` arrow.
function stairSegmentLengthHandle(): HandleDescriptor<StairSegmentNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'z',
    anchor: 'min',
    min: MIN_SEGMENT_LENGTH,
    currentValue: (n) => n.length,
    apply: (_n, newValue) => ({ length: newValue }),
    placement: {
      position: (n) => [0, n.height / 2, n.length + LENGTH_HANDLE_OFFSET],
    },
    portal: 'grandparent',
  }
}

// Height applies only to step-flight segments (landings are flat). The
// segment's floor is at Y=0; dragging the top grows height upward.
function stairSegmentHeightHandle(): HandleDescriptor<StairSegmentNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min',
    min: MIN_SEGMENT_HEIGHT,
    currentValue: (n) => n.height,
    apply: (_n, newValue) => ({ height: newValue }),
    placement: {
      position: (n) => [0, n.height + HEIGHT_HANDLE_OFFSET, n.length / 2],
    },
    portal: 'grandparent',
  }
}

function stairSegmentHandles(node: StairSegmentNodeType): HandleDescriptor<StairSegmentNodeType>[] {
  const handles: HandleDescriptor<StairSegmentNodeType>[] = [
    stairSegmentWidthHandle('left'),
    stairSegmentWidthHandle('right'),
    stairSegmentLengthHandle(),
  ]
  if (node.segmentType === 'stair') {
    handles.push(stairSegmentHeightHandle())
  }
  return handles
}

/**
 * Stair segment — Stage A. Child of a stair node; per-flight geometry.
 * Built by `StairSystem` registered on the parent stair definition.
 */
export const stairSegmentDefinition: NodeDefinition<typeof StairSegmentNode> = {
  kind: 'stair-segment',
  schemaVersion: 1,
  schema: StairSegmentNode,
  category: 'structure',
  surfaceRole: 'joinery',

  defaults: () => {
    const stub = StairSegmentNodeSchema.parse({
      id: 'stair-segment_default' as never,
      type: 'stair-segment',
    })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: false,
    deletable: true,
  },

  // Bespoke move shared with roof / roof-segment / stair via
  // `shared/move-roof-tool` — routed through `MoveTool`'s registry-
  // affordance lookup rather than a hardcoded dispatcher arm.
  affordanceTools: {
    move: () => import('../shared/move-roof-tool'),
  },

  parametrics: stairSegmentParametrics,
  handles: stairSegmentHandles,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  presentation: {
    label: 'Stair Segment',
    description: 'A single flight of a parent stair.',
    icon: { kind: 'url', src: '/icons/stairs.webp' },
    paletteSection: 'structure',
    paletteOrder: 111,
  },

  mcp: {
    description: 'A single stair flight with run + rise + tread parameters.',
  },
}
