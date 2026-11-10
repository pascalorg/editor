import { MEASUREMENT_ACTIVE_COLOR, MEASUREMENT_DANGLING_COLOR } from '@pascal-app/viewer'

export const MEASUREMENT_FLOORPLAN_COLOR = '#4f46e5'

export function measurementFloorplanPresentationColor(dangling: boolean, active: boolean): string {
  if (dangling) return MEASUREMENT_DANGLING_COLOR
  return active ? MEASUREMENT_ACTIVE_COLOR : MEASUREMENT_FLOORPLAN_COLOR
}
