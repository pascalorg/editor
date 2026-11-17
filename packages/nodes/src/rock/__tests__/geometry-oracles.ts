// Independent geometric observations, not a copy of the production radial field/mesher.
export type Point = [number, number]
export type Segment = [Point, Point]

export function segmentDistance([x, z]: Point, [[ax, az], [bx, bz]]: Segment): number {
  const dx = bx - ax
  const dz = bz - az
  const denominator = dx * dx + dz * dz
  const t =
    denominator === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / denominator))
  return Math.hypot(x - ax - t * dx, z - az - t * dz)
}

export const edges = (ring: readonly Point[]): Segment[] =>
  ring.map((point, index) => [point, ring[(index + 1) % ring.length]!])

export function insideSegments([x, z]: Point, segments: readonly Segment[]): boolean {
  let inside = false
  for (const [[ax, az], [bx, bz]] of segments) {
    if (az > z !== bz > z && x < ax + ((z - az) * (bx - ax)) / (bz - az)) inside = !inside
  }
  return inside
}

export function insidePolygon(point: Point, polygon: readonly Point[], epsilon = 0): boolean {
  const segments = edges(polygon)
  return (
    segments.some((segment) => segmentDistance(point, segment) <= epsilon) ||
    insideSegments(point, segments)
  )
}

export function float32Slack(positions: ArrayLike<number>): number {
  let scale = 1
  for (let i = 0; i < positions.length; i++) scale = Math.max(scale, Math.abs(positions[i]!))
  // Eight Float32 ULPs at the fixture scale cover storage plus a linear triangle-plane slice.
  return 8 * 2 ** -23 * scale
}

export function planeSegments(
  positions: ArrayLike<number>,
  indices: ArrayLike<number> | null,
  y: number,
): Segment[] {
  const count = indices?.length ?? positions.length / 3
  const found: Segment[] = []
  for (let offset = 0; offset < count; offset += 3) {
    const points: Point[] = []
    for (let edge = 0; edge < 3; edge++) {
      const a = (indices?.[offset + edge] ?? offset + edge) * 3
      const b = (indices?.[offset + ((edge + 1) % 3)] ?? offset + ((edge + 1) % 3)) * 3
      const ay = positions[a + 1]!
      const by = positions[b + 1]!
      // Half-open crossing includes one endpoint but does not double-count a shared vertex.
      if (ay > y === by > y) continue
      const t = (y - ay) / (by - ay)
      points.push([
        positions[a]! + t * (positions[b]! - positions[a]!),
        positions[a + 2]! + t * (positions[b + 2]! - positions[a + 2]!),
      ])
    }
    if (points.length === 2) found.push([points[0]!, points[1]!])
  }
  return found
}
