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
