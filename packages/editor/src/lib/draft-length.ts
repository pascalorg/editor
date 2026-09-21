import type { WallPlanPoint } from '@pascal-app/core'

export function constrainDraftPointToLength(
  start: WallPlanPoint,
  point: WallPlanPoint,
  length: number | null,
): WallPlanPoint {
  const dx = point[0] - start[0]
  const dz = point[1] - start[1]
  const distance = Math.hypot(dx, dz)
  if (length === null || distance < 1e-8) return point
  return [start[0] + (dx * length) / distance, start[1] + (dz * length) / distance]
}
