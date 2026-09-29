import type { Vec3 } from './recipe'

export type Frame = { position: Vec3; axes: [Vec3, Vec3, Vec3] }
export type Bounds = { min: Vec3; max: Vec3; dimensions: Vec3 }
export const IDENTITY_FRAME: Frame = {
  position: [0, 0, 0],
  axes: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
}
export function rotateVector([x, y, z]: Vec3, [rx, ry, rz]: Vec3): Vec3 {
  const x1 = x * Math.cos(rz) - y * Math.sin(rz),
    y1 = x * Math.sin(rz) + y * Math.cos(rz)
  const x2 = x1 * Math.cos(ry) + z * Math.sin(ry),
    z2 = -x1 * Math.sin(ry) + z * Math.cos(ry)
  return [x2, y1 * Math.cos(rx) - z2 * Math.sin(rx), y1 * Math.sin(rx) + z2 * Math.cos(rx)]
}
export function frame(position: Vec3, rotation: Vec3 = [0, 0, 0]): Frame {
  return {
    position,
    axes: IDENTITY_FRAME.axes.map((v) => rotateVector(v, rotation)) as Frame['axes'],
  }
}
export function direction(f: Frame, p: Vec3): Vec3 {
  return [0, 1, 2].map(
    (i) => f.axes[0][i]! * p[0] + f.axes[1][i]! * p[1] + f.axes[2][i]! * p[2],
  ) as Vec3
}
export function transformPoint(f: Frame, p: Vec3): Vec3 {
  return direction(f, p).map((v, i) => v + f.position[i]!) as Vec3
}
export function composeFrames(a: Frame, b: Frame): Frame {
  return {
    position: transformPoint(a, b.position),
    axes: b.axes.map((v) => direction(a, v)) as Frame['axes'],
  }
}
export function boundsOf(points: Vec3[]): Bounds {
  const min = [0, 1, 2].map((i) => Math.min(...points.map((p) => p[i]!))) as Vec3
  const max = [0, 1, 2].map((i) => Math.max(...points.map((p) => p[i]!))) as Vec3
  return { min, max, dimensions: max.map((v, i) => v - min[i]!) as Vec3 }
}
export function boxCorners(min: Vec3, max: Vec3): Vec3[] {
  return [min[0], max[0]].flatMap((x) =>
    [min[1], max[1]].flatMap((y) => [min[2], max[2]].map((z) => [x, y, z] as Vec3)),
  )
}

/** Row-major 3 × 3 rotation and a translation: p' = r · p + t. */
export type Pose = { r: number[]; t: Vec3 }
export const IDENTITY_POSE: Pose = { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] }
function multiply(a: number[], b: number[]) {
  const m: number[] = []
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      m.push(a[3 * i]! * b[j]! + a[3 * i + 1]! * b[3 + j]! + a[3 * i + 2]! * b[6 + j]!)
  return m
}
function apply(r: number[], [x, y, z]: Vec3): Vec3 {
  return [
    r[0]! * x + r[1]! * y + r[2]! * z,
    r[3]! * x + r[4]! * y + r[5]! * z,
    r[6]! * x + r[7]! * y + r[8]! * z,
  ]
}
/** The matrix of an XYZ Euler rotation, as `rotateVector` and three's Euler apply it. */
export function eulerMatrix(rotation: Vec3): number[] {
  return [0, 1, 2].flatMap((i) =>
    [0, 1, 2].map(
      (j) => rotateVector([0, 1, 2].map((k) => (k === j ? 1 : 0)) as Vec3, rotation)[i]!,
    ),
  )
}
/** XYZ Euler angles of a rotation matrix (three's Euler.setFromRotationMatrix, order XYZ). */
export function matrixEuler(r: number[]): Vec3 {
  const y = Math.asin(Math.max(-1, Math.min(1, r[2]!)))
  return Math.abs(r[2]!) < 0.9999999
    ? [Math.atan2(-r[5]!, r[8]!), y, Math.atan2(-r[1]!, r[0]!)]
    : [Math.atan2(r[7]!, r[4]!), y, 0]
}
/** Rotation by `angle` about the unit `axis` (Rodrigues). */
export function axisAngleMatrix([x, y, z]: Vec3, angle: number): number[] {
  const c = Math.cos(angle),
    s = Math.sin(angle),
    k = 1 - c
  return [
    c + x * x * k,
    x * y * k - z * s,
    x * z * k + y * s,
    y * x * k + z * s,
    c + y * y * k,
    y * z * k - x * s,
    z * x * k - y * s,
    z * y * k + x * s,
    c + z * z * k,
  ]
}
export function composePoses(a: Pose, b: Pose): Pose {
  return { r: multiply(a.r, b.r), t: apply(a.r, b.t).map((v, i) => v + a.t[i]!) as Vec3 }
}
export function posePoint(pose: Pose, point: Vec3): Vec3 {
  return apply(pose.r, point).map((v, i) => v + pose.t[i]!) as Vec3
}
export function poseDirection(pose: Pose, direction: Vec3): Vec3 {
  return apply(pose.r, direction)
}
/** A pose placed at `position` and turned by the XYZ Euler `rotation`. */
export function eulerPose(position: Vec3, rotation: Vec3 = [0, 0, 0]): Pose {
  return { r: eulerMatrix(rotation), t: position }
}
/** Rotation by `angle` about the line through `origin` along the unit `axis`. */
export function hingePose(origin: Vec3, axis: Vec3, angle: number): Pose {
  const r = axisAngleMatrix(axis, angle)
  return { r, t: origin.map((v, i) => v - apply(r, origin)[i]!) as Vec3 }
}

/**
 * The box a point sweeps while rotating by [from, to] about the line through `origin` along
 * the unit `axis`: each coordinate of the circle is c + u·cos θ + w·sin θ, extreme at its
 * endpoints or where tan θ = w/u.
 */
function sweptArc(point: Vec3, origin: Vec3, axis: Vec3, from: number, to: number) {
  const d = point.map((v, i) => v - origin[i]!) as Vec3
  const along = d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2]
  const c = axis.map((v, i) => origin[i]! + v * along) as Vec3
  const u = d.map((v, i) => v - axis[i]! * along) as Vec3
  const w: Vec3 = [
    axis[1] * u[2] - axis[2] * u[1],
    axis[2] * u[0] - axis[0] * u[2],
    axis[0] * u[1] - axis[1] * u[0],
  ]
  const [lo, hi] = from <= to ? [from, to] : [to, from]
  const angles = [lo, hi]
  for (let k = 0; k < 3; k++) {
    const base = Math.atan2(w[k]!, u[k]!)
    for (let turn = -4; turn <= 4; turn++) {
      const theta = base + turn * Math.PI
      if (theta > lo && theta < hi) angles.push(theta)
    }
  }
  return angles.map(
    (theta) => c.map((v, i) => v + u[i]! * Math.cos(theta) + w[i]! * Math.sin(theta)) as Vec3,
  )
}
/** Axis-aligned bounds of a box swept by a hinge over [from, to] radians. */
export function sweptHingeBounds(box: Bounds, origin: Vec3, axis: Vec3, from: number, to: number) {
  return boundsOf(
    boxCorners(box.min, box.max).flatMap((corner) => sweptArc(corner, origin, axis, from, to)),
  )
}
