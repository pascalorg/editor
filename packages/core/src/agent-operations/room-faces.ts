import type { WallFace, WallNode, ZoneNode } from '../schema'
import { isCurvedWall } from '../systems/wall/wall-curve'
import { getWallZoneSpans } from '../systems/wall/wall-finish'
import type { SceneNodes } from './types'

/**
 * A stretch of one face of one wall that a room stands on: the unit every room-level wall write
 * and read works in. `u0..u1` are metres from the wall's start along its reference line (along the
 * chord for a curved wall), the coordinates a face's paint regions use; `whole` is a stretch that
 * runs the face's full length, so a region over it can leave `u` unbounded and follow the wall when
 * it is lengthened.
 */
export type RoomWallFace = {
  wallId: string
  face: WallFace
  t0: number
  t1: number
  u0: number
  u1: number
  /** The wall's reference length (its chord), metres. */
  length: number
  whole: boolean
  curved: boolean
}

const WHOLE = 1e-3

/** The walls that bound a room and carry a finish: its boundary walls, curtain walls left out. */
export function roomBoundaryWalls(nodes: SceneNodes, zone: ZoneNode): WallNode[] {
  return (zone.boundaryWallIds ?? [])
    .map((id) => nodes[id])
    .filter((wall): wall is WallNode => wall?.type === 'wall' && wall.wallType !== 'curtain')
}

/**
 * The faces that look into a room, a stretch each, in the order of the room's boundary walls: for a
 * partition the face of this room and not the other's, for a wall that runs on past the room only the
 * stretch the room stands on.
 */
export function roomWallFaces(nodes: SceneNodes, zone: ZoneNode): RoomWallFace[] {
  return roomBoundaryWalls(nodes, zone).flatMap((wall) => {
    const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
    const curved = isCurvedWall(wall)
    return getWallZoneSpans(wall, [zone]).map((span) => ({
      wallId: wall.id,
      face: span.face,
      t0: span.t0,
      t1: span.t1,
      u0: span.t0 * length,
      u1: span.t1 * length,
      length,
      whole: span.t0 < WHOLE && span.t1 > 1 - WHOLE,
      curved,
    }))
  })
}
