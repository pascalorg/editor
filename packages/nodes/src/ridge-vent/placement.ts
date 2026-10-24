import {
  getRidgeVentLinesForSegment,
  getRoofSegmentVisibleTopBounds,
  normalizeRoofSegmentTrim,
  type RidgeVentNode,
  type RoofSegmentNode,
} from '@pascal-app/core'
import { getRoofTopSurfaceY } from '../shared/roof-surface'

// Trim planes are linear, so clipping the two long edges also protects every
// point between them without sampling (including narrow diagonal cuts).
function trimDistances(segment: RoofSegmentNode, x: number, z: number): number[] {
  const t = normalizeRoofSegmentTrim(segment)
  const l = -segment.width / 2 + t.left,
    r = segment.width / 2 - t.right
  const b = -segment.depth / 2 + t.back,
    f = segment.depth / 2 - t.front
  const values: number[] = []
  if (t.left > 0) values.push(x - l)
  if (t.right > 0) values.push(r - x)
  if (t.back > 0) values.push(z - b)
  if (t.front > 0) values.push(f - z)
  for (const [dx, dz, tx, tz] of [
    [x - l, f - z, t.frontLeftX, t.frontLeftZ],
    [r - x, f - z, t.frontRightX, t.frontRightZ],
    [x - l, z - b, t.backLeftX, t.backLeftZ],
    [r - x, z - b, t.backRightX, t.backRightZ],
  ]) {
    if (tx! > 0 && tz! > 0) values.push(dx! / tx! + dz! / tz! - 1)
  }
  return values
}

export function resolveRidgeVentPlacement(
  segment: RoofSegmentNode,
  node: RidgeVentNode,
  x: number,
  z: number,
  options: { gridStep?: number; free?: boolean; fit?: boolean } = {},
) {
  if (segment.roofSystem === 'glazed') return null
  const bounds = getRoofSegmentVisibleTopBounds(segment)
  const lines =
    segment.roofType === 'shed'
      ? [{ start: [bounds.minX, bounds.minZ], end: [bounds.maxX, bounds.minZ] }]
      : getRidgeVentLinesForSegment(segment)
  let best: {
    position: [number, number, number]
    rotation: number
    length: number
    availableLength: number
    valid: boolean
    surfaceY: number
  } | null = null
  let bestDistance = Infinity
  for (const line of lines) {
    const [sx, sz] = line.start,
      [ex, ez] = line.end
    const dx = ex! - sx!,
      dz = ez! - sz!,
      span = Math.hypot(dx, dz)
    if (span < 0.001) continue
    const ux = dx / span,
      uz = dz / span
    let lo = 0,
      hi = 1
    for (const side of [-1, 1]) {
      const ox = ((-uz * node.width) / 2) * side,
        oz = ((ux * node.width) / 2) * side
      const a = trimDistances(segment, sx! + ox, sz! + oz),
        b = trimDistances(segment, ex! + ox, ez! + oz)
      for (let i = 0; i < a.length; i++) {
        const start = a[i]!,
          end = b[i]!
        if (start < 0 && end < 0) {
          lo = 1
          hi = 0
          break
        }
        if (start < 0) lo = Math.max(lo, -start / (end - start))
        if (end < 0) hi = Math.min(hi, start / (start - end))
      }
    }
    if (hi <= lo) continue
    const availableLength = (hi - lo) * span
    const length = options.fit ? availableLength : node.length
    const raw = (x - sx!) * ux + (z - sz!) * uz
    const half = Math.min(length, availableLength) / 2
    const min = lo * span + half,
      max = hi * span - half
    let distance = options.fit ? (min + max) / 2 : raw
    if (options.gridStep && options.gridStep > 0)
      distance =
        Math.round((distance + sx! * ux + sz! * uz) / options.gridStep) * options.gridStep -
        sx! * ux -
        sz! * uz
    distance = Math.max(min, Math.min(max, distance))
    const cx = options.free ? x : sx! + ux * distance,
      cz = options.free ? z : sz! + uz * distance
    const score =
      (x - (sx! + ux * Math.max(lo * span, Math.min(hi * span, raw)))) ** 2 +
      (z - (sz! + uz * Math.max(lo * span, Math.min(hi * span, raw)))) ** 2
    if (score >= bestDistance) continue
    bestDistance = score
    best = {
      position: [cx, node.position[1], cz],
      rotation: Math.atan2(-dz, dx),
      length,
      availableLength,
      valid: options.free === true || length <= availableLength + 1e-6,
      surfaceY: getRoofTopSurfaceY(cx, cz, segment) + Math.max(-2, Math.min(2, node.position[1])),
    }
  }
  return best
}
