import { type AnyNode, snapSlabEdgeToWallBand, useScene } from '@pascal-app/core'
import { WALL_CONNECT_SNAP_RADIUS } from '../components/tools/wall/wall-drafting'
import useAlignmentGuides from '../store/use-alignment-guides'
import { isMagneticSnapActive } from '../store/use-editor'
import useWallSnapIndicator from '../store/use-wall-snap-indicator'
import {
  clearSurfacePlanSnapFeedback,
  getLevelWalls,
  resolveSurfacePlanPointSnap,
  SURFACE_ALIGNMENT_THRESHOLD_M,
  type SurfacePlanSnapInput,
  type SurfacePlanSnapResult,
} from './surface-plan-snap'

const SLAB_SNAP_MOVING_ID = '__slab_snap__'

export const SLAB_ALIGNMENT_THRESHOLD_M = SURFACE_ALIGNMENT_THRESHOLD_M
export type SlabPlanSnapInput = SurfacePlanSnapInput
export type SlabPlanSnapResult = SurfacePlanSnapResult

export function clearSlabSnapFeedback() {
  clearSurfacePlanSnapFeedback()
}

export function resolveSlabPlanPointSnap(input: SlabPlanSnapInput): SlabPlanSnapResult {
  return resolveSurfacePlanPointSnap({
    ...input,
    highlightWalls: input.highlightWalls ?? false,
    movingId: input.movingId ?? SLAB_SNAP_MOVING_ID,
  })
}

export type SlabEdgeBandSnapInput = {
  /** Candidate edge endpoints after the raw/grid perpendicular translation. */
  edge: [[number, number], [number, number]]
  levelId?: string | null
  nodes?: Readonly<Record<string, AnyNode>>
  /**
   * Plan point (typically the cursor) the snap beacon should hug along
   * the wall. Falls back to the snapped edge's midpoint.
   */
  referencePoint?: [number, number]
  /** Override the mode-driven magnetic gate (tests). */
  magnetic?: boolean
}

export type SlabEdgeBandSnapResult = {
  /** The candidate edge translated onto the wall centerline. */
  edge: [[number, number], [number, number]]
  wallId: string
}

/**
 * Edge-level slab reshape snap against wall footprint bands. Unlike the
 * cursor-based `resolveSlabPlanPointSnap`, this tests the DRAGGED EDGE
 * itself (band adoption, span overlap — same permissiveness as the
 * render rule) and sticks it onto the wall CENTERLINE, the canonical
 * stored position; the render rule then places it flush with the face.
 * The beacon, the live preview and the committed polygon therefore all
 * agree. In non-magnetic modes only a tight connect-radius stick
 * remains, mirroring the sanctioned wall connect snap. Publishes /
 * clears the wall-snap beacon as a side effect.
 */
export function resolveSlabEdgeBandSnap(
  input: SlabEdgeBandSnapInput,
): SlabEdgeBandSnapResult | null {
  const nodes = input.nodes ?? useScene.getState().nodes
  const walls = getLevelWalls(nodes, input.levelId)
  const magnetic = input.magnetic ?? isMagneticSnapActive()

  const snap = snapSlabEdgeToWallBand(
    input.edge[0],
    input.edge[1],
    walls,
    magnetic ? undefined : { maxLateral: WALL_CONNECT_SNAP_RADIUS },
  )
  if (!snap) {
    useWallSnapIndicator.getState().clear()
    useAlignmentGuides.getState().clear()
    return null
  }

  const [a, b] = snap.edge
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const lengthSquared = dx * dx + dz * dz
  let beacon: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  if (input.referencePoint && lengthSquared > 1e-12) {
    const t = Math.max(
      0,
      Math.min(
        1,
        ((input.referencePoint[0] - a[0]) * dx + (input.referencePoint[1] - a[1]) * dz) /
          lengthSquared,
      ),
    )
    beacon = [a[0] + dx * t, a[1] + dz * t]
  }
  useWallSnapIndicator.getState().set({
    x: beacon[0],
    z: beacon[1],
    kind: 'wall',
    wallIds: [snap.wallId],
  })
  useAlignmentGuides.getState().clear()

  return { edge: snap.edge, wallId: snap.wallId }
}
