import { area, containsPoint, distanceToBoundary, type Polygon, type Ring } from './polygon-boolean'

export function polygonCentroid(polygon: Polygon): [number, number] {
  let weight = 0
  let x = 0
  let y = 0
  for (const [index, ring] of [polygon.outer, ...polygon.holes].entries()) {
    let crossSum = 0
    let ringX = 0
    let ringY = 0
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!
      const b = ring[(i + 1) % ring.length]!
      const cross = a[0] * b[1] - b[0] * a[1]
      crossSum += cross
      ringX += (a[0] + b[0]) * cross
      ringY += (a[1] + b[1]) * cross
    }
    if (crossSum === 0) continue
    const sign = Math.sign(crossSum) * (index === 0 ? 1 : -1)
    weight += sign * crossSum
    x += sign * ringX
    y += sign * ringY
  }
  return [x / (3 * weight), y / (3 * weight)]
}

export function polygonInteriorPoint(
  face: { polygon: Ring; holes?: Ring[] },
  preferCentroid = false,
): [number, number] {
  const polygon = [{ outer: face.polygon, holes: face.holes ?? [] }]
  if (face.polygon.length < 3 || area(polygon) <= 0) return face.polygon[0] ?? [0, 0]
  const centroid = polygonCentroid(polygon[0]!)
  if (
    preferCentroid &&
    containsPoint(polygon, centroid) &&
    distanceToBoundary(polygon, centroid) > 0
  )
    return centroid

  const xs = face.polygon.map(([x]) => x)
  const ys = face.polygon.map(([, y]) => y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const maxX = Math.max(...xs)
  const maxY = Math.max(...ys)
  const cell = (x: number, y: number, half: number) => {
    const point: [number, number] = [x, y]
    const distance = distanceToBoundary(polygon, point) * (containsPoint(polygon, point) ? 1 : -1)
    return { point, half, distance, max: distance + half * Math.SQRT2 }
  }
  type Cell = ReturnType<typeof cell>
  const queue: Cell[] = []
  const push = (candidate: Cell) => {
    let index = queue.length
    queue.push(candidate)
    while (index > 0) {
      const parent = (index - 1) >> 1
      if (queue[parent]!.max >= candidate.max) break
      queue[index] = queue[parent]!
      index = parent
    }
    queue[index] = candidate
  }
  const pop = () => {
    const first = queue[0]!
    const last = queue.pop()!
    if (queue.length) {
      let index = 0
      while (index * 2 + 1 < queue.length) {
        let child = index * 2 + 1
        if (child + 1 < queue.length && queue[child + 1]!.max > queue[child]!.max) child++
        if (last.max >= queue[child]!.max) break
        queue[index] = queue[child]!
        index = child
      }
      queue[index] = last
    }
    return first
  }
  let best = cell(face.polygon[0]![0], face.polygon[0]![1], 0)
  push(cell((minX + maxX) / 2, (minY + maxY) / 2, Math.max(maxX - minX, maxY - minY) / 2))
  // Branch and bound finds the pole to 1 mm without assuming the face is convex or hole-free.
  while (queue.length) {
    const current = pop()
    if (current.distance > best.distance) best = current
    if (current.max - best.distance <= 0.001) continue
    const half = current.half / 2
    for (const dx of [-half, half]) {
      for (const dy of [-half, half]) push(cell(current.point[0] + dx, current.point[1] + dy, half))
    }
  }
  return best.point
}
