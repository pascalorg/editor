import {
  type HandleDescriptor,
  type NodeDefinition,
  type StairNode as StairNodeType,
  StairNode as StairNodeSchema,
} from '@pascal-app/core'

const MIN_CURVED_RISE = 0.3
const MIN_CURVED_WIDTH = 0.4
const MIN_CURVED_INNER_RADIUS_SPIRAL = 0.05
const MIN_CURVED_INNER_RADIUS_CURVED = 0.2
const MIN_CURVED_SWEEP = Math.PI / 12
const MAX_CURVED_SWEEP = Math.PI * 2 - 0.05
const CURVED_RISE_OFFSET = 0.35
const CURVED_WIDTH_HANDLE_OFFSET = 0.5
const CURVED_RADIAL_OFFSET = 0.16
const CURVED_SWEEP_RADIAL_OFFSET = 0.3
const CURVED_SWEEP_LATERAL_OFFSET = 0.24
// Guide rings — outer hugs just outside the rim, inner sits inside the
// pillar. Clamp inner so a tiny innerRadius (spiral default 0.05) doesn't
// push the ring through the axis.
const CURVED_OUTER_RING_OFFSET = 0.2
const CURVED_INNER_RING_OFFSET = 0.2
const CURVED_INNER_RING_MIN = 0.05

type CurvedStairGeom = {
  isSpiral: boolean
  stepCount: number
  totalRise: number
  innerRadius: number
  outerRadius: number
  width: number
  sweepAngle: number
  stepSweep: number
  midRadius: number
  topAngle: number
  minInnerRadius: number
}

function readCurvedStairGeometry(node: StairNodeType): CurvedStairGeom {
  const isSpiral = node.stairType === 'spiral'
  const stepCount = Math.max(2, Math.round(node.stepCount ?? 10))
  const totalRise = Math.max(node.totalRise ?? 2.5, 0.1)
  const width = Math.max(node.width ?? 1, MIN_CURVED_WIDTH)
  const minInnerRadius = isSpiral ? MIN_CURVED_INNER_RADIUS_SPIRAL : MIN_CURVED_INNER_RADIUS_CURVED
  const innerRadius = Math.max(minInnerRadius, node.innerRadius ?? 0.9)
  const outerRadius = innerRadius + width
  const sweepAngle = node.sweepAngle ?? (isSpiral ? Math.PI * 2 : Math.PI / 2)
  const stepSweep = sweepAngle / stepCount
  return {
    isSpiral,
    stepCount,
    totalRise,
    innerRadius,
    outerRadius,
    width,
    sweepAngle,
    stepSweep,
    midRadius: (innerRadius + outerRadius) / 2,
    topAngle: sweepAngle / 2 - stepSweep / 2,
    minInnerRadius,
  }
}

function isCurvedOrSpiral(node: StairNodeType): boolean {
  return node.stairType === 'curved' || node.stairType === 'spiral'
}

function curvedRiseHandle(): HandleDescriptor<StairNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min',
    min: MIN_CURVED_RISE,
    currentValue: (n) => Math.max(n.totalRise ?? 2.5, 0.1),
    apply: (_n, newRise) => ({ totalRise: newRise }),
    placement: {
      position: (n) => {
        const g = readCurvedStairGeometry(n)
        // Spiral: over the central pillar. Curved: above the upper step's
        // midline so the arrow sits where users read "top of the run".
        const x = g.isSpiral ? 0 : g.midRadius * Math.cos(g.topAngle)
        const z = g.isSpiral ? 0 : g.midRadius * Math.sin(g.topAngle)
        return [x, g.totalRise + CURVED_RISE_OFFSET, z]
      },
    },
  }
}

function curvedWidthHandle(): HandleDescriptor<StairNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'x',
    anchor: 'min',
    min: MIN_CURVED_WIDTH,
    currentValue: (n) => Math.max(n.width ?? 1, MIN_CURVED_WIDTH),
    apply: (_n, newWidth) => ({ width: newWidth }),
    placement: {
      position: (n) => {
        const g = readCurvedStairGeometry(n)
        return [g.outerRadius + CURVED_WIDTH_HANDLE_OFFSET, g.totalRise / 2, 0]
      },
    },
    // Outer guide ring — traces the rim while the user interacts with the
    // width arrow so it's obvious which edge the drag affects.
    decoration: {
      kind: 'ring',
      radius: (n) => readCurvedStairGeometry(n).outerRadius + CURVED_OUTER_RING_OFFSET,
      y: (n) => readCurvedStairGeometry(n).totalRise / 2,
    },
  }
}

function curvedInnerRadiusHandle(): HandleDescriptor<StairNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'x',
    anchor: 'min',
    min: (n) =>
      n.stairType === 'spiral' ? MIN_CURVED_INNER_RADIUS_SPIRAL : MIN_CURVED_INNER_RADIUS_CURVED,
    currentValue: (n) => {
      const minIR =
        n.stairType === 'spiral' ? MIN_CURVED_INNER_RADIUS_SPIRAL : MIN_CURVED_INNER_RADIUS_CURVED
      return Math.max(minIR, n.innerRadius ?? 0.9)
    },
    // Adjusting innerRadius alone would also push outerRadius outward,
    // visually moving the outside of the stair. Compensate by reducing
    // width by the same amount so the outer rim stays put.
    apply: (initial, newInner) => {
      const g = readCurvedStairGeometry(initial)
      const delta = newInner - g.innerRadius
      return {
        innerRadius: newInner,
        width: Math.max(MIN_CURVED_WIDTH, g.width - delta),
      }
    },
    placement: {
      position: (n) => {
        const g = readCurvedStairGeometry(n)
        return [g.innerRadius - CURVED_RADIAL_OFFSET, g.totalRise / 2, 0]
      },
      rotationY: () => Math.PI,
    },
    // Inner guide ring — traces the central pillar. Clamped so a tiny
    // innerRadius doesn't pull the ring through the axis.
    decoration: {
      kind: 'ring',
      radius: (n) => {
        const g = readCurvedStairGeometry(n)
        return Math.max(g.innerRadius - CURVED_INNER_RING_OFFSET, CURVED_INNER_RING_MIN)
      },
      y: (n) => readCurvedStairGeometry(n).totalRise / 2,
    },
  }
}

function curvedSweepHandle(end: 'start' | 'end'): HandleDescriptor<StairNodeType> {
  return {
    kind: 'arc-resize',
    axis: 'angular',
    end,
    apply: (initial, delta) => {
      const initialSweep = initial.sweepAngle ?? Math.PI / 2
      const initialRotation = (initial.rotation as number) ?? 0
      const sweepSign = Math.sign(initialSweep) || 1
      // END handle: cursor angle delta IS the sweep delta.
      // START handle: cursor angle delta is the negation of the sweep delta.
      const sweepDelta = end === 'end' ? delta : -delta
      const targetSweep = initialSweep + sweepDelta
      const clampedAbs = Math.min(
        MAX_CURVED_SWEEP,
        Math.max(MIN_CURVED_SWEEP, Math.abs(targetSweep)),
      )
      const newSweep = sweepSign * clampedAbs
      const appliedDelta = newSweep - initialSweep
      // Re-orient the stair so the OPPOSITE edge stays world-fixed:
      //   END  fixed-start: ΔR = −ΔS / 2
      //   START fixed-end : ΔR = +ΔS / 2
      const rotationShift = end === 'end' ? -appliedDelta / 2 : appliedDelta / 2
      return {
        sweepAngle: newSweep,
        rotation: initialRotation + rotationShift,
      }
    },
    placement: {
      position: (n) => {
        const g = readCurvedStairGeometry(n)
        const sweepSign = Math.sign(g.sweepAngle) || 1
        const z =
          end === 'end'
            ? sweepSign * CURVED_SWEEP_LATERAL_OFFSET
            : -sweepSign * CURVED_SWEEP_LATERAL_OFFSET
        return [g.outerRadius + CURVED_SWEEP_RADIAL_OFFSET, g.totalRise / 2, z]
      },
      rotationY: (n) => {
        const sweepSign = Math.sign(n.sweepAngle ?? Math.PI / 2) || 1
        return end === 'end' ? -sweepSign * (Math.PI / 2) : sweepSign * (Math.PI / 2)
      },
    },
  }
}

function stairHandles(node: StairNodeType): HandleDescriptor<StairNodeType>[] {
  // Straight stairs have no parent-level arrows — the segment children
  // each render their own (width / length / height). Curved + spiral
  // stairs use 5 arrows directly on the parent (no segments).
  if (!isCurvedOrSpiral(node)) return []
  return [
    curvedRiseHandle(),
    curvedWidthHandle(),
    curvedInnerRadiusHandle(),
    curvedSweepHandle('start'),
    curvedSweepHandle('end'),
  ]
}
import {
  curvedStairInnerRadiusAffordance,
  curvedStairSweepAffordance,
  curvedStairWidthAffordance,
  segmentLengthAffordance,
  segmentWidthAffordance,
} from './floorplan-affordances'
import { buildStairFloorplan } from './floorplan'
import { stairFloorplanMoveTarget } from './floorplan-move'
import { stairParametrics } from './parametrics'
import { StairNode } from './schema'

/**
 * Stair — Stage A. Composite node like roof: owns overall framing,
 * `stair-segment` children own per-flight geometry. Wrap-exports the
 * legacy `StairRenderer` + `StairSystem`.
 */
export const stairDefinition: NodeDefinition<typeof StairNode> = {
  kind: 'stair',
  schemaVersion: 1,
  schema: StairNode,
  category: 'structure',
  surfaceRole: 'joinery',

  defaults: () => {
    const stub = StairNodeSchema.parse({ id: 'stair_default' as never, type: 'stair' })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
  },

  parametrics: stairParametrics,
  handles: stairHandles,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  system: {
    module: () => import('./system'),
    priority: 3,
  },
  // Stage C — stair is the parent; it walks its `stair-segment` children
  // via `ctx.children` and emits the whole stack as one registry entry.
  // Each flight's transform depends on every prior sibling's
  // `length` / `height` / `attachmentSide`, so individual segments can't
  // compute their own polygon in isolation. See
  // `nodes/src/stair/floorplan.ts` for the emitter.
  floorplan: buildStairFloorplan,
  floorplanMoveTarget: stairFloorplanMoveTarget,

  // 2D drag affordances mirror the 3D in-world arrows on selected stairs:
  //   - `segment-width` / `segment-length` drive per-segment side & length
  //     arrows on straight stairs (sister to `StairSegmentSideArrow` /
  //     `StairSegmentLengthArrow` in stair-segment-handles.tsx).
  //   - `curved-width` / `curved-inner-radius` / `curved-sweep` drive the
  //     parent-stair arrows for curved & spiral kinds (sister to
  //     `CurvedStairWidthArrow` / `CurvedStairInnerRadiusArrow` /
  //     `CurvedStairSweepArrow`).
  // Height / rise arrows from the 3D set don't translate — no vertical axis
  // in the plan view.
  floorplanAffordances: {
    'segment-width': segmentWidthAffordance,
    'segment-length': segmentLengthAffordance,
    'curved-width': curvedStairWidthAffordance,
    'curved-inner-radius': curvedStairInnerRadiusAffordance,
    'curved-sweep': curvedStairSweepAffordance,
  },

  presentation: {
    label: 'Stair',
    description:
      'A stair composed of one or more flights with configurable treads, risers, railings.',
    icon: { kind: 'url', src: '/icons/stairs.png' },
    paletteSection: 'structure',
    paletteOrder: 110,
  },

  mcp: {
    description: 'A multi-flight stair with segmented geometry.',
  },
}
