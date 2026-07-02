import { getWallThickness } from '@pascal-app/core'
import type { WallHit } from '../shared/wall-attach-target'
import { projectWallLocalPointToPlan } from '../shared/wall-attach-target'

export type CabinetWallSnapPlacement = {
  position: [number, number, number]
  yaw: number
  localX: number
  side: WallHit['side']
}

function snap(value: number, step: number): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

export function resolveCabinetWallSnapPlacement({
  depth,
  gridStep = 0,
  hit,
  width,
}: {
  depth: number
  gridStep?: number
  hit: WallHit
  width: number
}): CabinetWallSnapPlacement | null {
  if (hit.wallLength <= 1e-6) return null

  const halfWidth = width / 2
  const snappedLocalX = snap(hit.localX, gridStep)
  const localX =
    hit.wallLength > width
      ? Math.min(hit.wallLength - halfWidth, Math.max(halfWidth, snappedLocalX))
      : hit.wallLength / 2
  const centerline = projectWallLocalPointToPlan(hit.wall, localX)
  const frontNormal = [-hit.dirY, hit.dirX] as const
  const normalScale = hit.side === 'front' ? 1 : -1
  const normal = [frontNormal[0] * normalScale, frontNormal[1] * normalScale] as const
  const cabinetCenterOffset = getWallThickness(hit.wall) / 2 + depth / 2

  return {
    position: [
      centerline[0] + normal[0] * cabinetCenterOffset,
      0,
      centerline[1] + normal[1] * cabinetCenterOffset,
    ],
    yaw: Math.atan2(normal[0], normal[1]),
    localX,
    side: hit.side,
  }
}
