// Pure snap geometry for a wall pulled from a selected wall's end (the "pull to
// continue" grip) and for the run it continues — no store / viewer / React
// deps, so it's unit-testable in isolation. Coordinates are XZ plan points in
// the building's own frame, the frame both views draft in: the building's axes
// are the plan's X and Z, so a turned house keeps its square.

import { isCurvedWall, type WallNode } from '@pascal-app/core'
import {
  distanceSquared,
  findWallBodySnapTarget,
  findWallSpecialPointSnap,
  WALL_CONNECT_SNAP_RADIUS,
  type WallPlanPoint,
  wallIdsAtSnapPoint,
} from './wall-snap-geometry'

/**
 * What a pulled wall's end caught, as the snap marker names it: an existing
 * wall's end or middle, a crossing (two walls, or two guides), a point on a
 * wall (`perpendicular` when the new wall meets it square), a guide it lines up
 * with, or a plain grid length.
 */
export type WallPullSnapKind =
  | 'endpoint'
  | 'midpoint'
  | 'intersection'
  | 'wall'
  | 'perpendicular'
  | 'alignment'
  | 'grid'

/** The words the snap marker shows for each kind. */
export const WALL_PULL_SNAP_LABELS: Record<WallPullSnapKind, string> = {
  endpoint: 'Endpoint',
  midpoint: 'Midpoint',
  intersection: 'Intersection',
  wall: 'On wall',
  perpendicular: 'Perpendicular',
  alignment: 'Aligned',
  grid: 'Grid',
}

/**
 * How the wall's direction was held: straight on from the wall it comes from,
 * square to it, along one of the house's axes, on a 15° step, or not at all.
 */
export type WallPullDirectionLock = 'straight' | 'square' | 'axis' | 'angle' | 'free'

/**
 * A dashed guide: the extension of the wall the new one comes from, a line
 * through another wall's end along one of the house's axes, or the same through
 * the run's start (so the run can close square back to it).
 */
export type WallPullGuideKind = 'extension' | 'alignment' | 'run-start'

export type WallPullGuide = {
  kind: WallPullGuideKind
  from: WallPlanPoint
  to: WallPlanPoint
}

export type WallPullSnapResult = {
  point: WallPlanPoint
  snap: WallPullSnapKind | null
  /** `WALL_PULL_SNAP_LABELS[snap]`, or "In line with start" for the run's start guide. */
  label: string | null
  lock: WallPullDirectionLock
  /** Walls whose geometry the end landed on, for the marker's wall highlight. */
  targetWallIds: string[]
  guides: WallPullGuide[]
  /** Where two guides cross near the cursor: markers, and snap targets. */
  intersections: WallPlanPoint[]
}

/** Snap radii (m) measured from the cursor, or along the held direction for `wall` / `alignment`. */
export type WallPullSnapRadii = {
  endpoint: number
  /** A wall's middle, or where two walls cross. */
  special: number
  /** Where two guides cross. */
  intersection: number
  /** The held direction landing on a wall's line, or the square foot on it. */
  wall: number
  /** The held direction landing on a guide. */
  alignment: number
  /** How near a guide line passes the cursor to be considered at all. */
  guide: number
}

export const WALL_PULL_SNAP_RADII: WallPullSnapRadii = {
  endpoint: 0.3,
  special: 0.2,
  intersection: 0.2,
  wall: 0.25,
  alignment: 0.15,
  guide: 0.6,
}

/** The direction holds straight on / square / on a house axis within this angle. */
export const WALL_PULL_LOCK_TOLERANCE = (7 * Math.PI) / 180
/** Past the lock the direction snaps to steps of this angle, on the house's axes. */
export const WALL_PULL_ANGLE_STEP = Math.PI / 12

const PERPENDICULAR_SINE = Math.sin((1 * Math.PI) / 180)
const ON_LINE = 1e-6
const INTERSECTION_SHOW_RADIUS = 0.75
const EXTENSION_MIN_LENGTH = 1.5
const EXTENSION_OVERSHOOT = 1
const GUIDE_OVERSHOOT = 0.5

export type WallPullSnapInput = {
  /** The raw cursor. */
  point: WallPlanPoint
  /** Where the wall being drawn starts. */
  start: WallPlanPoint
  /** Where the run started: the pulled wall end. */
  runStart: WallPlanPoint
  /**
   * Unit direction of the wall the new one comes from, pointing out of its end
   * (the pulled wall's, then each placed wall's). Null draws on the house's
   * axes and 15° steps only.
   */
  reference: WallPlanPoint | null
  /** The level's walls: snap targets and guide anchors. */
  walls: readonly WallNode[]
  /** Length step along the held direction; 0 leaves lengths free. */
  gridStep: number
  /** Alt, or snapping off: the end follows the cursor. */
  free?: boolean
  radii?: Partial<WallPullSnapRadii>
}

type GuideLine = {
  kind: WallPullGuideKind
  /** A point on the line: the anchor it is drawn from. */
  anchor: WallPlanPoint
  /** Unit direction. */
  direction: WallPlanPoint
}

function unit(vector: WallPlanPoint): WallPlanPoint | null {
  const length = Math.hypot(vector[0], vector[1])
  return length > 1e-9 ? [vector[0] / length, vector[1] / length] : null
}

function angleBetween(a: WallPlanPoint, b: WallPlanPoint): number {
  return Math.abs(Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]))
}

function samePoint(a: WallPlanPoint, b: WallPlanPoint, tolerance = 1e-6): boolean {
  return distanceSquared(a, b) <= tolerance * tolerance
}

/**
 * The direction a pull from `start` toward `vector` holds: straight on from
 * `reference` or square to it, or along a house axis, whichever is nearest
 * within `WALL_PULL_LOCK_TOLERANCE`; otherwise the nearest 15° step on the
 * house's axes. Folding back over the wall it comes from is not offered.
 */
export function lockWallPullDirection(
  vector: WallPlanPoint,
  reference: WallPlanPoint | null,
): { direction: WallPlanPoint; lock: WallPullDirectionLock } {
  const along = unit(vector)
  if (!along) return { direction: reference ?? [1, 0], lock: 'free' }
  const candidates: Array<{ direction: WallPlanPoint; lock: WallPullDirectionLock }> = []
  const ref = reference ? unit(reference) : null
  if (ref) {
    candidates.push(
      { direction: ref, lock: 'straight' },
      { direction: [-ref[1], ref[0]], lock: 'square' },
      { direction: [ref[1], -ref[0]], lock: 'square' },
    )
  }
  for (const axis of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as WallPlanPoint[]) {
    candidates.push({ direction: axis, lock: 'axis' })
  }
  let best: { direction: WallPlanPoint; lock: WallPullDirectionLock } | null = null
  let bestAngle = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    const angle = angleBetween(along, candidate.direction)
    if (angle < bestAngle - 1e-9) {
      best = candidate
      bestAngle = angle
    }
  }
  if (best && bestAngle <= WALL_PULL_LOCK_TOLERANCE) return best
  const stepped =
    Math.round(Math.atan2(along[1], along[0]) / WALL_PULL_ANGLE_STEP) * WALL_PULL_ANGLE_STEP
  return { direction: [Math.cos(stepped), Math.sin(stepped)], lock: 'angle' }
}

/**
 * The points guides run through: every wall end on the level and the run's
 * start, once each, leaving out the start of the wall being drawn (a guide
 * through it is the direction lock itself).
 */
function guideAnchors(
  walls: readonly WallNode[],
  runStart: WallPlanPoint,
  start: WallPlanPoint,
): Array<{ point: WallPlanPoint; runStart: boolean }> {
  const anchors: Array<{ point: WallPlanPoint; runStart: boolean }> = []
  const add = (point: WallPlanPoint, isRunStart: boolean) => {
    if (samePoint(point, start, 1e-4)) return
    const existing = anchors.find((anchor) => samePoint(anchor.point, point, 1e-4))
    if (existing) {
      existing.runStart ||= isRunStart
      return
    }
    anchors.push({ point: [point[0], point[1]], runStart: isRunStart })
  }
  add(runStart, true)
  for (const wall of walls) {
    add(wall.start, false)
    add(wall.end, false)
  }
  return anchors
}

/**
 * The guide lines near the cursor: a vertical (constant X) line through each
 * anchor whose X is within `radius` of the cursor's, and a horizontal one
 * likewise. Several anchors on one line give one line, drawn from the anchor
 * nearest the cursor; the run's start keeps its own lines.
 */
function nearbyGuideLines(
  anchors: Array<{ point: WallPlanPoint; runStart: boolean }>,
  cursor: WallPlanPoint,
  radius: number,
): GuideLine[] {
  const lines: GuideLine[] = []
  for (const axis of [0, 1] as const) {
    // axis 0: vertical lines (constant X); axis 1: horizontal lines (constant Z).
    const across = axis === 0 ? 1 : 0
    const byCoord = new Map<string, { point: WallPlanPoint; runStart: boolean }>()
    for (const anchor of anchors) {
      if (Math.abs(anchor.point[axis] - cursor[axis]) > radius) continue
      const key = `${anchor.runStart ? 's' : 'a'}:${anchor.point[axis].toFixed(4)}`
      const held = byCoord.get(key)
      if (
        !held ||
        Math.abs(anchor.point[across] - cursor[across]) <
          Math.abs(held.point[across] - cursor[across])
      ) {
        byCoord.set(key, anchor)
      }
    }
    for (const anchor of byCoord.values()) {
      lines.push({
        kind: anchor.runStart ? 'run-start' : 'alignment',
        anchor: anchor.point,
        direction: axis === 0 ? [0, 1] : [1, 0],
      })
    }
  }
  return lines
}

/** Where two lines cross, or null when they run parallel. */
function crossLines(a: GuideLine, b: GuideLine): WallPlanPoint | null {
  const denom = a.direction[0] * b.direction[1] - a.direction[1] * b.direction[0]
  if (Math.abs(denom) < 1e-9) return null
  const dx = b.anchor[0] - a.anchor[0]
  const dz = b.anchor[1] - a.anchor[1]
  const t = (dx * b.direction[1] - dz * b.direction[0]) / denom
  return [a.anchor[0] + a.direction[0] * t, a.anchor[1] + a.direction[1] * t]
}

/** Station along the ray `start + direction · t` where it crosses `line`, or null. */
function rayStationOnLine(
  start: WallPlanPoint,
  direction: WallPlanPoint,
  line: GuideLine,
): number | null {
  const denom = direction[0] * line.direction[1] - direction[1] * line.direction[0]
  if (Math.abs(denom) < 1e-9) return null
  const dx = line.anchor[0] - start[0]
  const dz = line.anchor[1] - start[1]
  const t = (dx * line.direction[1] - dz * line.direction[0]) / denom
  return t > 1e-6 ? t : null
}

function passesThrough(line: GuideLine, point: WallPlanPoint): boolean {
  const dx = point[0] - line.anchor[0]
  const dz = point[1] - line.anchor[1]
  return Math.abs(dx * line.direction[1] - dz * line.direction[0]) <= 1e-4
}

/** A guide drawn from its anchor through `to` and a little past it. */
function guideThrough(line: GuideLine, to: WallPlanPoint): WallPullGuide {
  const dx = to[0] - line.anchor[0]
  const dz = to[1] - line.anchor[1]
  const along = dx * line.direction[0] + dz * line.direction[1]
  const sign = along >= 0 ? 1 : -1
  return {
    kind: line.kind,
    from: [line.anchor[0], line.anchor[1]],
    to: [
      to[0] + line.direction[0] * sign * GUIDE_OVERSHOOT,
      to[1] + line.direction[1] * sign * GUIDE_OVERSHOOT,
    ],
  }
}

function extensionGuide(
  start: WallPlanPoint,
  reference: WallPlanPoint,
  cursor: WallPlanPoint,
): WallPullGuide {
  const along = (cursor[0] - start[0]) * reference[0] + (cursor[1] - start[1]) * reference[1]
  const length = Math.max(EXTENSION_MIN_LENGTH, along + EXTENSION_OVERSHOOT)
  return {
    kind: 'extension',
    from: [start[0], start[1]],
    to: [start[0] + reference[0] * length, start[1] + reference[1] * length],
  }
}

type WallLine = { wall: WallNode; ux: number; uz: number; length: number }

function straightWallLines(walls: readonly WallNode[]): WallLine[] {
  return walls.flatMap((wall) => {
    if (isCurvedWall(wall)) return []
    const dx = wall.end[0] - wall.start[0]
    const dz = wall.end[1] - wall.start[1]
    const length = Math.hypot(dx, dz)
    return length > 1e-9 ? [{ wall, ux: dx / length, uz: dz / length, length }] : []
  })
}

/** True when `segment` meets `wall` square (within 1°). */
function meetsSquare(segment: WallPlanPoint, line: WallLine): boolean {
  const along = unit(segment)
  if (!along) return false
  return Math.abs(along[0] * line.ux + along[1] * line.uz) <= PERPENDICULAR_SINE
}

/**
 * Snap the end of a pulled wall (or of a wall continuing the run).
 *
 * The direction holds straight on from the wall it comes from, square to it, or
 * along a house axis within about 7°, and on 15° steps past that; the length
 * steps by `gridStep` along it. Existing walls win over the held direction so a
 * loop closes exactly: a wall end (the run's start among them) first, then a
 * wall's middle or a crossing of two walls, then a crossing of two guides; then
 * a wall the held direction runs into (or the square foot on a wall near the
 * cursor); then a guide the held direction runs into, so the run lines up with
 * its start or another wall's end; then the grid length. `free` (Alt, or
 * snapping off) leaves the end at the cursor.
 */
export function snapWallPullPoint(input: WallPullSnapInput): WallPullSnapResult {
  const { point: cursor, start, runStart, walls, gridStep } = input
  const radii = { ...WALL_PULL_SNAP_RADII, ...input.radii }
  const reference = input.reference ? unit(input.reference) : null
  const extension = reference ? extensionGuide(start, reference, cursor) : null
  const extensionLine: GuideLine | null = reference
    ? { kind: 'extension', anchor: [start[0], start[1]], direction: reference }
    : null
  const baseGuides = extension ? [extension] : []
  const result = (
    point: WallPlanPoint,
    snap: WallPullSnapKind | null,
    lock: WallPullDirectionLock,
    extra: Partial<Pick<WallPullSnapResult, 'label' | 'targetWallIds' | 'guides'>> = {},
    intersections: WallPlanPoint[] = [],
  ): WallPullSnapResult => ({
    point: [point[0], point[1]],
    snap,
    label: extra.label ?? (snap ? WALL_PULL_SNAP_LABELS[snap] : null),
    lock,
    targetWallIds: extra.targetWallIds ?? [],
    guides: [...baseGuides, ...(extra.guides ?? [])],
    intersections,
  })

  const vector: WallPlanPoint = [cursor[0] - start[0], cursor[1] - start[1]]
  if (input.free) return result(cursor, null, 'free')
  if (Math.hypot(vector[0], vector[1]) < 1e-6) return result(start, null, 'free')

  // The held direction, and the length along it.
  const { direction, lock } = lockWallPullDirection(vector, reference)
  const along = vector[0] * direction[0] + vector[1] * direction[1]
  const length = gridStep > 0 ? Math.round(along / gridStep) * gridStep : along
  const held: WallPlanPoint = [start[0] + direction[0] * length, start[1] + direction[1] * length]

  const anchors = guideAnchors(walls, runStart, start)
  const lines = nearbyGuideLines(anchors, cursor, radii.guide)
  const allLines = extensionLine ? [extensionLine, ...lines] : lines
  // Guide crossings near the cursor, each with the two lines through it.
  const crossings: Array<{ point: WallPlanPoint; a: GuideLine; b: GuideLine }> = []
  for (let i = 0; i < allLines.length; i += 1) {
    for (let j = i + 1; j < allLines.length; j += 1) {
      const a = allLines[i]!
      const b = allLines[j]!
      const point = crossLines(a, b)
      if (!point || samePoint(point, start, 1e-4)) continue
      if (distanceSquared(point, cursor) > INTERSECTION_SHOW_RADIUS ** 2) continue
      if (crossings.some((crossing) => samePoint(crossing.point, point, 1e-4))) continue
      crossings.push({ point, a, b })
    }
  }
  const intersections = crossings.map((crossing) => crossing.point)
  // The guides the final point sits on, then those through each crossing
  // shown, drawn from their anchors — each line once.
  const guidesThrough = (point: WallPlanPoint) => {
    const drawn = new Set<GuideLine>()
    const guides: WallPullGuide[] = []
    for (const line of lines) {
      if (!passesThrough(line, point) || samePoint(line.anchor, point, 1e-4)) continue
      drawn.add(line)
      guides.push(guideThrough(line, point))
    }
    for (const crossing of crossings) {
      for (const line of [crossing.a, crossing.b]) {
        if (line.kind === 'extension' || drawn.has(line)) continue
        drawn.add(line)
        guides.push(guideThrough(line, crossing.point))
      }
    }
    return guides
  }
  const settle = (
    point: WallPlanPoint,
    snap: WallPullSnapKind,
    pointLock: WallPullDirectionLock,
    extra: Partial<Pick<WallPullSnapResult, 'label' | 'targetWallIds' | 'guides'>> = {},
  ) =>
    result(
      point,
      snap,
      pointLock,
      { ...extra, guides: extra.guides ?? guidesThrough(point) },
      intersections,
    )

  // 1. A wall end, the run's start among them.
  let endpoint: WallPlanPoint | null = null
  let endpointDistance = radii.endpoint ** 2
  for (const anchor of anchors) {
    const distance = distanceSquared(anchor.point, cursor)
    if (distance <= endpointDistance) {
      endpoint = anchor.point
      endpointDistance = distance
    }
  }
  if (endpoint) {
    return settle(endpoint, 'endpoint', 'free', {
      targetWallIds: wallIdsAtSnapPoint(endpoint, [...walls]),
    })
  }

  // 2. A wall's middle, or where two walls cross.
  const special = findWallSpecialPointSnap(cursor, [...walls], undefined, {
    endpoint: 0,
    midpoint: radii.special,
    intersection: radii.special,
  })
  if (special && special.snap !== 'endpoint' && !samePoint(special.point, start, 1e-4)) {
    return settle(special.point, special.snap ?? 'midpoint', 'free', {
      targetWallIds: special.targetWallIds,
    })
  }

  // 3. Where two guides cross.
  let crossing: (typeof crossings)[number] | null = null
  let crossingDistance = radii.intersection ** 2
  for (const candidate of crossings) {
    const distance = distanceSquared(candidate.point, cursor)
    if (distance <= crossingDistance) {
      crossing = candidate
      crossingDistance = distance
    }
  }
  if (crossing) return settle(crossing.point, 'intersection', 'free')

  // 4. A wall the held direction runs into: its body, its line near the held
  // length, or the square foot on a wall line near the cursor.
  const wallLines = straightWallLines(walls)
  const onWall = (point: WallPlanPoint, pointLock: WallPullDirectionLock) => {
    const targetWallIds = wallIdsAtSnapPoint(point, [...walls])
    const atEnd = walls.some(
      (wall) => samePoint(point, wall.start, 1e-6) || samePoint(point, wall.end, 1e-6),
    )
    const segment: WallPlanPoint = [point[0] - start[0], point[1] - start[1]]
    const square = wallLines.some(
      (line) => targetWallIds.includes(line.wall.id) && meetsSquare(segment, line),
    )
    return settle(point, atEnd ? 'endpoint' : square ? 'perpendicular' : 'wall', pointLock, {
      targetWallIds,
    })
  }
  if (length > ON_LINE) {
    const body = findWallBodySnapTarget(cursor, [...walls], {
      placed: held,
      start,
      margin: WALL_CONNECT_SNAP_RADIUS,
    })
    if (body && !samePoint(body, start, 1e-4)) return onWall(body, lock)
  }
  let rayHit: WallPlanPoint | null = null
  let rayHitGap = radii.wall
  for (const line of wallLines) {
    const denom = direction[0] * line.uz - direction[1] * line.ux
    if (Math.abs(denom) < 1e-9) continue
    const dx = line.wall.start[0] - start[0]
    const dz = line.wall.start[1] - start[1]
    const t = (dx * line.uz - dz * line.ux) / denom
    const s = (dx * direction[1] - dz * direction[0]) / denom
    if (!(t > 1e-4) || s <= 1e-6 || s >= line.length - 1e-6) continue
    const gap = Math.abs(t - along)
    if (gap <= rayHitGap) {
      rayHit = [start[0] + direction[0] * t, start[1] + direction[1] * t]
      rayHitGap = gap
    }
  }
  if (rayHit) return onWall(rayHit, lock)
  let foot: WallPlanPoint | null = null
  let footDistance = radii.wall ** 2
  for (const line of wallLines) {
    const station =
      (start[0] - line.wall.start[0]) * line.ux + (start[1] - line.wall.start[1]) * line.uz
    if (station <= 1e-6 || station >= line.length - 1e-6) continue
    const point: WallPlanPoint = [
      line.wall.start[0] + line.ux * station,
      line.wall.start[1] + line.uz * station,
    ]
    if (samePoint(point, start, 1e-4)) continue
    const distance = distanceSquared(point, cursor)
    if (distance <= footDistance) {
      foot = point
      footDistance = distance
    }
  }
  if (foot) return onWall(foot, 'free')

  // 5. A guide the held direction runs into.
  let aligned: { point: WallPlanPoint; line: GuideLine } | null = null
  let alignedGap = radii.alignment
  for (const line of lines) {
    const t = rayStationOnLine(start, direction, line)
    if (t === null) continue
    const gap = Math.abs(t - along)
    if (gap <= alignedGap) {
      aligned = { point: [start[0] + direction[0] * t, start[1] + direction[1] * t], line }
      alignedGap = gap
    }
  }
  if (aligned) {
    return settle(aligned.point, 'alignment', lock, {
      label: aligned.line.kind === 'run-start' ? 'In line with start' : undefined,
    })
  }

  // 6. The grid length along the held direction.
  if (gridStep > 0) return settle(held, 'grid', lock)
  return result(held, null, lock, { guides: guidesThrough(held) }, intersections)
}
