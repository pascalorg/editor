import {
  clearSurfacePlanSnapFeedback,
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
