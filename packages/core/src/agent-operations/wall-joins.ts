import type { AnyNode } from '../schema'
import { isCurvedWall } from '../systems/wall/wall-curve'
import { getWallBodyLine } from '../systems/wall/wall-frame'

/**
 * Two facts about where straight walls of one level meet, for `verify_scene`:
 *
 * - `wall_end_short`: a wall end that stops short of another wall's body, leaving daylight
 *   between them. The room graph (`wall_open_end`) elects an end within 8 cm of a body as joined
 *   and says nothing of it; the floor, the finish and the render show the slot.
 * - `wall_nearly_aligned`: a wall that continues another a few degrees off its axis, or sits
 *   between two aligned walls a few degrees off their line (a short wall holding a door,
 *   drawn skewed). A wall angled by design turns more than this and does not qualify.
 *
 * Measured on the walls' bodies (the stored line shifted by the justification, a thickness wide),
 * straight walls only: a curved wall has no single axis and no single end cap.
 */

type WallNode = AnyNode & { type: 'wall' }
type Pt = readonly [number, number]

/** An end that stops this far short of a body or more is a gap; nearer is a joint. */
export const END_SHORT_MIN_M = 0.03
/** Further than this the end is a free end that happens to stand near a wall, not a missed joint. */
export const END_SHORT_MAX_M = 0.25
/** A turn smaller than this is a straight line drawn with noise; a larger one up to the maximum is the finding. */
export const ALIGN_MIN_DEG = 0.5
/** A turn larger than this is an angle somebody drew (a bay, an angled wing). */
export const ALIGN_MAX_DEG = 6
/** A skew that moves the wall's far end less than this off its neighbour's line is within drawing tolerance, and is not said. */
export const ALIGN_MIN_OFFSET_M = 0.02
/** The two neighbours of a wall count as aligned with each other within this. */
const NEIGHBOURS_ALIGNED_DEG = 0.5
/** Shortest wall that is measured. */
const MIN_LENGTH_M = 0.05
/** The nearest points of two parts of a wall end and a body must lie this far ahead of the end, as a share of the distance (cos of 60 degrees). */
const AHEAD = 0.5

export type WallBody = {
  id: string
  name: string
  /** The body's centre line, start to end. */
  a: Pt
  b: Pt
  length: number
  /** Unit direction a to b. */
  ux: number
  uy: number
  thickness: number
}

export type WallEndShortIssue = {
  type: 'wall_end_short'
  message: string
  severity: 'warning'
  levelId: string
  wallId: string
  wallName: string
  end: 'start' | 'end'
  otherWallId: string
  otherWallName: string
  /** Daylight between the end and the other wall's body, in metres. */
  gap: number
  /** Where the end is, [x, z]. */
  at: [number, number]
  nodeIds: [string, string]
}

export type WallNearlyAlignedIssue = {
  type: 'wall_nearly_aligned'
  message: string
  severity: 'warning'
  levelId: string
  wallId: string
  wallName: string
  /** The largest angle between the wall's axis and a neighbour's, in degrees. */
  angle: number
  /** How far the wall's far end stands off the neighbour's line, in metres. */
  offset: number
  neighbours: { wallId: string; name: string; end: 'start' | 'end'; angle: number }[]
  nodeIds: string[]
}

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places
const nameOf = (wall: WallNode) => wall.name?.trim() || wall.id

/** The straight, visible walls long enough to measure, as bodies. */
export function wallBodies(walls: readonly WallNode[]): WallBody[] {
  const bodies: WallBody[] = []
  for (const wall of walls) {
    if (wall.visible === false || isCurvedWall(wall)) continue
    const line = getWallBodyLine(wall)
    const dx = line.end.x - line.start.x
    const dy = line.end.y - line.start.y
    const length = Math.hypot(dx, dy)
    if (!(length >= MIN_LENGTH_M) || !Number.isFinite(length)) continue
    bodies.push({
      id: wall.id,
      name: nameOf(wall),
      a: [line.start.x, line.start.y],
      b: [line.end.x, line.end.y],
      length,
      ux: dx / length,
      uy: dy / length,
      thickness: wall.thickness ?? 0.1,
    })
  }
  return bodies.sort((p, q) => (p.id < q.id ? -1 : 1))
}

const dot = (ax: number, ay: number, bx: number, by: number) => ax * bx + ay * by

/** The closest points of two segments and their distance (0 where they cross). */
function closestOfSegments(p1: Pt, p2: Pt, q1: Pt, q2: Pt): { d: number; p: Pt; q: Pt } {
  const d1x = p2[0] - p1[0]
  const d1y = p2[1] - p1[1]
  const d2x = q2[0] - q1[0]
  const d2y = q2[1] - q1[1]
  const rx = p1[0] - q1[0]
  const ry = p1[1] - q1[1]
  const a = dot(d1x, d1y, d1x, d1y)
  const e = dot(d2x, d2y, d2x, d2y)
  const f = dot(d2x, d2y, rx, ry)
  let s: number
  let t: number
  if (a <= 1e-12 && e <= 1e-12) {
    s = 0
    t = 0
  } else if (a <= 1e-12) {
    s = 0
    t = Math.min(1, Math.max(0, f / e))
  } else {
    const c = dot(d1x, d1y, rx, ry)
    if (e <= 1e-12) {
      t = 0
      s = Math.min(1, Math.max(0, -c / a))
    } else {
      const b = dot(d1x, d1y, d2x, d2y)
      const denom = a * e - b * b
      s = denom > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0
      t = (b * s + f) / e
      if (t < 0) {
        t = 0
        s = Math.min(1, Math.max(0, -c / a))
      } else if (t > 1) {
        t = 1
        s = Math.min(1, Math.max(0, (b - c) / a))
      }
    }
  }
  const p: Pt = [p1[0] + d1x * s, p1[1] + d1y * s]
  const q: Pt = [q1[0] + d2x * t, q1[1] + d2y * t]
  return { d: Math.hypot(p[0] - q[0], p[1] - q[1]), p, q }
}

/** The four corners of a body, in order. */
function corners(body: WallBody): Pt[] {
  const nx = -body.uy * (body.thickness / 2)
  const ny = body.ux * (body.thickness / 2)
  return [
    [body.a[0] + nx, body.a[1] + ny],
    [body.b[0] + nx, body.b[1] + ny],
    [body.b[0] - nx, body.b[1] - ny],
    [body.a[0] - nx, body.a[1] - ny],
  ]
}

function insideRectangle(point: Pt, rectangle: readonly Pt[]) {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const from = rectangle[i]!
    const to = rectangle[(i + 1) % 4]!
    const cross =
      (to[0] - from[0]) * (point[1] - from[1]) - (to[1] - from[1]) * (point[0] - from[0])
    if (Math.abs(cross) < 1e-12) continue
    const s = Math.sign(cross)
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

/** The closest points of a segment and a body's rectangle; 0 apart where they touch or overlap. */
function closestToBody(c1: Pt, c2: Pt, body: WallBody): { d: number; p: Pt; q: Pt } {
  const rectangle = corners(body)
  if (insideRectangle(c1, rectangle)) return { d: 0, p: c1, q: c1 }
  if (insideRectangle(c2, rectangle)) return { d: 0, p: c2, q: c2 }
  let best = { d: Number.POSITIVE_INFINITY, p: c1, q: c1 } as { d: number; p: Pt; q: Pt }
  for (let i = 0; i < 4; i++) {
    const hit = closestOfSegments(c1, c2, rectangle[i]!, rectangle[(i + 1) % 4]!)
    if (hit.d < best.d) best = hit
  }
  return best
}

const endPoint = (body: WallBody, end: 'start' | 'end'): Pt => (end === 'start' ? body.a : body.b)
/** The unit direction pointing out of the wall at an end. */
const outward = (body: WallBody, end: 'start' | 'end'): Pt =>
  end === 'start' ? [-body.ux, -body.uy] : [body.ux, body.uy]

/**
 * Wall ends that stop 3 to 25 cm short of another wall of the level: the daylight between the
 * end's cap and the other wall's body, the other wall named. An end that touches any wall (the
 * caps and bodies within 3 cm) is a joint and is not asked; so is an end whose nearest wall lies
 * to its side, not ahead of it (two walls running side by side).
 */
export function wallEndShortIssues(input: {
  levelId: string
  levelName: string
  bodies: readonly WallBody[]
  min?: number
  max?: number
}): WallEndShortIssue[] {
  const min = input.min ?? END_SHORT_MIN_M
  const max = input.max ?? END_SHORT_MAX_M
  const issues: WallEndShortIssue[] = []
  for (const wall of input.bodies) {
    for (const end of ['start', 'end'] as const) {
      const e = endPoint(wall, end)
      const [ox, oy] = outward(wall, end)
      const half = wall.thickness / 2
      const cap1: Pt = [e[0] - oy * half, e[1] + ox * half]
      const cap2: Pt = [e[0] + oy * half, e[1] - ox * half]
      let touching = false
      let nearest: { other: WallBody; d: number } | undefined
      for (const other of input.bodies) {
        if (other.id === wall.id) continue
        const hit = closestToBody(cap1, cap2, other)
        if (hit.d < min) {
          touching = true
          break
        }
        if (hit.d > max) continue
        const vx = hit.q[0] - hit.p[0]
        const vy = hit.q[1] - hit.p[1]
        if (dot(vx, vy, ox, oy) < AHEAD * hit.d) continue
        if (!nearest || hit.d < nearest.d) nearest = { other, d: hit.d }
      }
      if (touching || !nearest) continue
      const gap = round(nearest.d, 3)
      const cm = (gap * 100).toFixed(1)
      issues.push({
        type: 'wall_end_short',
        severity: 'warning',
        levelId: input.levelId,
        wallId: wall.id,
        wallName: wall.name,
        end,
        otherWallId: nearest.other.id,
        otherWallName: nearest.other.name,
        gap,
        at: [round(e[0], 3), round(e[1], 3)],
        nodeIds: [wall.id, nearest.other.id],
        message: `On ${input.levelName}, ${wall.name} (${wall.id}) ${end} stops ${cm} cm short of ${nearest.other.name} (${nearest.other.id}) at (${e[0].toFixed(2)}, ${e[1].toFixed(2)}): ${cm} cm of daylight between them (asked for a gap of ${min * 100}-${max * 100} cm; a joint is closer, a free end further)`,
      })
    }
  }
  return issues
}

export type Bend = {
  wall: WallBody
  end: 'start' | 'end'
  other: WallBody
  otherEnd: 'start' | 'end'
  angle: number
}

const degrees = (radians: number) => (radians * 180) / Math.PI
const angleBetween = (ax: number, ay: number, bx: number, by: number) =>
  degrees(Math.acos(Math.min(1, Math.max(-1, dot(ax, ay, bx, by)))))
/** Distance from a point to the infinite line of a body. */
const offLine = (point: Pt, body: WallBody) =>
  Math.abs((point[0] - body.a[0]) * body.uy - (point[1] - body.a[1]) * body.ux)

/**
 * Every place one wall carries on into another: the two bodies' ends within a wall thickness of
 * each other, and the second heading away from the joint within `maxDeg` of the first's heading.
 * The angle is the turn between them (0 is one straight line).
 */
export function wallContinuations(bodies: readonly WallBody[], maxDeg: number): Bend[] {
  const bends: Bend[] = []
  for (const wall of bodies) {
    for (const end of ['start', 'end'] as const) {
      const e = endPoint(wall, end)
      const [ox, oy] = outward(wall, end)
      for (const other of bodies) {
        if (other.id === wall.id) continue
        for (const otherEnd of ['start', 'end'] as const) {
          const f = endPoint(other, otherEnd)
          if (Math.hypot(e[0] - f[0], e[1] - f[1]) > Math.max(wall.thickness, other.thickness))
            continue
          // the direction the other wall takes away from the joint
          const [dx, dy] = outward(other, otherEnd === 'start' ? 'end' : 'start')
          const angle = angleBetween(ox, oy, dx, dy)
          if (angle <= maxDeg) bends.push({ wall, end, other, otherEnd, angle })
        }
      }
    }
  }
  return bends
}

/**
 * A wall that continues another at an angle between 0.5 and 6 degrees: joined at an end and
 * carrying on in nearly the same direction. A wall between two neighbours that are aligned with
 * each other is the one reported (the short wall holding a door, drawn skewed), with both
 * neighbours; a single bend is reported on the shorter of its two walls.
 */
export function wallNearlyAlignedIssues(input: {
  levelId: string
  levelName: string
  bodies: readonly WallBody[]
  min?: number
  max?: number
  minOffset?: number
}): WallNearlyAlignedIssue[] {
  const min = input.min ?? ALIGN_MIN_DEG
  const max = input.max ?? ALIGN_MAX_DEG
  const minOffset = input.minOffset ?? ALIGN_MIN_OFFSET_M
  const bends = wallContinuations(input.bodies, max).filter((bend) => bend.angle >= min)
  const byWall = new Map<string, Bend[]>()
  for (const bend of bends) byWall.set(bend.wall.id, [...(byWall.get(bend.wall.id) ?? []), bend])
  const issues: WallNearlyAlignedIssue[] = []
  const covered = new Set<string>()
  const neighbourOf = (bend: Bend) => ({
    wallId: bend.other.id,
    name: bend.other.name,
    end: bend.end,
    angle: round(bend.angle, 1),
  })
  const issue = (wall: WallBody, own: Bend[], offset: number): WallNearlyAlignedIssue => {
    const angle = round(Math.max(...own.map((bend) => bend.angle)), 1)
    const neighbours = own.map(neighbourOf)
    return {
      type: 'wall_nearly_aligned',
      severity: 'warning',
      levelId: input.levelId,
      wallId: wall.id,
      wallName: wall.name,
      angle,
      offset: round(offset, 3),
      neighbours,
      nodeIds: [wall.id, ...own.map((bend) => bend.other.id)],
      message: `On ${input.levelName}, ${wall.name} (${wall.id}) lies ${angle.toFixed(1)}° off the axis of ${neighbours
        .map((n) => `${n.name} (${n.wallId}) at its ${n.end} (${n.angle.toFixed(1)}°)`)
        .join(
          ' and ',
        )}; its far end stands ${(offset * 100).toFixed(1)} cm off that line (asked for a turn of ${min}-${max}° that moves the far end 2 cm or more: a straighter line is one line, a larger turn is an angle drawn on purpose)`,
    }
  }
  // a wall between two neighbours aligned with each other: the skewed one
  for (const [id, own] of byWall) {
    const wall = own[0]!.wall
    const starts = own.filter((bend) => bend.end === 'start')
    const ends = own.filter((bend) => bend.end === 'end')
    if (!starts.length || !ends.length) continue
    for (const first of starts) {
      for (const second of ends) {
        const between = angleBetween(
          first.other.ux,
          first.other.uy,
          second.other.ux,
          second.other.uy,
        )
        const aligned = Math.min(between, 180 - between) < NEIGHBOURS_ALIGNED_DEG
        if (!aligned || covered.has(id)) continue
        covered.add(id)
        const offset = Math.max(offLine(wall.a, first.other), offLine(wall.b, first.other))
        if (offset >= minOffset) issues.push(issue(wall, [first, second], offset))
      }
    }
  }
  // a single bend: the shorter wall carries it, once
  const reported = new Set<string>()
  for (const bend of bends) {
    if (covered.has(bend.wall.id) || covered.has(bend.other.id)) continue
    const shorter =
      bend.wall.length < bend.other.length ||
      (bend.wall.length === bend.other.length && bend.wall.id < bend.other.id)
    if (!shorter) continue
    const key = [bend.wall.id, bend.other.id].sort().join('|')
    if (reported.has(key)) continue
    reported.add(key)
    const far = bend.end === 'start' ? bend.wall.b : bend.wall.a
    const offset = offLine(far, bend.other)
    if (offset >= minOffset) issues.push(issue(bend.wall, [bend], offset))
  }
  return issues.sort((a, b) => (a.wallId < b.wallId ? -1 : 1))
}
