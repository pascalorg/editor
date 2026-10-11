import { type CameraPose, criticallyDamped } from '@pascal-app/core'

/**
 * Follow Pascal: the camera follows what the agent is building (the owner, 2026-10-08). It eases to
 * what the current step works on, at the distance its scale needs; stays about 1.5 s on each target at
 * least; frames what lands together as one; keeps the horizon level (it moves as an orbit about the
 * thing it looks at, never as a free flight); and moves like a critically damped spring.
 *
 * Everything here is arithmetic on boxes and angles, so it is tested without a canvas; the component
 * that feeds it the reveal's events and writes its poses to the camera is `FollowPascal`.
 */

export type Vec3 = [number, number, number]
export type Box = { min: Vec3; max: Vec3 }

/** What kind of thing a step works on decides how far and from how high it is looked at. */
export type FollowKind = 'floor' | 'detail' | 'roof' | 'furnish' | 'group'

export type FollowWant = {
  box: Box
  kind: FollowKind
  /** The outward direction of the wall it is on, in the plan (x, z), for what is looked at square on. */
  normal?: [number, number]
  /** The eye must stand above this height (metres): a roof lifted out of the way is looked down through, not from within. */
  eyeAbove?: number
  /** When it was asked for, in seconds on the follower's clock. */
  at: number
}

/** The camera stays on a target at least this long. */
export const FOLLOW_DWELL_S = 1.5
/** What lands within this of the first is framed with it. */
export const FOLLOW_GATHER_S = 0.35
/** How long a flight takes: a spring's response, not a duration. */
export const FOLLOW_RESPONSE_S = 1.1

/** The eye's elevation above the horizon for each kind, in radians. */
export const FOLLOW_ELEVATION: Record<FollowKind, number> = {
  floor: 0.5,
  detail: 0.27,
  roof: 0.61,
  furnish: 0.92,
  group: 0.45,
}

const centreOf = ({ min, max }: Box): Vec3 => [
  (min[0] + max[0]) / 2,
  (min[1] + max[1]) / 2,
  (min[2] + max[2]) / 2,
]
const sizeOf = ({ min, max }: Box): Vec3 => [max[0] - min[0], max[1] - min[1], max[2] - min[2]]

/** What lands together, as one target: the union of their boxes, a common direction if they share one. */
export function mergeWants(wants: readonly FollowWant[]): FollowWant {
  const first = wants[0]!
  const min: Vec3 = [...first.box.min]
  const max: Vec3 = [...first.box.max]
  for (const { box } of wants) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, box.min[axis]!)
      max[axis] = Math.max(max[axis]!, box.max[axis]!)
    }
  }
  const kind = wants.every((want) => want.kind === first.kind) ? first.kind : 'group'
  let normal: [number, number] | undefined
  if (wants.every((want) => want.normal)) {
    const sum: [number, number] = [0, 0]
    for (const want of wants) {
      sum[0] += want.normal![0]
      sum[1] += want.normal![1]
    }
    const length = Math.hypot(sum[0], sum[1])
    // They share a direction only when they mostly agree: the length of the sum over their count.
    if (length / wants.length > 0.6) normal = [sum[0] / length, sum[1] / length]
  }
  const eyes = wants.flatMap((want) => (want.eyeAbove === undefined ? [] : [want.eyeAbove]))
  return {
    box: { min, max },
    kind,
    ...(normal ? { normal } : {}),
    ...(eyes.length ? { eyeAbove: Math.max(...eyes) } : {}),
    at: Math.max(...wants.map((want) => want.at)),
  }
}

/**
 * Decides when the camera changes target. Wants are gathered for a moment so things landing together
 * are framed as one, and the camera never leaves a target before its dwell is over.
 */
export class Follower {
  private pending: FollowWant[] = []
  private last = Number.NEGATIVE_INFINITY

  want(want: FollowWant): void {
    this.pending.push(want)
  }

  /** The target to fly to now, if one is due. `blocked` holds it (the person is pointing at something). */
  due(now: number, blocked = false): FollowWant | null {
    const oldest = this.pending[0]
    if (!oldest || blocked) return null
    if (now - this.last < FOLLOW_DWELL_S || now - oldest.at < FOLLOW_GATHER_S) return null
    const merged = mergeWants(this.pending)
    this.pending = []
    this.last = now
    return merged
  }

  /** Forgets what waits and starts its dwell over (a new build; the person took the camera back). */
  reset(): void {
    this.pending = []
    this.last = Number.NEGATIVE_INFINITY
  }
}

export type OrbitValue = { x: number; y: number; z: number; r: number; az: number; el: number }

export type FollowView = {
  /** The camera's vertical field of view, in degrees. */
  fov: number
  /** The canvas' width over its height. */
  aspect: number
  /** Where the camera looks from now, so a flight takes the nearest way round. */
  azimuth: number
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
const TAU = Math.PI * 2

/** The angle `to` written as the nearest equivalent of `from`, so it never goes the long way round. */
export function nearestTurn(to: number, from: number): number {
  let angle = to
  while (angle - from > Math.PI) angle -= TAU
  while (angle - from < -Math.PI) angle += TAU
  return angle
}

/**
 * Where the camera stands to see `want`: the box's centre, its scale decides how far (a window up
 * close, a floor whole, a group between) at the elevation of its kind, from the side nearest the way
 * it already looks, or square to the wall it is on.
 */
export function frameOf(want: FollowWant, view: FollowView): OrbitValue {
  const [cx, cy, cz] = centreOf(want.box)
  const [sx, sy, sz] = sizeOf(want.box)
  const detail = want.kind === 'detail'
  const extent = Math.max(sx, sz, sy * 1.4, detail ? 1.2 : 3)
  const halfVertical = (view.fov * Math.PI) / 360
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * Math.max(0.5, view.aspect))
  const fits = (extent * 0.5) / Math.tan(Math.min(halfVertical, halfHorizontal))
  let r = clamp(fits * 1.25 + sy * 0.3, detail ? 2.8 : 6, 90)
  const el = FOLLOW_ELEVATION[want.kind]
  const eyeY = Math.max(cy, 0.9) + r * Math.sin(el)
  if (want.eyeAbove !== undefined && eyeY < want.eyeAbove) {
    // Further back along the same line of sight, until the eye is above what it must clear.
    r = (want.eyeAbove - Math.max(cy, 0.9)) / Math.sin(el)
  }
  let az = view.azimuth
  if (want.normal) {
    const facing = Math.atan2(want.normal[0], want.normal[1])
    // A little off square, to the side it is already seen from.
    const [left, right] = [facing + 0.5, facing - 0.5]
    az =
      Math.abs(nearestTurn(left, view.azimuth) - view.azimuth) <=
      Math.abs(nearestTurn(right, view.azimuth) - view.azimuth)
        ? left
        : right
  }
  return {
    x: cx,
    y: want.kind === 'roof' ? cy - 0.6 : Math.max(cy, 0.9),
    z: cz,
    r,
    az: nearestTurn(az, view.azimuth),
    el,
  }
}

const KEYS = ['x', 'y', 'z', 'r', 'az', 'el'] as const

/** The camera as six springs on an orbit: the point it looks at, how far, and which way round. */
export class OrbitSpring {
  private states = Object.fromEntries(KEYS.map((key) => [key, { x: 0, v: 0 }])) as Record<
    (typeof KEYS)[number],
    { x: number; v: number }
  >
  private goal: OrbitValue

  constructor(
    start: OrbitValue,
    private response = FOLLOW_RESPONSE_S,
  ) {
    this.goal = { ...start }
    this.snap(start)
  }

  snap(value: OrbitValue): void {
    this.goal = { ...value }
    for (const key of KEYS) this.states[key] = { x: value[key], v: 0 }
  }

  /** Flies to `value`, from where it is, carrying its speed. */
  to(value: OrbitValue): void {
    this.goal = { ...value, az: nearestTurn(value.az, this.states.az.x) }
  }

  step(dt: number): void {
    for (const key of KEYS) criticallyDamped(this.states[key], this.goal[key], this.response, dt)
  }

  value(): OrbitValue {
    return Object.fromEntries(KEYS.map((key) => [key, this.states[key].x])) as OrbitValue
  }

  /** The orbit read off a camera that is already somewhere. */
  fromPose(pose: CameraPose): void {
    const dx = pose.position[0] - pose.target[0]
    const dy = pose.position[1] - pose.target[1]
    const dz = pose.position[2] - pose.target[2]
    const r = Math.hypot(dx, dy, dz) || 1
    this.snap({
      x: pose.target[0],
      y: pose.target[1],
      z: pose.target[2],
      r,
      az: Math.atan2(dx, dz),
      el: Math.asin(clamp(dy / r, -1, 1)),
    })
  }

  /** Where the camera is now: at the radius and angles about its centre, always looking at it, level. */
  pose(): CameraPose {
    const { x, y, z, r, az, el } = this.value()
    const flat = Math.cos(el)
    return {
      position: [x + r * flat * Math.sin(az), y + r * Math.sin(el), z + r * flat * Math.cos(az)],
      target: [x, y, z],
      projection: 'perspective',
    }
  }

  /** The goal it is flying to. */
  destination(): OrbitValue {
    return { ...this.goal }
  }
}
