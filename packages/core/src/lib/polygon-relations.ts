export type Point2D = [number, number]

export function pointOnSegment(point: Point2D, start: Point2D, end: Point2D, tolerance = 1e-6) {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const cross = (point[0] - start[0]) * dz - (point[1] - start[1]) * dx
  if (Math.abs(cross) > tolerance) return false

  const dot =
    (point[0] - start[0]) * (point[0] - end[0]) + (point[1] - start[1]) * (point[1] - end[1])
  return dot <= tolerance
}

export function pointInPolygon(
  point: Point2D,
  polygon: Point2D[],
  options?: { includeBoundary?: boolean },
) {
  if (polygon.length < 3) return false
  const includeBoundary = options?.includeBoundary ?? true
  if (
    polygon.some((start, index) =>
      pointOnSegment(point, start, polygon[(index + 1) % polygon.length]!),
    )
  ) {
    return includeBoundary
  }

  let inside = false
  const [x, z] = point
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const current = polygon[i]!
    const previous = polygon[j]!
    const intersects =
      current[1] > z !== previous[1] > z &&
      x < ((previous[0] - current[0]) * (z - current[1])) / (previous[1] - current[1]) + current[0]
    if (intersects) inside = !inside
  }
  return inside
}

export function segmentsIntersect(a: Point2D, b: Point2D, c: Point2D, d: Point2D) {
  const cross = (ux: number, uz: number, vx: number, vz: number) => ux * vz - uz * vx
  const abx = b[0] - a[0]
  const abz = b[1] - a[1]
  const acx = c[0] - a[0]
  const acz = c[1] - a[1]
  const adx = d[0] - a[0]
  const adz = d[1] - a[1]
  const cdx = d[0] - c[0]
  const cdz = d[1] - c[1]
  const cax = a[0] - c[0]
  const caz = a[1] - c[1]
  const cbx = b[0] - c[0]
  const cbz = b[1] - c[1]

  const o1 = cross(abx, abz, acx, acz)
  const o2 = cross(abx, abz, adx, adz)
  const o3 = cross(cdx, cdz, cax, caz)
  const o4 = cross(cdx, cdz, cbx, cbz)

  if (Math.sign(o1) !== Math.sign(o2) && Math.sign(o3) !== Math.sign(o4)) return true
  return (
    pointOnSegment(c, a, b) ||
    pointOnSegment(d, a, b) ||
    pointOnSegment(a, c, d) ||
    pointOnSegment(b, c, d)
  )
}

export function polygonsIntersect(left: Point2D[], right: Point2D[]) {
  for (let leftIndex = 0; leftIndex < left.length; leftIndex++) {
    const leftStart = left[leftIndex]!
    const leftEnd = left[(leftIndex + 1) % left.length]!
    for (let rightIndex = 0; rightIndex < right.length; rightIndex++) {
      if (
        segmentsIntersect(
          leftStart,
          leftEnd,
          right[rightIndex]!,
          right[(rightIndex + 1) % right.length]!,
        )
      ) {
        return true
      }
    }
  }

  return false
}

export function polygonContainsPolygon(outer: Point2D[], inner: Point2D[]) {
  return inner.every((point) => pointInPolygon(point, outer))
}

export function polygonsOverlap(left: Point2D[], right: Point2D[]) {
  return (
    polygonsIntersect(left, right) ||
    left.some((point) => pointInPolygon(point, right)) ||
    right.some((point) => pointInPolygon(point, left))
  )
}
