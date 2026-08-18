import type { LeanToExtensionNode, Point2D } from '@pascal-app/core'

const CURVE_EPSILON = 1e-6

// The lean-to bends along the host wall's true circular arc. The arc is stored on
// the node as a center + radius in the lean-to's local frame (local X = along the
// span, local Z = outward/projection). Because the anchor frame is sampled at the
// span center, the arc center lies on the local Z axis at `spanArcCenterZ` (local
// X = 0); `spanArcRadius` is the wall's true radius, kept for reference/tests.
//
// A flat local point (fx, fz) is bent concentrically about O = (0, cz):
//   phi = fx / cz                     (arc-length preserved along the wall line fz=0)
//   x   = -(fz - cz) * sin(phi)
//   z   =  cz + (fz - cz) * cos(phi)
// This is exact for any arc extent and reduces to the identity at the crown, with
// +localX -> +local x for either sign of cz. When the node has no arc descriptor the
// helpers are the identity, so straight lean-tos are byte-for-byte unchanged.

export type LeanToArcLike = Pick<LeanToExtensionNode, 'spanArcCenterZ' | 'spanArcRadius'>

export type LeanToArcFrame = {
  point: Point2D
  tangent: Point2D
  normal: Point2D
  rotationY: number
}

export function isCurvedLeanTo(node: LeanToArcLike): boolean {
  const cz = node.spanArcCenterZ
  const radius = node.spanArcRadius
  return (
    cz != null &&
    Number.isFinite(cz) &&
    Math.abs(cz) > CURVE_EPSILON &&
    radius != null &&
    Number.isFinite(radius)
  )
}

// Map a straight local-frame point onto the bent strip.
export function bendLocalPoint(node: LeanToArcLike, localX: number, localZ: number): Point2D {
  if (!isCurvedLeanTo(node)) return { x: localX, y: localZ }
  const cz = node.spanArcCenterZ as number
  const phi = localX / cz
  const radial = localZ - cz
  return {
    x: -radial * Math.sin(phi),
    y: cz + radial * Math.cos(phi),
  }
}

// Yaw (about local Y) that aligns local +X with the arc tangent. The tangent at
// angle phi is (cos phi, sin phi) in the local x-z plane; matching it under the YXZ
// convention (local +X -> (cos a, 0, -sin a)) gives a = atan2(-sin phi, cos phi) = -phi.
export function bendRotationYAtLocalX(node: LeanToArcLike, localX: number): number {
  if (!isCurvedLeanTo(node)) return 0
  const cz = node.spanArcCenterZ as number
  return -(localX / cz)
}

export function leanToArcFrameAtLocalX(node: LeanToArcLike, localX: number): LeanToArcFrame {
  if (!isCurvedLeanTo(node)) {
    return {
      point: { x: localX, y: 0 },
      tangent: { x: 1, y: 0 },
      normal: { x: 0, y: 1 },
      rotationY: 0,
    }
  }
  const cz = node.spanArcCenterZ as number
  const phi = localX / cz
  return {
    point: bendLocalPoint(node, localX, 0),
    tangent: { x: Math.cos(phi), y: Math.sin(phi) },
    normal: { x: -Math.sin(phi), y: Math.cos(phi) },
    rotationY: -phi,
  }
}

// Radius of the local span arc (Infinity when straight).
export function leanToArcRadius(node: LeanToArcLike): number {
  return isCurvedLeanTo(node) ? (node.spanArcRadius as number) : Number.POSITIVE_INFINITY
}
