export type PlanPoint = readonly [number, number]

/**
 * Unsigned area of a plan polygon, by the shoelace formula.
 *
 * Winding-independent, so a polygon drawn clockwise measures the same as one
 * drawn anticlockwise — a takeoff must not depend on which way the user
 * happened to trace the outline.
 */
export function planPolygonArea(polygon: ReadonlyArray<PlanPoint>): number {
  if (polygon.length < 3) return 0

  let twiceArea = 0
  for (let index = 0; index < polygon.length; index++) {
    const current = polygon[index]
    const next = polygon[(index + 1) % polygon.length]
    if (!(current && next)) continue
    twiceArea += current[0] * next[1] - next[0] * current[1]
  }
  return Math.abs(twiceArea) / 2
}

/** Polygon area with its holes subtracted, floored at zero. */
export function planPolygonNetArea(
  polygon: ReadonlyArray<PlanPoint>,
  holes: ReadonlyArray<ReadonlyArray<PlanPoint>> = [],
): number {
  const gross = planPolygonArea(polygon)
  let holeArea = 0
  for (const hole of holes) holeArea += planPolygonArea(hole)
  return Math.max(0, gross - holeArea)
}

/** Closed perimeter of a plan polygon. */
export function planPolygonPerimeter(polygon: ReadonlyArray<PlanPoint>): number {
  if (polygon.length < 2) return 0

  let total = 0
  for (let index = 0; index < polygon.length; index++) {
    const current = polygon[index]
    const next = polygon[(index + 1) % polygon.length]
    if (!(current && next)) continue
    total += Math.hypot(next[0] - current[0], next[1] - current[1])
  }
  return total
}
