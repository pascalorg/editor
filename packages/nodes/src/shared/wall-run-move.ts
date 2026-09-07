import type { AnyNode, GridEvent } from '@pascal-app/core'
import type { RunWallAttachment } from './distribution-run-contract'

type Point = [number, number, number]

export type WallRunMoveResult = {
  path: Point[]
  attachment: RunWallAttachment
}

/** Recompute persisted U/V coordinates after a 3D endpoint edit. */
export function refreshWallRunAttachment(
  path: readonly Point[],
  attachment: RunWallAttachment,
  wall: Extract<AnyNode, { type: 'wall' }>,
): RunWallAttachment {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dz)
  if (length < 1e-9 || path.length < 2) return attachment
  const tx = dx / length
  const tz = dz / length
  const toUV = (point: Point): [number, number] => [
    (point[0] - wall.start[0]) * tx + (point[2] - wall.start[1]) * tz,
    point[1],
  ]
  return {
    ...attachment,
    startUV: toUV(path[0]!),
    endUV: toUV(path[path.length - 1]!),
  }
}

/** Translate a wall-attached run in the wall's horizontal/vertical plane. */
export function translateWallRun(
  path: readonly Point[],
  attachment: RunWallAttachment,
  wall: Extract<AnyNode, { type: 'wall' }>,
  event: Pick<GridEvent, 'surfaceHit' | 'surfaceLocalPosition'>,
): WallRunMoveResult | null {
  if (
    event.surfaceHit?.kind !== 'wall' ||
    event.surfaceHit.hostId !== attachment.wallId ||
    event.surfaceHit.face !== 'side' ||
    !event.surfaceLocalPosition ||
    path.length === 0
  ) {
    return null
  }
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dz)
  if (length < 1e-9) return null
  const tangent: Point = [dx / length, 0, dz / length]
  const center: Point = [0, 0, 0]
  for (const point of path) {
    center[0] += point[0]
    center[1] += point[1]
    center[2] += point[2]
  }
  center[0] /= path.length
  center[1] /= path.length
  center[2] /= path.length
  const hit = event.surfaceLocalPosition
  const deltaU = (hit[0] - center[0]) * tangent[0] + (hit[2] - center[2]) * tangent[2]
  const deltaV = hit[1] - center[1]
  const movedPath = path.map(
    (point) =>
      [point[0] + tangent[0] * deltaU, point[1] + deltaV, point[2] + tangent[2] * deltaU] as Point,
  )
  return {
    path: movedPath,
    attachment: {
      ...attachment,
      startUV: [attachment.startUV[0] + deltaU, attachment.startUV[1] + deltaV],
      endUV: [attachment.endUV[0] + deltaU, attachment.endUV[1] + deltaV],
    },
  }
}
