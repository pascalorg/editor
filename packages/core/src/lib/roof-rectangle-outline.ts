type Point = [number, number]
type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number }
type Corner = 'frontLeft' | 'frontRight' | 'backLeft' | 'backRight'
export type RoofRectangleTrim = Partial<Record<`${Corner}${'X' | 'Z'}`, number>>

function clipByLine(polygon: Point[], start: Point, end: Point, outside: Point): Point[] {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const side = (point: Point) => dx * (point[1] - start[1]) - dz * (point[0] - start[0])
  const sign = Math.sign(side(outside)) || 1
  const clipped: Point[] = []
  for (const [index, current] of polygon.entries()) {
    const next = polygon[(index + 1) % polygon.length]!
    const currentSide = sign * side(current)
    const nextSide = sign * side(next)
    const inside = currentSide <= 1e-7
    if (inside) clipped.push(current)
    if (inside !== nextSide <= 1e-7) {
      const ratio = currentSide / (currentSide - nextSide)
      clipped.push([
        current[0] + (next[0] - current[0]) * ratio,
        current[1] + (next[1] - current[1]) * ratio,
      ])
    }
  }
  return clipped
}

/** Front is +Z; extending the bounds retains the original corner-cut planes. */
export function roofRectangleOutline(
  bounds: Bounds & { trim?: RoofRectangleTrim },
  outer: Bounds = bounds,
): Point[] {
  const { minX, maxX, minZ, maxZ, trim = {} } = bounds
  let outline: Point[] = [
    [outer.minX, outer.minZ],
    [outer.maxX, outer.minZ],
    [outer.maxX, outer.maxZ],
    [outer.minX, outer.maxZ],
  ]
  const corners: [number, number, Point, number, number][] = [
    [trim.backLeftX ?? 0, trim.backLeftZ ?? 0, [minX, minZ], 1, 1],
    [trim.backRightX ?? 0, trim.backRightZ ?? 0, [maxX, minZ], -1, 1],
    [trim.frontRightX ?? 0, trim.frontRightZ ?? 0, [maxX, maxZ], -1, -1],
    [trim.frontLeftX ?? 0, trim.frontLeftZ ?? 0, [minX, maxZ], 1, -1],
  ]
  for (const [legX, legZ, corner, alongX, alongZ] of corners) {
    if (legX <= 0 || legZ <= 0 || outline.length < 3) continue
    outline = clipByLine(
      outline,
      [corner[0] + alongX * legX, corner[1]],
      [corner[0], corner[1] + alongZ * legZ],
      [corner[0] - alongX, corner[1] - alongZ],
    )
  }
  return outline
}
