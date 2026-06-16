import type { Vec3 } from './primitive-compose'

export function radialExtrudeRotationInHorizontalPlane(angle: number, pitch = 0): Vec3 {
  return [-Math.PI / 2 + pitch, 0, -angle]
}

export function radialExtrudeRotationInLocalPlane(angle: number, pitch = 0): Vec3 {
  return [pitch, 0, angle]
}

export function transformedLocalAxis(rotation: Vec3, axis: 'x' | 'y' | 'z'): Vec3 {
  const [rx, ry, rz] = rotation
  const sx = Math.sin(rx)
  const cx = Math.cos(rx)
  const sy = Math.sin(ry)
  const cy = Math.cos(ry)
  const sz = Math.sin(rz)
  const cz = Math.cos(rz)
  const vector: Vec3 = axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1]

  const afterZ: Vec3 = [vector[0] * cz - vector[1] * sz, vector[0] * sz + vector[1] * cz, vector[2]]
  const afterY: Vec3 = [
    afterZ[0] * cy + afterZ[2] * sy,
    afterZ[1],
    -afterZ[0] * sy + afterZ[2] * cy,
  ]
  return [afterY[0], afterY[1] * cx - afterY[2] * sx, afterY[1] * sx + afterY[2] * cx]
}

export function normalizedRadialDirection(angle: number): Vec3 {
  return [Math.cos(angle), 0, Math.sin(angle)]
}

export function angularStep(index: number, count: number, startAngle = 0): number {
  return startAngle + (index * Math.PI * 2) / Math.max(1, count)
}
