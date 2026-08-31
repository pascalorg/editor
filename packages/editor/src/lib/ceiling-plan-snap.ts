import {
  clearSurfacePlanSnapFeedback,
  resolveSurfacePlanPointSnap,
  SURFACE_ALIGNMENT_THRESHOLD_M,
  type SurfacePlanSnapInput,
  type SurfacePlanSnapResult,
} from './surface-plan-snap'

const CEILING_SNAP_MOVING_ID = '__ceiling_snap__'

export const CEILING_ALIGNMENT_THRESHOLD_M = SURFACE_ALIGNMENT_THRESHOLD_M
export type CeilingPlanSnapInput = SurfacePlanSnapInput
export type CeilingPlanSnapResult = SurfacePlanSnapResult

export function clearCeilingSnapFeedback() {
  clearSurfacePlanSnapFeedback()
}

export function resolveCeilingPlanPointSnap(input: CeilingPlanSnapInput): CeilingPlanSnapResult {
  return resolveSurfacePlanPointSnap({
    ...input,
    movingId: input.movingId ?? CEILING_SNAP_MOVING_ID,
  })
}
