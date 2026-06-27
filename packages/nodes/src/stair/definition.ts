import {
  type HandleDescriptor,
  type NodeDefinition,
  type SceneApi,
  StairNode as StairNodeSchema,
  type StairNode as StairNodeType,
  type StairSegmentNode,
  stairFootprintAABB,
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
// Whole-stair rotation gizmo — curved two-headed arrow at a corner of
// the footprint. Same pattern as elevator / column / shelf / roof-segment.
const STAIR_ROTATE_CORNER_OFFSET = 0.4
const STAIR_ROTATE_RING_OFFSET = 0.08
const STAIR_MOVE_FRONT_OFFSET = 0.35

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

type StairMoveBounds = {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  height: number
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

function rotateLocalXZ(x: number, z: number, angle: number): [number, number] {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [x * cos + z * sin, -x * sin + z * cos]
}

function fallbackStraightStairMoveBounds(node: StairNodeType): StairMoveBounds {
  const width = Math.max(node.width ?? 1, MIN_CURVED_WIDTH)
  const depth = Math.max(width, 1)
  return {
    minX: -width / 2,
    maxX: width / 2,
    minZ: 0,
    maxZ: depth,
    height: Math.max(node.totalRise ?? 2.5, 0.1),
  }
}

function readStraightStairMoveBounds(node: StairNodeType, sceneApi: SceneApi): StairMoveBounds {
  const segments = (node.children ?? [])
    .map((childId) => sceneApi.get<StairSegmentNode>(childId as never))
    .filter((child): child is StairSegmentNode => child?.type === 'stair-segment')

  if (segments.length === 0) return fallbackStraightStairMoveBounds(node)

  const transforms = computeStairSegmentFloorStackTransforms(segments)
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  let height = 0

  segments.forEach((segment, index) => {
    const transform = transforms[index]
    if (!transform) return
    const halfWidth = segment.width / 2
    const corners = [
      [-halfWidth, 0],
      [halfWidth, 0],
      [-halfWidth, segment.length],
      [halfWidth, segment.length],
    ] as const
    for (const [x, z] of corners) {
      const [rx, rz] = rotateLocalXZ(x, z, transform.rotation)
      minX = Math.min(minX, transform.position[0] + rx)
      maxX = Math.max(maxX, transform.position[0] + rx)
      minZ = Math.min(minZ, transform.position[2] + rz)
      maxZ = Math.max(maxZ, transform.position[2] + rz)
    }
    height = Math.max(
      height,
      transform.position[1] + Math.max(segment.height, segment.thickness, 0.01),
    )
  })

  if (![minX, maxX, minZ, maxZ].every(Number.isFinite)) {
    return fallbackStraightStairMoveBounds(node)
  }
  return { minX, maxX, minZ, maxZ, height: Math.max(height, 0.1) }
}

function readStairMoveBounds(node: StairNodeType, sceneApi: SceneApi): StairMoveBounds {
  if (!isCurvedOrSpiral(node)) return readStraightStairMoveBounds(node, sceneApi)
  const g = readCurvedStairGeometry(node)
  return {
    minX: -g.outerRadius,
    maxX: g.outerRadius,
    minZ: -g.outerRadius,
    maxZ: g.outerRadius,
    height: g.totalRise,
  }
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

// Whole-stair rotation gizmo. Lives on the stair parent so it rotates
// straight + curved + spiral kinds the same way. For straight stairs the
// gizmo anchors just outside the +X corner of the run start (the stair's
// root sits at the bottom of the first segment, with the chain extending
// along +Z). For curved / spiral the gizmo sits at the outer rim, at the
// sweep-start side, where there's no other handle in the way. apply()
// negates the cursor delta so dragging CCW (atan2 ticks +) rotates the
// stair CCW around Y — same convention as elevator / column.
function stairRotateGizmoPosition(n: StairNodeType): [number, number, number] {
  if (isCurvedOrSpiral(n)) {
    const g = readCurvedStairGeometry(n)
    const radius = g.outerRadius + STAIR_ROTATE_CORNER_OFFSET
    // Sweep-start side in node-local frame. Sector is centred on
    // local +X (sweep bisector = 0), so start = -sweep/2.
    const angle = -g.sweepAngle / 2
    return [radius * Math.cos(angle), g.totalRise / 2, radius * Math.sin(angle)]
  }
  const width = Math.max(n.width ?? 1, MIN_CURVED_WIDTH)
  const yMid = Math.max(n.totalRise ?? 2.5, 0.1) / 2
  return [width / 2 + STAIR_ROTATE_CORNER_OFFSET, yMid, -STAIR_ROTATE_CORNER_OFFSET]
}

function stairRotateHandle(): HandleDescriptor<StairNodeType> {
  return {
    kind: 'arc-resize',
    axis: 'angular',
    shape: 'rotate',
    apply: (initial, delta) => ({ rotation: (initial.rotation ?? 0) - delta }),
    placement: {
      position: stairRotateGizmoPosition,
      // The curved-arrow geometry's bow points along its local +X. Rotate
      // the icon so the bow points radially outward — away from the
      // stair's center — so the curve hugs the body's outline at the
      // gizmo's corner instead of cutting into it. rotateY(−α) maps local
      // +X to the outward radial direction (same handedness rule as
      // elevator / column, but here the gizmo lands in different
      // quadrants per stair kind so the tilt is position-derived rather
      // than a fixed −π/4).
      rotationY: (n) => {
        const [px, , pz] = stairRotateGizmoPosition(n)
        return -Math.atan2(pz, px)
      },
    },
    decoration: {
      kind: 'ring',
      radius: (n) => {
        if (isCurvedOrSpiral(n)) {
          const g = readCurvedStairGeometry(n)
          return g.outerRadius + STAIR_ROTATE_CORNER_OFFSET + STAIR_ROTATE_RING_OFFSET
        }
        const width = Math.max(n.width ?? 1, MIN_CURVED_WIDTH)
        return (
          Math.hypot(width / 2 + STAIR_ROTATE_CORNER_OFFSET, STAIR_ROTATE_CORNER_OFFSET) +
          STAIR_ROTATE_RING_OFFSET
        )
      },
      y: (n) => Math.max(n.totalRise ?? 2.5, 0.1) / 2,
    },
  }
}

function stairMoveHandle(): HandleDescriptor<StairNodeType> {
  return {
    // Tap-to-engage: hand the stair to its `MoveRoofTool` (same path the
    // floating action menu's Move button takes via `setMovingNode`) so the
    // 3D grip and the floating-UI button share one move flow — green
    // bounding box, alignment guides, R/T rotation, click-to-commit.
    kind: 'tap-action',
    shape: 'move-cross',
    cursor: 'move',
    onActivate: (node, _scene, editor) => editor.engageMove(node),
    placement: {
      // Low to the floor at the front edge (matches the item move grip) so it
      // reads as a floor-move grip and stays clear of the body resize / rotate
      // handles that sit at mid-height.
      position: (n, sceneApi) => {
        const bounds = readStairMoveBounds(n, sceneApi)
        return [(bounds.minX + bounds.maxX) / 2, 0.02, bounds.maxZ + STAIR_MOVE_FRONT_OFFSET]
      },
    },
  }
}

function stairHandles(node: StairNodeType): HandleDescriptor<StairNodeType>[] {
  // Straight stairs have no parent-level shape arrows — the segment
  // children each render their own (width / length / height). Curved +
  // spiral stairs use 5 arrows directly on the parent (no segments).
  // The whole-stair rotation gizmo is universal: every stair kind
  // exposes the same curved-arrow rotate handle.
  const handles: HandleDescriptor<StairNodeType>[] = []
  if (isCurvedOrSpiral(node)) {
    handles.push(
      curvedRiseHandle(),
      curvedWidthHandle(),
      curvedInnerRadiusHandle(),
      curvedSweepHandle('start'),
      curvedSweepHandle('end'),
    )
  }
  handles.push(stairRotateHandle(), stairMoveHandle())
  return handles
}

import {
  computeStairSegmentFloorStackTransforms,
  getStairFloorPlacedFootprints,
} from './floor-stack'
import { buildStairFloorplan } from './floorplan'
import {
  curvedStairInnerRadiusAffordance,
  curvedStairSweepAffordance,
  curvedStairWidthAffordance,
  segmentLengthAffordance,
  segmentWidthAffordance,
  stairRotateAffordance,
} from './floorplan-affordances'
import { stairFloorplanMoveTarget } from './floorplan-move'
import { stairPaint } from './paint'
import { stairParametrics } from './parametrics'
import { StairNode } from './schema'
import { stairSlots } from './slots'

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
  snapProfile: 'structural',
  // A footprint with a clear front: you approach a stair from the low end,
  // which sits on the -Z side of the run (the run ascends along +Z). Show the
  // floor facing triangle there, pointing out of the entry, while placing/moving.
  facingIndicator: { reversed: true },
  // Placed as a footprint (R/T rotates), not a directional draw → no angle-lock
  // mode. The toolHints presence routes it through the contextual HUD so the
  // snapping chip shows during placement.
  snapDraftDirectional: false,
  toolHints: [
    { key: 'Left click', label: 'Place stairs' },
    { key: 'R / T', label: 'Rotate' },
    { key: 'Esc', label: 'Cancel' },
  ],
  surfaceRole: 'joinery',

  defaults: () => {
    const stub = StairNodeSchema.parse({ id: 'stair_default' as never, type: 'stair' })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    // A stair has no centred box footprint: straight = a cumulative
    // `stair-segment` chain, curved / spiral = an annular sector. Hand the
    // alignment bridge the resolved plan `aabb` directly (not a `box`) — the
    // moving-anchor helper can relocate the same shape when a stair is being
    // placed or dragged.
    alignmentFootprint: (node, nodes) => {
      const aabb = stairFootprintAABB(node as StairNodeType, nodes)
      return aabb ? { shape: 'aabb', ...aabb } : null
    },
    duplicable: true,
    deletable: true,
    floorPlaced: {
      footprints: (node, ctx) =>
        ctx ? getStairFloorPlacedFootprints(node as StairNodeType, ctx.nodes) : [],
    },
    slots: (node) => stairSlots(node as StairNodeType),
    paint: stairPaint,
  },

  // Bespoke move shared with roof / roof-segment / stair-segment via
  // `shared/move-roof-tool` — routed through `MoveTool`'s registry-
  // affordance lookup rather than a hardcoded dispatcher arm.
  affordanceTools: {
    move: () => import('../shared/move-roof-tool'),
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
    'stair-rotate': stairRotateAffordance,
  },

  presentation: {
    label: 'Stair',
    description:
      'A stair composed of one or more flights with configurable treads, risers, railings.',
    icon: { kind: 'url', src: '/icons/stairs.webp' },
    paletteSection: 'structure',
    paletteOrder: 110,
  },

  mcp: {
    description: 'A multi-flight stair with segmented geometry.',
  },
}
