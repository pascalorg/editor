import type { MultiPolygon } from './polygon-boolean'

type Edge = {
  ax: number
  az: number
  bx: number
  bz: number
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}
export type LawnCoverage = {
  contains: (x: number, z: number) => boolean
  distance: (x: number, z: number, maximum: number) => number
  cell: (
    left: number,
    top: number,
    right: number,
    bottom: number,
  ) => 'inside' | 'outside' | 'boundary'
}

function indexedLawnEdges(polygons: MultiPolygon) {
  const edges: Edge[] = []
  const cells = new Map<string, Set<Edge>>()
  for (const polygon of polygons)
    for (const ring of [polygon.outer, ...polygon.holes])
      for (let index = 0; index < ring.length; index++) {
        const a = ring[index],
          b = ring[(index + 1) % ring.length]
        if (!a || !b) continue
        const edge: Edge = {
          ax: a[0],
          az: a[1],
          bx: b[0],
          bz: b[1],
          minX: Math.min(a[0], b[0]),
          minZ: Math.min(a[1], b[1]),
          maxX: Math.max(a[0], b[0]),
          maxZ: Math.max(a[1], b[1]),
        }
        edges.push(edge)
        const steps = Math.max(
          1,
          Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) * 2),
        )
        // The halo covers every crossed cell, including arbitrarily short corner crossings.
        for (let step = 0; step <= steps; step++) {
          const x = Math.floor(a[0] + ((b[0] - a[0]) * step) / steps),
            z = Math.floor(a[1] + ((b[1] - a[1]) * step) / steps)
          for (let dz = -1; dz <= 1; dz++)
            for (let dx = -1; dx <= 1; dx++) {
              const key = `${x + dx},${z + dz}`
              const bucket = cells.get(key) ?? new Set<Edge>()
              bucket.add(edge)
              cells.set(key, bucket)
            }
        }
      }
  return { edges, cells }
}

export function lawnCoverage(polygons: MultiPolygon): LawnCoverage {
  const { edges, cells } = indexedLawnEdges(polygons)
  const contains = (x: number, z: number) => {
    let inside = false
    for (const edge of edges) {
      if (
        edge.az > z !== edge.bz > z &&
        x < ((edge.bx - edge.ax) * (z - edge.az)) / (edge.bz - edge.az) + edge.ax
      )
        inside = !inside
    }
    return inside
  }
  const distance = (x: number, z: number, maximum: number) => {
    let squared = maximum * maximum
    const nearby = maximum <= 0.5 ? (cells.get(`${Math.floor(x)},${Math.floor(z)}`) ?? []) : edges
    for (const edge of nearby) {
      if (
        x + maximum < edge.minX ||
        x - maximum > edge.maxX ||
        z + maximum < edge.minZ ||
        z - maximum > edge.maxZ
      )
        continue
      const dx = edge.bx - edge.ax,
        dz = edge.bz - edge.az
      const length = dx * dx + dz * dz
      const along = length
        ? Math.max(0, Math.min(1, ((x - edge.ax) * dx + (z - edge.az) * dz) / length))
        : 0
      squared = Math.min(squared, (x - edge.ax - dx * along) ** 2 + (z - edge.az - dz * along) ** 2)
    }
    return Math.sqrt(squared)
  }
  const cell: LawnCoverage['cell'] = (left, top, right, bottom) => {
    const candidates = new Set<Edge>()
    for (let row = Math.floor(top); row <= Math.floor(bottom); row++)
      for (let col = Math.floor(left); col <= Math.floor(right); col++) {
        for (const edge of cells.get(`${col},${row}`) ?? []) candidates.add(edge)
      }
    for (const edge of candidates)
      if (edge.minX <= right && edge.maxX >= left && edge.minZ <= bottom && edge.maxZ >= top)
        return 'boundary'
    return contains((left + right) / 2, (top + bottom) / 2) ? 'inside' : 'outside'
  }
  return { contains, distance, cell }
}
