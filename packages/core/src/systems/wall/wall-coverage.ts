import { GROUND_SUPPORT_ID } from '../../hooks/spatial-grid/support-host-id'
import type { WallNode } from '../../schema/nodes/wall'

type Point = [number, number]
type Interval = [number, number]
export type SharedWallSegment = {
  wall: WallNode
  start: Point
  end: Point
  contributors: WallNode[]
}

const MIN_SEGMENT = 0.001
const TRACE_TOLERANCE = 0.01
/** Offcut pieces shorter than this from collinear overlaps are dropped, not committed as walls. */
const WALL_SHARD_MIN_LENGTH = 0.02
const at = (w: WallNode, t: number): Point => [
  w.start[0] + (w.end[0] - w.start[0]) * t,
  w.start[1] + (w.end[1] - w.start[1]) * t,
]
const length = (w: WallNode) => Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1])
const project = (p: Point, w: WallNode) =>
  ((p[0] - w.start[0]) * (w.end[0] - w.start[0]) + (p[1] - w.start[1]) * (w.end[1] - w.start[1])) /
  length(w) ** 2

function overlap(w: WallNode, other: WallNode): Interval | null {
  if (
    w.parentId !== other.parentId ||
    // Hand-drawn ground walls persist no support host; a missing support IS
    // the level base, so it must match 'ground' or SVG dedup never sees it.
    (w.supportSlabId ?? GROUND_SUPPORT_ID) !== (other.supportSlabId ?? GROUND_SUPPORT_ID) ||
    Math.abs((w.supportOffset ?? 0) - (other.supportOffset ?? 0)) > 0.00001 ||
    Math.abs(w.curveOffset ?? 0) > 0.00001 ||
    Math.abs(other.curveOffset ?? 0) > 0.00001
  )
    return null
  const a = length(w),
    b = length(other)
  if (a < MIN_SEGMENT || b < MIN_SEGMENT) return null
  const dx = w.end[0] - w.start[0],
    dz = w.end[1] - w.start[1]
  const cross =
    Math.abs(dx * (other.end[1] - other.start[1]) - dz * (other.end[0] - other.start[0])) / (a * b)
  if (cross > 0.002) return null
  const from = Math.max(0, Math.min(project(other.start, w), project(other.end, w)))
  const to = Math.min(1, Math.max(project(other.start, w), project(other.end, w)))
  if ((to - from) * a < MIN_SEGMENT) return null
  const tolerance = Math.min(
    TRACE_TOLERANCE,
    (w.thickness ?? 0.1) / 4,
    (other.thickness ?? 0.1) / 4,
  )
  // Compare only the shared interval: a long adjacent edge can extend beyond the other wall.
  for (const t of [from, to]) {
    const p = at(w, t),
      q = at(other, project(p, other))
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) > tolerance) return null
  }
  return [from, to]
}

/** Incoming walls are unhosted drafts. Existing walls always retain their IDs and attachments. */
export function planSharedWallSegments(
  incoming: readonly WallNode[],
  existing: readonly WallNode[],
  floorHeight: number,
) {
  const segments: SharedWallSegment[] = []
  const reused = new Set<WallNode['id']>()
  const anchors: { from: Point; to: Point; existing: boolean }[] = []
  for (let index = 0; index < incoming.length; index++) {
    const wall = incoming[index]!
    const peers = [
      ...existing.map((other) => ({ other, index: -1, existing: true })),
      ...incoming.map((other, index) => ({ other, index, existing: false })),
    ].flatMap((peer) => {
      if (peer.other === wall) return []
      const interval = overlap(wall, peer.other)
      if (!interval) return []
      if (
        (peer.other.height ?? floorHeight) + 0.00001 < (wall.height ?? floorHeight) ||
        (peer.other.thickness ?? 0.1) + 0.00001 < (wall.thickness ?? 0.1)
      ) {
        throw Error(
          'A shared wall has a different height or thickness. Match its dimensions before creating these walls.',
        )
      }
      if (peer.existing || peer.index < index)
        for (const t of interval) {
          const from = at(wall, t)
          anchors.push({
            from,
            to: at(peer.other, project(from, peer.other)),
            existing: peer.existing,
          })
        }
      return [{ ...peer, interval }]
    })
    const cuts = [0, 1, ...peers.flatMap((p) => p.interval)].sort((a, b) => a - b)
    for (let i = 1; i < cuts.length; i++) {
      const from = cuts[i - 1]!,
        to = cuts[i]!
      // A collinear near-duplicate leaves sub-centimetre offcut intervals on
      // either side of the shared span; committing them renders as shards.
      if ((to - from) * length(wall) < WALL_SHARD_MIN_LENGTH) continue
      const midpoint = (from + to) / 2
      const covered = peers.filter((p) => p.interval[0] <= midpoint && p.interval[1] >= midpoint)
      const retained = covered.find((p) => p.existing)
      if (retained) {
        reused.add(retained.other.id)
        continue
      }
      if (covered.some((p) => p.index < index)) continue
      segments.push({
        wall,
        start: at(wall, from),
        end: at(wall, to),
        contributors: [wall, ...covered.map((p) => p.other)],
      })
    }
  }
  // Snap adjoining draft endpoints to the retained shared axis; otherwise SVG rounding
  // would remove the duplicate but leave tiny gaps at the condominium corners.
  anchors.sort((a, b) => Number(b.existing) - Number(a.existing))
  const snap = (point: Point) =>
    anchors.find((a) => Math.hypot(a.from[0] - point[0], a.from[1] - point[1]) < MIN_SEGMENT)?.to ??
    point
  return {
    segments: segments
      .map((s) => ({ ...s, start: snap(s.start), end: snap(s.end) }))
      .filter((s) => Math.hypot(s.end[0] - s.start[0], s.end[1] - s.start[1]) >= MIN_SEGMENT),
    reusedWallIds: [...reused],
  }
}
