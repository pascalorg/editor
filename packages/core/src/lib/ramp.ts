import { refuse } from '../agent-tools/refusal'
import { RampNode } from '../schema/nodes/ramp'
import { segmentsIntersect } from './polygon-relations'

export type RampPoint = [number, number]
export type RampStation = {
  point: RampPoint
  tangent: RampPoint
  distance: number
  height: number
}
type Piece = {
  start: RampPoint
  end: RampPoint
  at: number
  length: number
  center?: RampPoint
  angle: number
  sweep: number
  radius: number
}
type Path = { pieces: Piece[]; length: number; grade: number }
const MAX_STATIONS = 2048
const EPS = 1e-8
const TANGENT_TOLERANCE_RADIANS = 1e-6
const paths = new WeakMap<RampNode, Path>()
const gap = (a: RampPoint, b: RampPoint) => Math.hypot(a[0] - b[0], a[1] - b[1])

function pieceOf(start: RampPoint, segment: RampNode['segments'][number], at: number): Piece {
  if (segment.type === 'line') {
    const length = gap(start, segment.end)
    if (length <= EPS) refuse('ramp_degenerate', 'A ramp line needs distinct endpoints.')
    return {
      start,
      end: segment.end,
      at,
      length,
      angle: Math.atan2(segment.end[1] - start[1], segment.end[0] - start[0]),
      sweep: 0,
      radius: 0,
    }
  }
  const radius = gap(start, segment.center)
  if (radius <= EPS || Math.abs(segment.sweep) <= EPS)
    refuse('ramp_degenerate', 'A ramp arc needs a nonzero radius and sweep.')
  if (Math.abs(segment.sweep) >= Math.PI * 2 - EPS)
    refuse(
      'ramp_self_intersection',
      'A full-circle ramp stacks its corridor; use a nonintersecting path.',
    )
  const angle = Math.atan2(start[1] - segment.center[1], start[0] - segment.center[0])
  const end: RampPoint = [
    segment.center[0] + radius * Math.cos(angle + segment.sweep),
    segment.center[1] + radius * Math.sin(angle + segment.sweep),
  ]
  return {
    start,
    end,
    at,
    center: segment.center,
    angle,
    sweep: segment.sweep,
    radius,
    length: radius * Math.abs(segment.sweep),
  }
}

function pathOf(ramp: RampNode): Path {
  const cached = paths.get(ramp)
  if (cached) return cached
  const parsed = RampNode.safeParse(ramp)
  if (!parsed.success) refuse('invalid_input', parsed.error.message)
  let start = ramp.start
  let length = 0
  const pieces = ramp.segments.map((segment) => {
    const piece = pieceOf(start, segment, length)
    const halfEnvelope = ramp.width / 2 + (ramp.retainingHeight > 0 ? 0.2 : 0)
    if (piece.center && piece.radius <= halfEnvelope)
      refuse(
        'ramp_inner_radius',
        'The arc inner radius must clear half the ramp width and any retaining side.',
      )
    start = piece.end
    length += piece.length
    return piece
  })
  const transition = ramp.startTransition + ramp.endTransition
  if (transition > length)
    refuse(
      'ramp_transition_overlap',
      'Ramp transitions cannot overlap; shorten them or lengthen the path.',
    )
  const grade = (ramp.endHeight - ramp.startHeight) / (length - transition / 2)
  if (![length, grade * 100, ramp.endHeight - ramp.startHeight, ...start].every(Number.isFinite))
    refuse('ramp_non_finite', 'The ramp length, endpoint and grade must be finite.')
  const path = { pieces, length, grade }
  requireSimpleCorridor(ramp, path)
  requireTangentJoints(path)
  paths.set(ramp, path)
  return path
}

function frameAt(piece: Piece, distance: number): { point: RampPoint; tangent: RampPoint } {
  const t = Math.max(0, Math.min(1, (distance - piece.at) / piece.length))
  if (!piece.center)
    return {
      point:
        t === 0
          ? piece.start
          : t === 1
            ? piece.end
            : [
                piece.start[0] * (1 - t) + piece.end[0] * t,
                piece.start[1] * (1 - t) + piece.end[1] * t,
              ],
      tangent: [Math.cos(piece.angle), Math.sin(piece.angle)],
    }
  const angle = piece.angle + piece.sweep * t
  const sign = Math.sign(piece.sweep)
  return {
    point:
      t === 0
        ? piece.start
        : t === 1
          ? piece.end
          : [
              piece.center[0] + piece.radius * Math.cos(angle),
              piece.center[1] + piece.radius * Math.sin(angle),
            ],
    tangent: [-Math.sin(angle) * sign, Math.cos(angle) * sign],
  }
}

function requireTangentJoints(path: Path): void {
  for (let index = 1; index < path.pieces.length; index++) {
    const previous = path.pieces[index - 1]
    const next = path.pieces[index]
    if (!previous || !next) continue
    const incoming = frameAt(previous, previous.at + previous.length).tangent
    const outgoing = frameAt(next, next.at).tangent
    const angle = Math.abs(
      Math.atan2(
        incoming[0] * outgoing[1] - incoming[1] * outgoing[0],
        incoming[0] * outgoing[0] + incoming[1] * outgoing[1],
      ),
    )
    if (angle > TANGENT_TOLERANCE_RADIANS)
      refuse('ramp_joint_not_tangent', 'Ramp segments must meet with a tangent transition.', {
        jointIndex: index,
        angleDegrees: (angle * 180) / Math.PI,
        toleranceRadians: TANGENT_TOLERANCE_RADIANS,
        incoming,
        outgoing,
      })
  }
}

function heightOn(ramp: RampNode, path: Path, distance: number): number {
  const d = Math.max(0, Math.min(path.length, distance))
  const startTransition = ramp.startTransition,
    endTransition = ramp.endTransition
  const effective = path.length - (startTransition + endTransition) / 2
  if (d === path.length) return ramp.endHeight
  let weight = (d - startTransition / 2) / effective
  if (startTransition > 0 && d < startTransition)
    weight = (d * (d / startTransition)) / 2 / effective
  if (endTransition > 0 && d > path.length - endTransition) {
    const remaining = path.length - d
    weight = 1 - (remaining * (remaining / endTransition)) / 2 / effective
  }
  return ramp.startHeight * (1 - weight) + ramp.endHeight * weight
}

function distances(path: Path, step: number): number[] {
  const counts = path.pieces.map((piece) =>
    Math.max(1, Math.ceil(piece.length / step), Math.ceil(Math.abs(piece.sweep) / (Math.PI / 36))),
  )
  if (counts.reduce((sum, count) => sum + count, 1) > MAX_STATIONS)
    refuse(
      'ramp_sampling_limit',
      `A ramp is limited to ${MAX_STATIONS} stations; simplify it or increase the station step.`,
    )
  return [
    0,
    ...path.pieces.flatMap((piece, index) => {
      const count = counts[index] ?? 1
      return Array.from({ length: count }, (_, i) => piece.at + (piece.length * (i + 1)) / count)
    }),
  ]
}

function stationsOn(ramp: RampNode, path: Path, step: number): RampStation[] {
  const candidates = [
    ...distances(path, step),
    ramp.startTransition,
    path.length - ramp.endTransition,
  ].sort((a, b) => a - b)
  const ds: number[] = []
  for (const distance of candidates) {
    const previous = ds.at(-1)
    if (previous === undefined || distance - previous > EPS) ds.push(distance)
    else if (distance === path.length) ds[ds.length - 1] = distance
  }
  if (ds.length > MAX_STATIONS)
    refuse('ramp_sampling_limit', 'Ramp transitions exceed the station budget.')
  return ds.map((distance) => {
    const piece =
      path.pieces.find((candidate) => distance <= candidate.at + candidate.length + EPS) ??
      path.pieces.at(-1)
    if (!piece) refuse('ramp_degenerate', 'A ramp needs at least one usable segment.')
    const frame = frameAt(piece, distance)
    const next = path.pieces[path.pieces.indexOf(piece) + 1]
    if (next && Math.abs(distance - next.at) <= EPS) {
      const outgoing = frameAt(next, distance).tangent
      const x = frame.tangent[0] + outgoing[0],
        z = frame.tangent[1] + outgoing[1]
      const norm = Math.hypot(x, z)
      if (norm <= EPS)
        refuse('ramp_self_intersection', 'A ramp cannot reverse direction at a joint.')
      frame.tangent = [x / norm, z / norm]
    }
    return { ...frame, distance, height: heightOn(ramp, path, distance) }
  })
}

export function rampOffsetPoint(station: RampStation, offset: number): RampPoint {
  return [
    station.point[0] - station.tangent[1] * offset,
    station.point[1] + station.tangent[0] * offset,
  ]
}

function requireSimpleCorridor(ramp: RampNode, path: Path): void {
  const stations = stationsOn(ramp, path, Math.max(0.5, path.length / 1000))
  const half = ramp.width / 2 + (ramp.retainingHeight > 0 ? 0.2 : 0)
  const ring = [
    ...stations.map((station) => rampOffsetPoint(station, half)),
    ...[...stations].reverse().map((station) => rampOffsetPoint(station, -half)),
  ]
  if (ring.some((point) => !point.every(Number.isFinite)))
    refuse('ramp_non_finite', 'Ramp corridor coordinates must be finite.')
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length]
    if (!a || !b) continue
    for (let j = i + 2; j < ring.length; j++) {
      if (i === 0 && j === ring.length - 1) continue
      const c = ring[j],
        d = ring[(j + 1) % ring.length]
      if (!c || !d) continue
      if (
        Math.max(a[0], b[0]) < Math.min(c[0], d[0]) ||
        Math.max(c[0], d[0]) < Math.min(a[0], b[0]) ||
        Math.max(a[1], b[1]) < Math.min(c[1], d[1]) ||
        Math.max(c[1], d[1]) < Math.min(a[1], b[1])
      )
        continue
      if (segmentsIntersect(a, b, c, d))
        refuse('ramp_self_intersection', 'Ramp corridors cannot intersect or stack in plan.')
    }
  }
}

/** Exact centreline plan length; arc lengths do not depend on rendering resolution. */
export function rampLength(ramp: RampNode): number {
  return pathOf(ramp).length
}

/** Practical creation defaults, not a persisted geometric constraint. */
export function rampDefaultTransitionLength(ramp: RampNode): number {
  return Math.min(1.5, rampLength(ramp) / 4)
}

/** Linear-grade transitions integrate to the authored endpoint height exactly. */
export function rampHeightAt(ramp: RampNode, distance: number): number {
  if (!Number.isFinite(distance)) refuse('ramp_non_finite', 'Ramp station distance must be finite.')
  return heightOn(ramp, pathOf(ramp), distance)
}

/**
 * The station step at which a plan chord of the corridor's edge stays within `sagM` of the true
 * curve: the default step on a gentle arc, finer on a tight one. The outer edge runs on the
 * larger circle, so its chord is the longest for the same centreline step.
 */
export function rampStepForSag(ramp: RampNode, sagM: number): number {
  const path = pathOf(ramp)
  let step = Math.max(0.5, path.length / 1000)
  for (const piece of path.pieces) {
    if (!piece.center) continue
    const outer = piece.radius + ramp.width / 2
    step = Math.min(step, piece.radius * Math.sqrt((8 * sagM) / outer))
  }
  return Math.max(step, path.length / 1500)
}

export function rampStations(ramp: RampNode, stepM?: number): RampStation[] {
  const path = pathOf(ramp)
  const step = stepM ?? Math.max(0.5, path.length / 1000)
  if (!Number.isFinite(step) || step <= 0)
    refuse('invalid_input', 'Ramp station step must be positive and finite.')
  return stationsOn(ramp, path, step)
}

export function rampMaximumSlopePercent(ramp: RampNode): number {
  const path = pathOf(ramp)
  const centreline = Math.abs(path.grade) * 100
  const at = (distance: number) =>
    Math.min(
      ramp.startTransition > 0 ? distance / ramp.startTransition : 1,
      ramp.endTransition > 0 ? (path.length - distance) / ramp.endTransition : 1,
      1,
    )
  const maximum = Math.max(
    ...path.pieces.map((piece) => {
      const from = piece.at,
        to = from + piece.length
      const local = Math.max(
        at(from),
        at(to),
        at(Math.max(from, Math.min(to, ramp.startTransition))),
      )
      return (
        centreline * local * (piece.center ? piece.radius / (piece.radius - ramp.width / 2) : 1)
      )
    }),
  )
  if (!Number.isFinite(maximum)) refuse('ramp_non_finite', 'Ramp edge grades must be finite.')
  return maximum
}

export function rampCentrelineMaximumSlopePercent(ramp: RampNode): number {
  return Math.abs(pathOf(ramp).grade) * 100
}

/** Flat-capped corridor bounds include exact circular extrema, not just tessellation vertices. */
export function rampBounds(ramp: RampNode, includeRetaining = false) {
  const path = pathOf(ramp)
  const half = ramp.width / 2 + (includeRetaining && ramp.retainingHeight > 0 ? 0.2 : 0)
  const points = path.pieces.flatMap((piece) => {
    const ends = [frameAt(piece, piece.at), frameAt(piece, piece.at + piece.length)]
    const points = ends.flatMap((end) => [
      rampOffsetPoint({ ...end, distance: 0, height: 0 }, half),
      rampOffsetPoint({ ...end, distance: 0, height: 0 }, -half),
    ])
    if (piece.center)
      for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        const sweep =
          (((Math.sign(piece.sweep) * (angle - piece.angle)) % (Math.PI * 2)) + Math.PI * 2) %
          (Math.PI * 2)
        if (sweep <= Math.abs(piece.sweep))
          for (const radius of [piece.radius - half, piece.radius + half])
            points.push([
              piece.center[0] + radius * Math.cos(angle),
              piece.center[1] + radius * Math.sin(angle),
            ])
      }
    return points
  })
  for (const station of stationsOn(ramp, path, path.length)) {
    points.push(rampOffsetPoint(station, half), rampOffsetPoint(station, -half))
  }
  const bounds = {
    minX: Math.min(...points.map(([x]) => x)),
    maxX: Math.max(...points.map(([x]) => x)),
    minZ: Math.min(...points.map(([, z]) => z)),
    maxZ: Math.max(...points.map(([, z]) => z)),
  }
  if (!Object.values(bounds).every(Number.isFinite))
    refuse('ramp_non_finite', 'Ramp corridor bounds must be finite.')
  return bounds
}

/** Analytic nearest centreline station, with flat end caps for terrain grading. */
export function rampProjectPoint(
  ramp: RampNode,
  point: RampPoint,
): { distance: number; lateral: number; inside: boolean } {
  if (!point.every(Number.isFinite))
    refuse('ramp_non_finite', 'A ramp projection point must be finite.')
  const path = pathOf(ramp)
  let best = { distance: 0, lateral: Infinity, inside: false }
  for (const piece of path.pieces) {
    let t: number
    if (piece.center) {
      const angle = Math.atan2(point[1] - piece.center[1], point[0] - piece.center[0])
      const directed =
        (((Math.sign(piece.sweep) * (angle - piece.angle)) % (Math.PI * 2)) + Math.PI * 2) %
        (Math.PI * 2)
      t = directed / Math.abs(piece.sweep)
      if (t > 1) t = gap(point, piece.start) < gap(point, piece.end) ? 0 : 1
    } else {
      const dx = piece.end[0] - piece.start[0],
        dz = piece.end[1] - piece.start[1]
      t =
        ((point[0] - piece.start[0]) / piece.length) * (dx / piece.length) +
        ((point[1] - piece.start[1]) / piece.length) * (dz / piece.length)
    }
    const distance = piece.at + Math.max(0, Math.min(1, t)) * piece.length
    const frame = frameAt(piece, distance)
    const dx = point[0] - frame.point[0],
      dz = point[1] - frame.point[1]
    const lateral = Math.hypot(dx, dz)
    const along = dx * frame.tangent[0] + dz * frame.tangent[1]
    const capped =
      (distance <= EPS && along < -EPS) || (distance >= path.length - EPS && along > EPS)
    if (lateral < best.lateral)
      best = { distance, lateral, inside: !capped && lateral <= ramp.width / 2 + EPS }
  }
  if (!Number.isFinite(best.lateral))
    refuse('ramp_non_finite', 'The point cannot be projected onto a finite ramp station.')
  return best
}
