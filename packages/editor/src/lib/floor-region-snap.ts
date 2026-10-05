import type { MultiPolygon } from '@pascal-app/core'

// Snapping for a floor region's points ("Paint part of the floor"): the
// polygon snap context's three modes. `grid` rounds to the grid step, `lines`
// pulls onto the room's corners and edges and the room's existing region
// vertices, `off` keeps the raw point. Alt (free) always keeps the raw point.

export type FloorRegionPoint = [number, number]
export type FloorRegionSnapMode = 'grid' | 'lines' | 'off'

export type FloorRegionSnapSettings = {
  mode: FloorRegionSnapMode
  /** Grid step in metres (`gridSnapStep`). */
  step: number
  /** Alt held: no snapping at all. */
  free?: boolean
}

export type FloorRegionSnapTargets = {
  vertices: FloorRegionPoint[]
  edges: [FloorRegionPoint, FloorRegionPoint][]
}

export type FloorRegionSnapResult = {
  point: FloorRegionPoint
  snap: 'grid' | 'vertex' | 'edge' | null
}

export const FLOOR_REGION_SNAP_RADIUS = 0.1

/** Corners and edges of the room's clear floor, plus the vertices and edges of its regions. */
export function floorRegionSnapTargets(
  clear: MultiPolygon,
  regions: readonly (readonly FloorRegionPoint[])[] = [],
): FloorRegionSnapTargets {
  const vertices: FloorRegionPoint[] = []
  const edges: [FloorRegionPoint, FloorRegionPoint][] = []
  const rings = [...clear.flatMap(({ outer, holes }) => [outer, ...holes]), ...regions]
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!
      const b = ring[(i + 1) % ring.length]!
      vertices.push([a[0], a[1]])
      edges.push([
        [a[0], a[1]],
        [b[0], b[1]],
      ])
    }
  }
  return { vertices, edges }
}

function closestOnSegment(
  p: FloorRegionPoint,
  a: FloorRegionPoint,
  b: FloorRegionPoint,
): FloorRegionPoint {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const lengthSq = dx * dx + dz * dz
  const t = lengthSq
    ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / lengthSq))
    : 0
  return [a[0] + t * dx, a[1] + t * dz]
}

export function snapFloorRegionPoint(
  raw: FloorRegionPoint,
  settings: FloorRegionSnapSettings,
  targets: FloorRegionSnapTargets,
  radius = FLOOR_REGION_SNAP_RADIUS,
): FloorRegionSnapResult {
  if (settings.free || settings.mode === 'off') return { point: [raw[0], raw[1]], snap: null }
  if (settings.mode === 'grid') {
    const step = settings.step
    if (!(step > 0)) return { point: [raw[0], raw[1]], snap: null }
    const round = (value: number) => Number((Math.round(value / step) * step).toFixed(6))
    return { point: [round(raw[0]), round(raw[1])], snap: 'grid' }
  }
  // Corners win over edges: a pointer near a corner lands on the corner.
  let best: FloorRegionPoint | null = null
  let bestDistance = radius
  for (const vertex of targets.vertices) {
    const distance = Math.hypot(vertex[0] - raw[0], vertex[1] - raw[1])
    if (distance <= bestDistance) {
      best = vertex
      bestDistance = distance
    }
  }
  if (best) return { point: [best[0], best[1]], snap: 'vertex' }
  bestDistance = radius
  for (const [a, b] of targets.edges) {
    const candidate = closestOnSegment(raw, a, b)
    const distance = Math.hypot(candidate[0] - raw[0], candidate[1] - raw[1])
    if (distance <= bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best ? { point: best, snap: 'edge' } : { point: [raw[0], raw[1]], snap: null }
}
