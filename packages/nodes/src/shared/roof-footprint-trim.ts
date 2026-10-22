import { normalizeRoofSegmentTrim, type Ring, type RoofSegmentNode } from '@pascal-app/core'

export function roofFootprintInsideTrim(segment: RoofSegmentNode, points: Ring): boolean {
  const t = normalizeRoofSegmentTrim(segment)
  const left = -segment.width / 2 + t.left
  const right = segment.width / 2 - t.right
  const back = -segment.depth / 2 + t.back
  const front = segment.depth / 2 - t.front
  return points.every(([x, z]) => {
    if (
      (t.left > 0 && x < left) ||
      (t.right > 0 && x > right) ||
      (t.back > 0 && z < back) ||
      (t.front > 0 && z > front)
    )
      return false
    for (const [dx, dz, tx, tz] of [
      [x - left, front - z, t.frontLeftX, t.frontLeftZ],
      [right - x, front - z, t.frontRightX, t.frontRightZ],
      [x - left, z - back, t.backLeftX, t.backLeftZ],
      [right - x, z - back, t.backRightX, t.backRightZ],
    ]) {
      if (tx! > 0 && tz! > 0 && dx! / tx! + dz! / tz! < 1) return false
    }
    return true
  })
}
