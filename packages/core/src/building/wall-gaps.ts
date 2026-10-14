import type { WallNode } from '../schema'

type Pt = [number, number]

/** Wall ends this close are joined. */
const JOIN = 0.05
/** The narrowest gap a door or window leaves. */
const MIN_GAP = 0.6
/** On the outside: up to a garage door or a stacking slider. */
const MAX_OUTSIDE = 5
/** Two gaps closer than this, side by side, are one opening found from two wall ends. */
const DUPLICATE = 0.5

const sub = (a: readonly number[], b: readonly number[]): Pt => [a[0]! - b[0]!, a[1]! - b[1]!]
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1]
const cross = (a: Pt, b: Pt) => a[0] * b[1] - a[1] * b[0]
const round = (value: number) => Math.round(value * 1e6) / 1e6
const at = (p: readonly number[], u: Pt, s: number): Pt => [
  round(p[0]! + u[0] * s),
  round(p[1]! + u[1] * s),
]
const same = (p: readonly number[], q: readonly number[]) =>
  Math.hypot(q[0]! - p[0]!, q[1]! - p[1]!) < JOIN

function unit(wall: WallNode): Pt {
  const [dx, dz] = sub(wall.end, wall.start)
  const length = Math.hypot(dx, dz)
  return [dx / length, dz / length]
}

/**
 * How a wall end meets the others. Closed: a wall carries on in line from it, or it runs into
 * another wall's side. Cornered: another wall turns there (a partition ending at an outside wall's
 * jamb leaves the gap open: Hawkesbury's laundry door).
 */
function endOf(p: readonly number[], self: WallNode, walls: readonly WallNode[]) {
  let cornered = false
  for (const other of walls) {
    if (other === self) continue
    const u = unit(other)
    if (same(other.start, p) || same(other.end, p)) {
      if (Math.abs(cross(u, unit(self))) < 0.05) return 'closed'
      cornered = true
      continue
    }
    const v = sub(p, other.start)
    const along = dot(v, u)
    const length = Math.hypot(...sub(other.end, other.start))
    if (
      along > JOIN &&
      along < length - JOIN &&
      Math.abs(cross(u, v)) <= (other.thickness ?? 0.2) / 2 + JOIN
    )
      return 'closed'
  }
  return cornered ? 'cornered' : 'free'
}

/** A gap a plan's walls leave: the wall that closes it, from the open end to what it faces. */
type Candidate = { start: Pt; end: Pt; thickness: number; clear: number }

/**
 * Where a plan's walls leave a gap for an opening: a wall end facing, in line, the end of another
 * wall, or a partition stopping short of the wall it runs to. Found once each.
 */
function gapCandidates(walls: readonly WallNode[]) {
  const straight = walls.filter(
    (wall) => !wall.curveOffset && Math.hypot(...sub(wall.end, wall.start)) > JOIN,
  )
  const found = new Map<string, Candidate>()
  for (const wall of straight) {
    const u = unit(wall)
    for (const [p, out] of [
      [wall.end, u],
      [wall.start, [-u[0], -u[1]] as Pt],
    ] as const) {
      const end = endOf(p, wall, straight)
      if (end === 'closed') continue
      // The nearest thing ahead: a wall end in line, or a wall across the way.
      let nearest: { s: number; end: Pt; to: WallNode; clear: number; atEnd: boolean } | null = null
      for (const other of straight) {
        if (other === wall) continue
        const w = unit(other)
        const half = (wall.thickness ?? 0.2) / 2
        if (Math.abs(cross(u, w)) < 0.05) {
          for (const q of [other.start, other.end]) {
            const v = sub(q, p)
            const s = dot(v, out)
            if (s > JOIN && Math.abs(cross(out, v)) < Math.max(half, (other.thickness ?? 0.2) / 2))
              if (!nearest || s < nearest.s)
                nearest = { s, end: [q[0], q[1]], to: other, clear: s, atEnd: true }
          }
          continue
        }
        if (Math.abs(cross(out, w)) < 0.5) continue
        const v = sub(other.start, p)
        const s = cross(v, w) / cross(out, w)
        const t = cross(v, out) / cross(out, w)
        const length = Math.hypot(...sub(other.end, other.start))
        // The ray meets the wall's body, which reaches half its thickness past its centreline's end.
        const reach = Math.max(JOIN, (other.thickness ?? 0.2) / 2)
        if (s <= JOIN || t < -reach || t > length + reach) continue
        const clear = s - (other.thickness ?? 0.2) / 2
        if (!nearest || s < nearest.s)
          nearest = {
            s,
            end: at(p, out, s),
            to: other,
            clear,
            atEnd: t < reach || t > length - reach,
          }
      }
      if (!nearest || nearest.clear < MIN_GAP - 1e-9 || nearest.clear > MAX_OUTSIDE + 1e-9) continue
      // From a corner, only a gap that ends at a wall end: the outside past a building's corner
      // runs to whatever wall lies across it.
      if (end === 'cornered' && !nearest.atEnd) continue
      const start: Pt = [p[0], p[1]]
      const key = [start, nearest.end]
        .map((q) => `${Math.round(q[0] * 100)},${Math.round(q[1] * 100)}`)
        .sort()
        .join('|')
      if (found.has(key)) continue
      found.set(key, {
        start,
        end: nearest.end,
        // In line, the gap belongs to the thicker of its two walls (an outside wall's last jamb is
        // often a thin stub); across, to the wall it starts from.
        thickness:
          Math.abs(cross(u, unit(nearest.to))) < 0.05
            ? Math.max(wall.thickness ?? 0.2, nearest.to.thickness ?? 0.2)
            : (wall.thickness ?? 0.2),
        clear: nearest.clear,
      })
    }
  }
  // One gap per opening: two wall ends a few centimetres apart find it twice.
  const candidates: Candidate[] = []
  for (const gap of [...found.values()].sort((a, b) => a.clear - b.clear)) {
    const centre = mid(gap)
    const direction = unitOf(gap)
    if (
      !candidates.some(
        (kept) =>
          Math.hypot(...sub(mid(kept), centre)) < DUPLICATE &&
          Math.abs(cross(unitOf(kept), direction)) < 0.1,
      )
    )
      candidates.push(gap)
  }
  return candidates
}

/**
 * The walls that close every gap a plan's walls leave, whatever opening each takes: a storey's
 * outline for its roof, whether or not its doors and windows are in yet.
 */
export function gapBridges(walls: readonly WallNode[]) {
  return gapCandidates(walls).map(({ start, end, thickness }) => ({
    start,
    end,
    thickness,
  }))
}

const mid = (gap: { start: Pt; end: Pt }): Pt => [
  (gap.start[0] + gap.end[0]) / 2,
  (gap.start[1] + gap.end[1]) / 2,
]
const unitOf = (gap: { start: Pt; end: Pt }): Pt => {
  const [dx, dz] = sub(gap.end, gap.start)
  const length = Math.hypot(dx, dz)
  return [dx / length, dz / length]
}
