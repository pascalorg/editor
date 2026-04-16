export function insetPolygonFromCentroid(
  polygon: Array<[number, number]>,
  inset: number,
): Array<[number, number]> {
  if (inset <= 0) {
    return polygon.map(([x, z]) => [x, z] as [number, number])
  }

  const centroid = polygon.reduce(
    (acc, [x, z]) => ({ x: acc.x + x, z: acc.z + z }),
    { x: 0, z: 0 },
  )
  centroid.x /= Math.max(polygon.length, 1)
  centroid.z /= Math.max(polygon.length, 1)

  return polygon.map(([x, z]) => {
    const dx = x - centroid.x
    const dz = z - centroid.z
    const length = Math.hypot(dx, dz)
    if (length <= inset + 1e-6) {
      return [x, z] as [number, number]
    }

    const scale = (length - inset) / length
    return [centroid.x + dx * scale, centroid.z + dz * scale] as [number, number]
  })
}

function pointLineDistance(
  point: [number, number],
  start: [number, number],
  end: [number, number],
) {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const lengthSquared = dx * dx + dz * dz

  if (lengthSquared < 1e-9) {
    return Math.hypot(point[0] - start[0], point[1] - start[1])
  }

  const cross = (point[0] - start[0]) * dz - (point[1] - start[1]) * dx
  return Math.abs(cross) / Math.sqrt(lengthSquared)
}

function dedupePolygonPoints(
  polygon: Array<[number, number]>,
  tolerance = 1e-6,
): Array<[number, number]> {
  const deduped: Array<[number, number]> = []

  for (const point of polygon) {
    const previous = deduped[deduped.length - 1]
    if (previous && Math.hypot(point[0] - previous[0], point[1] - previous[1]) <= tolerance) {
      continue
    }
    deduped.push(point)
  }

  if (
    deduped.length > 2 &&
    Math.hypot(
      deduped[0]![0] - deduped[deduped.length - 1]![0],
      deduped[0]![1] - deduped[deduped.length - 1]![1],
    ) <= tolerance
  ) {
    deduped.pop()
  }

  return deduped
}

function simplifyPolyline(points: Array<[number, number]>, tolerance: number): Array<[number, number]> {
  if (points.length <= 2) {
    return points.map(([x, z]) => [x, z] as [number, number])
  }

  let maxDistance = -1
  let splitIndex = -1

  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = pointLineDistance(points[index]!, points[0]!, points[points.length - 1]!)
    if (distance > maxDistance) {
      maxDistance = distance
      splitIndex = index
    }
  }

  if (maxDistance <= tolerance || splitIndex === -1) {
    return [points[0]!, points[points.length - 1]!]
  }

  const left = simplifyPolyline(points.slice(0, splitIndex + 1), tolerance)
  const right = simplifyPolyline(points.slice(splitIndex), tolerance)
  return [...left.slice(0, -1), ...right]
}

export function simplifyClosedPolygon(
  polygon: Array<[number, number]>,
  tolerance: number,
): Array<[number, number]> {
  const cleanPolygon = dedupePolygonPoints(polygon)
  if (cleanPolygon.length <= 3 || tolerance <= 0) {
    return cleanPolygon
  }

  let anchorA = 0
  let anchorB = Math.floor(cleanPolygon.length / 2)
  let maxDistanceSquared = -1

  for (let i = 0; i < cleanPolygon.length; i += 1) {
    for (let j = i + 1; j < cleanPolygon.length; j += 1) {
      const dx = cleanPolygon[j]![0] - cleanPolygon[i]![0]
      const dz = cleanPolygon[j]![1] - cleanPolygon[i]![1]
      const distanceSquared = dx * dx + dz * dz
      if (distanceSquared > maxDistanceSquared) {
        maxDistanceSquared = distanceSquared
        anchorA = i
        anchorB = j
      }
    }
  }

  const forward = cleanPolygon.slice(anchorA, anchorB + 1)
  const wrapped = [...cleanPolygon.slice(anchorB), ...cleanPolygon.slice(0, anchorA + 1)]
  const simplifiedForward = simplifyPolyline(forward, tolerance)
  const simplifiedWrapped = simplifyPolyline(wrapped, tolerance)
  const simplified = dedupePolygonPoints(
    [...simplifiedForward.slice(0, -1), ...simplifiedWrapped.slice(0, -1)],
    tolerance * 0.25,
  )

  return simplified.length >= 3 ? simplified : cleanPolygon
}
