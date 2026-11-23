import type { WallNode } from '../schema'
import { getWallFaceOffsets } from '../systems/wall/wall-frame'
import type { RoomWallFace } from './room-faces'

type Plan = [number, number]

/** What a layer is laid against: the plan corners of a fixture or a cabinet run, and the worktop of a run. */
export type DressTarget = { id: string; corners: Plan[]; worktop?: number }

/** How far a footprint's edge may stand from a face and still stand against it, metres. */
export const STANDS_AGAINST_M = 0.15

/** The slack a footprint may sink into a face before it stands behind it instead, metres. */
const SINK_M = 0.03

const millimetre = (metres: number) => Math.round(metres * 1000) / 1000

const aabbCorners = (box: { minX: number; maxX: number; minZ: number; maxZ: number }): Plan[] => [
  [box.minX, box.minZ],
  [box.maxX, box.minZ],
  [box.maxX, box.maxZ],
  [box.minX, box.maxZ],
]

/**
 * The stretch of a face a target stands against, widened by `margin` and held to the stretch the room
 * stands on, in metres along the wall; undefined when the target is not at the face. A target stands
 * against a face when its nearest corner is within `STANDS_AGAINST_M` of the face's plane on the room's
 * side. A curved face has no straight plane to measure: the caller skips it.
 */
export function standsAgainst(
  wall: WallNode,
  stretch: RoomWallFace,
  corners: readonly Plan[],
  margin: number,
): { u0: number; u1: number } | undefined {
  const length = stretch.length
  const dx = (wall.end[0] - wall.start[0]) / length
  const dz = (wall.end[1] - wall.start[1]) / length
  // Face a is on the left of start to end; both normals point into the room.
  const sign = stretch.face === 'a' ? 1 : -1
  const plane = sign * getWallFaceOffsets(wall)[stretch.face]
  const along = corners.map(([x, z]) => (x - wall.start[0]) * dx + (z - wall.start[1]) * dz)
  const into = corners.map(
    ([x, z]) => sign * (-(x - wall.start[0]) * dz + (z - wall.start[1]) * dx),
  )
  const gap = Math.min(...into) - plane
  if (gap > STANDS_AGAINST_M || gap < -SINK_M) return undefined
  const u0 = Math.max(stretch.u0, millimetre(Math.min(...along) - margin))
  const u1 = Math.min(stretch.u1, millimetre(Math.max(...along) + margin))
  return u1 - u0 > 1e-6 ? { u0, u1 } : undefined
}
