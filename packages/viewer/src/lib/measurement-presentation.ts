export const MEASUREMENT_ACTIVE_COLOR = '#6366f1'
export const MEASUREMENT_DANGLING_COLOR = '#dc2626'

export const MEASUREMENT_PERSISTENT_COLOR = '#111827'

export function measurementPresentationColor(dangling: boolean, active: boolean): string {
  if (dangling) return MEASUREMENT_DANGLING_COLOR
  return active ? MEASUREMENT_ACTIVE_COLOR : MEASUREMENT_PERSISTENT_COLOR
}

export const MEASUREMENT_FLOORPLAN_COLOR = '#4f46e5'

export function measurementFloorplanPresentationColor(dangling: boolean, active: boolean): string {
  if (dangling) return MEASUREMENT_DANGLING_COLOR
  return active ? MEASUREMENT_ACTIVE_COLOR : MEASUREMENT_FLOORPLAN_COLOR
}
