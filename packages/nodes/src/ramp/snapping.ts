import type { AnyNodeId, BuildingNode } from '@pascal-app/core'
import {
  isAngleSnapActive,
  isGridSnapActive,
  isMagneticSnapActive,
  resolveSurfacePlanPointSnap,
} from '@pascal-app/editor'
import type { PlanPoint } from './centreline'
import { rampPlanToSite, rampSiteToPlan } from './edit'

export function snapRampPlanPoint(
  raw: PlanPoint,
  lastSite: PlanPoint | null,
  building: BuildingNode | null,
  activeLevelId: AnyNodeId | null,
  gridStep: number,
  force: boolean,
): PlanPoint {
  let point = raw
  if (!force && lastSite && isAngleSnapActive()) {
    const start = rampSiteToPlan(building, lastSite)
    const length = Math.hypot(raw[0] - start[0], raw[1] - start[1])
    const angle =
      (Math.round(Math.atan2(raw[1] - start[1], raw[0] - start[0]) / (Math.PI / 4)) * Math.PI) / 4
    point = [start[0] + Math.cos(angle) * length, start[1] + Math.sin(angle) * length]
  }
  const step = !force && isGridSnapActive() ? gridStep : 0
  const fallback: PlanPoint =
    step > 0 ? [Math.round(point[0] / step) * step, Math.round(point[1] / step) * step] : point
  const result = activeLevelId
    ? resolveSurfacePlanPointSnap({
        rawPoint: point,
        fallbackPoint: fallback,
        levelId: activeLevelId,
        magnetic: !force && isMagneticSnapActive(),
        align: !force && isMagneticSnapActive(),
      }).point
    : fallback
  return rampPlanToSite(building, result)
}
