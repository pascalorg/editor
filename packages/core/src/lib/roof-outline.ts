import {
  getSegmentSlopeFrame,
  normalizeRoofSegmentTrim,
  type RoofSegmentNode,
} from '../schema/nodes/roof-segment'
import type { RoofSurfaceTriangle } from './roof-surface-geometry'

export const ROOF_TRIM_CUT_EPSILON = 0.002

/** The finite box the native renderer subtracts, in the segment frame; size is XYZ, rotation yaw. */
export type RoofTrimCut = {
  center: [number, number, number]
  size: [number, number, number]
  rotation: number
}

export function getRoofSegmentTrimCuts(segment: RoofSegmentNode): RoofTrimCut[] {
  const trim = normalizeRoofSegmentTrim(segment)
  const { activeRh } = getSegmentSlopeFrame(segment)
  const extra =
    segment.wallThickness +
    segment.overhang +
    (segment.gableOverhang ?? 0) +
    segment.deckThickness +
    segment.shingleThickness +
    2
  const minX = -segment.width / 2 - extra
  const maxX = segment.width / 2 + extra
  const minZ = -segment.depth / 2 - extra
  const maxZ = segment.depth / 2 + extra
  const minY = -2
  const maxY = segment.wallHeight + activeRh + segment.deckThickness + segment.shingleThickness + 2
  const height = maxY - minY
  const cuts: RoofTrimCut[] = []
  const box = (x0: number, x1: number, z0: number, z1: number) => {
    if (!(x1 > x0 && z1 > z0 && height > 0)) return
    cuts.push({
      center: [(x0 + x1) / 2, (minY + maxY) / 2, (z0 + z1) / 2],
      size: [x1 - x0, height, z1 - z0],
      rotation: 0,
    })
  }
  const left = -segment.width / 2 + trim.left
  const right = segment.width / 2 - trim.right
  const front = segment.depth / 2 - trim.front
  const back = -segment.depth / 2 + trim.back
  const epsilon = ROOF_TRIM_CUT_EPSILON
  if (trim.left > 0) box(minX, left + epsilon, minZ, maxZ)
  if (trim.right > 0) box(right - epsilon, maxX, minZ, maxZ)
  if (trim.front > 0) box(minX, maxX, front - epsilon, maxZ)
  if (trim.back > 0) box(minX, maxX, minZ, back + epsilon)
  const diagonal = (a: [number, number], b: [number, number], outside: [number, number]) => {
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const length = Math.hypot(dx, dz)
    if (!(length > 0 && height > 0)) return
    const ux = dx / length
    const uz = dz / length
    const mx = (a[0] + b[0]) / 2
    const mz = (a[1] + b[1]) / 2
    const flip = -uz * (outside[0] - mx) + ux * (outside[1] - mz) < 0
    const nx = flip ? uz : -uz
    const nz = flip ? -ux : ux
    const boundsDiagonal = Math.hypot(maxX - minX, maxZ - minZ)
    const depth = boundsDiagonal * 2
    cuts.push({
      center: [mx + nx * (depth / 2 - epsilon), (minY + maxY) / 2, mz + nz * (depth / 2 - epsilon)],
      size: [Math.max(length, boundsDiagonal) * 2, height, depth],
      rotation: Math.atan2(-uz, ux) + (flip ? Math.PI : 0),
    })
  }
  if (trim.frontLeftX > 0 && trim.frontLeftZ > 0)
    diagonal(
      [left + trim.frontLeftX + epsilon, front],
      [left, front - trim.frontLeftZ - epsilon],
      [minX, maxZ],
    )
  if (trim.frontRightX > 0 && trim.frontRightZ > 0)
    diagonal(
      [right, front - trim.frontRightZ - epsilon],
      [right - trim.frontRightX - epsilon, front],
      [maxX, maxZ],
    )
  if (trim.backLeftX > 0 && trim.backLeftZ > 0)
    diagonal(
      [left, back + trim.backLeftZ + epsilon],
      [left + trim.backLeftX + epsilon, back],
      [minX, minZ],
    )
  if (trim.backRightX > 0 && trim.backRightZ > 0)
    diagonal(
      [right - trim.backRightX - epsilon, back],
      [right, back + trim.backRightZ + epsilon],
      [maxX, minZ],
    )
  return cuts
}

type Point = [number, number, number]

function clipPolygon(points: Point[], signed: (point: Point) => number, inside: boolean): Point[] {
  const result: Point[] = []
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    const da = signed(a)
    const db = signed(b)
    const keepA = inside ? da >= 0 : da < 0
    const keepB = inside ? db >= 0 : db < 0
    if (keepA) result.push(a)
    if (keepA !== keepB) {
      const t = da / (da - db)
      result.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])])
    }
  }
  return result
}

/** Only native trim boxes; no scene, accessory cuts, inferred support, or arbitrary CSG. */
export function clipRoofTrianglesByTrim(
  segment: RoofSegmentNode,
  triangles: readonly RoofSurfaceTriangle[],
): RoofSurfaceTriangle[] {
  let result = [...triangles]
  for (const cut of getRoofSegmentTrimCuts(segment)) {
    const cos = Math.cos(cut.rotation)
    const sin = Math.sin(cut.rotation)
    const axes: Point[] = [
      [cos, 0, -sin],
      [0, 1, 0],
      [sin, 0, cos],
    ]
    const planes = axes.flatMap((axis, index) =>
      [-1, 1].map(
        (sign) => (p: Point) =>
          cut.size[index]! / 2 -
          sign *
            (axis[0] * (p[0] - cut.center[0]) +
              axis[1] * (p[1] - cut.center[1]) +
              axis[2] * (p[2] - cut.center[2])),
      ),
    )
    result = result.flatMap((triangle) => {
      let pending: Point[] = triangle.vertices
      const outside: Point[][] = []
      for (const signed of planes) {
        const kept = clipPolygon(pending, signed, false)
        if (kept.length >= 3) outside.push(kept)
        pending = clipPolygon(pending, signed, true)
        if (pending.length < 3) break
      }
      return outside.flatMap((polygon) =>
        polygon.slice(1, -1).flatMap((b, i) => {
          const a = polygon[0]!
          const c = polygon[i + 2]!
          const ux = b[0] - a[0]
          const uy = b[1] - a[1]
          const uz = b[2] - a[2]
          const vx = c[0] - a[0]
          const vy = c[1] - a[1]
          const vz = c[2] - a[2]
          if (!(Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) > 1e-12))
            return []
          return [{ vertices: [a, b, c] as [Point, Point, Point], normal: triangle.normal }]
        }),
      )
    })
  }
  return result
}
