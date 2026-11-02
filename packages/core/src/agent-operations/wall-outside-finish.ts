import { isOutdoorRoom } from '../building/room-use'
import type { SceneMaterial, WallFace, WallNode, ZoneNode } from '../schema'
import {
  describeWallFaceFinishes,
  getWallLevelZones,
  getWallZoneSpans,
  type WallFaceStretch,
} from '../systems/wall/wall-finish'
import { describeFinish, type FinishFact } from './room-finishes'
import { queryNodes } from './scene-queries'
import type { SceneNodes } from './types'

/**
 * Which walls show the finish of their outside face on their inside face too. A wall is read as
 * outside when indoor rooms stand on half or more of one face and not of the other (a face toward a
 * porch, an alfresco or open ground is outside); the finish of a face is the one that shows on at
 * least half of its length by a ref somebody wrote (a wall left at the default shows none). The
 * finish counts as the house's inside finish, and is left alone, when any partition (rooms on both
 * faces) shows it: the walls inside are then dressed in it on purpose.
 */

export type OutsideFinishInside = {
  finish: FinishFact
  walls: { id: string; levelId: string; lengthM: number; rooms: string[] }[]
  /** The finishes the partitions of the scene show, longest first. */
  partitions: FinishFact[]
}

type Materials = Readonly<Record<string, SceneMaterial>> | undefined

/** The share of a face (0 to 1) that indoor rooms stand on. */
function indoorShare(spans: readonly { t0: number; t1: number }[]): number {
  let reach = 0
  let total = 0
  for (const span of [...spans].sort((p, q) => p.t0 - q.t0)) {
    const from = Math.max(span.t0, reach)
    if (span.t1 > from) total += span.t1 - from
    reach = Math.max(reach, span.t1)
  }
  return total
}

const lengthOf = (stretch: WallFaceStretch) => Math.max(0, stretch.u1 - stretch.u0)

/** What a face shows by a ref somebody wrote, metres per ref; the default and a ref-less inline finish are none. */
function writtenRefs(stretches: readonly WallFaceStretch[]): Map<string, number> {
  const refs = new Map<string, number>()
  for (const stretch of stretches) {
    if (stretch.ref === null || (stretch.source === 'wall_face' && stretch.chain === 'default'))
      continue
    refs.set(stretch.ref, (refs.get(stretch.ref) ?? 0) + lengthOf(stretch))
  }
  return refs
}

/** The ref shown on at least half of the face's length, or null. */
function dominantRef(stretches: readonly WallFaceStretch[]): string | null {
  const total = stretches.reduce((sum, stretch) => sum + lengthOf(stretch), 0)
  const [best] = [...writtenRefs(stretches)].sort((p, q) => q[1] - p[1])
  return best && total > 0 && best[1] >= total / 2 ? best[0] : null
}

const FACES: readonly WallFace[] = ['a', 'b']

/**
 * The faces of a wall that indoor rooms stand on for half of their length or more, or null when no
 * room of the level stands on the wall at all (nothing to read it by: its stored sides are the
 * only word on which way it faces).
 */
export function wallInsideFaces(nodes: SceneNodes, wall: WallNode): WallFace[] | null {
  const rooms = getWallLevelZones(wall, nodes).filter(
    (zone: ZoneNode) => zone.spaceRole === 'room' && zone.polygon.length >= 3,
  )
  const spans = getWallZoneSpans(wall, rooms)
  if (!spans.length) return null
  return FACES.filter(
    (face) =>
      indoorShare(
        spans.filter(
          (span) => span.face === face && !isOutdoorRoom(nodes[span.zoneId] as ZoneNode),
        ),
      ) >= 0.5,
  )
}

export function outsideFinishInside(
  nodes: SceneNodes,
  materials?: Materials,
): OutsideFinishInside[] {
  const groups = new Map<string, OutsideFinishInside['walls']>()
  const partitionRefs = new Map<string, number>()
  let partitions = 0
  for (const wall of queryNodes<WallNode>(nodes, { type: 'wall' })) {
    if (wall.wallType === 'curtain' || wall.visible === false) continue
    const inside = wallInsideFaces(nodes, wall)
    if (!inside?.length) continue
    const rooms = getWallLevelZones(wall, nodes).filter(
      (zone: ZoneNode) => zone.spaceRole === 'room' && zone.polygon.length >= 3,
    )
    const spans = getWallZoneSpans(wall, rooms)
    const faces = describeWallFaceFinishes(wall, nodes)
    if (inside.length === 2) {
      partitions += 1
      for (const face of FACES)
        for (const [ref, metres] of writtenRefs(faces[face].stretches))
          partitionRefs.set(ref, (partitionRefs.get(ref) ?? 0) + metres)
      continue
    }
    const [innerFace] = inside as [WallFace]
    const outerFace: WallFace = innerFace === 'a' ? 'b' : 'a'
    const outer = dominantRef(faces[outerFace].stretches)
    if (!outer || outer !== dominantRef(faces[innerFace].stretches)) continue
    const lengthM = faces[innerFace].stretches.reduce((sum, s) => sum + lengthOf(s), 0)
    const names = [
      ...new Set(
        spans
          .filter(
            (span) => span.face === innerFace && !isOutdoorRoom(nodes[span.zoneId] as ZoneNode),
          )
          .map((span) => (nodes[span.zoneId] as ZoneNode).name),
      ),
    ]
    groups.set(outer, [
      ...(groups.get(outer) ?? []),
      { id: wall.id, levelId: wall.parentId ?? '', lengthM, rooms: names },
    ])
  }
  if (!partitions) return []
  const inPartitions = [...partitionRefs].sort((p, q) => q[1] - p[1])
  return [...groups]
    .filter(([ref]) => !partitionRefs.has(ref))
    .map(([ref, walls]) => ({
      finish: describeFinish(ref, materials),
      walls,
      partitions: inPartitions.slice(0, 2).map(([other]) => describeFinish(other, materials)),
    }))
}
