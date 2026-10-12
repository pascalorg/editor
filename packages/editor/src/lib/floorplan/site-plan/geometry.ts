import { rayToPolygon, type YardDimension, type YardSide } from '@pascal-app/core'
/**
 * Site-plan geometry — pure functions, no store, no React.
 *
 * All coordinates are SITE metres: origin = the geocoded point, x → east,
 * y → south (the plan frame the site polygon is stored in). Consumers
 * (2D editor, sheets) turn these into SVG through the existing renderer.
 */

export type Pt = readonly [number, number]

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const EPS = 1e-9

export function polygonBounds(points: readonly Pt[]): Bounds {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  return { minX, minY, maxX, maxY }
}

export function polygonArea(points: readonly Pt[]): number {
  let a = 0
  for (let i = 0, n = points.length; i < n; i++) {
    const p = points[i] as Pt
    const q = points[(i + 1) % n] as Pt
    a += p[0] * q[1] - q[0] * p[1]
  }
  return Math.abs(a / 2)
}

export function polygonCentroid(points: readonly Pt[]): Pt {
  let cx = 0
  let cy = 0
  let a = 0
  for (let i = 0, n = points.length; i < n; i++) {
    const p = points[i] as Pt
    const q = points[(i + 1) % n] as Pt
    const cross = p[0] * q[1] - q[0] * p[1]
    a += cross
    cx += (p[0] + q[0]) * cross
    cy += (p[1] + q[1]) * cross
  }
  if (Math.abs(a) < EPS) {
    // Degenerate ring — fall back to the vertex average.
    const n = Math.max(1, points.length)
    let sx = 0
    let sy = 0
    for (const [x, y] of points) {
      sx += x
      sy += y
    }
    return [sx / n, sy / n]
  }
  a /= 2
  return [cx / (6 * a), cy / (6 * a)]
}

const COMPASS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
]

export function compassLabel(headingDeg: number): string {
  const idx = Math.round((((headingDeg % 360) + 360) % 360) / 22.5) % 16
  return COMPASS[idx] as string
}

/**
 * The four yard dimensions: from each footprint bbox edge midpoint, straight
 * out to the lot line. Sides whose ray misses the lot line (footprint outside
 * the lot) are omitted rather than faked.
 */
export function castYardDimensions(lot: readonly Pt[], footprint: Bounds): YardDimension[] {
  if (lot.length < 3) return []
  const midX = (footprint.minX + footprint.maxX) / 2
  const midY = (footprint.minY + footprint.maxY) / 2
  const casts: { side: YardSide; from: Pt; dx: number; dy: number }[] = [
    { side: 'north', from: [midX, footprint.minY], dx: 0, dy: -1 },
    { side: 'south', from: [midX, footprint.maxY], dx: 0, dy: 1 },
    { side: 'west', from: [footprint.minX, midY], dx: -1, dy: 0 },
    { side: 'east', from: [footprint.maxX, midY], dx: 1, dy: 0 },
  ]
  const out: YardDimension[] = []
  for (const c of casts) {
    const hit = rayToPolygon(lot, c.from, c.dx, c.dy)
    if (!hit) continue
    out.push({ side: c.side, from: c.from, to: hit.point, distance: hit.distance })
  }
  return out
}

/** Even-odd point-in-polygon. */
export function pointInPolygon(points: readonly Pt[], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i] as Pt
    const b = points[j] as Pt
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside
    }
  }
  return inside
}

export const METRES_PER_FOOT = 0.3048

/** `24'-6"` — the notation a US site plan uses for yard dimensions. */
export function formatFeetInches(metres: number): string {
  const totalInches = Math.round((metres / METRES_PER_FOOT) * 12)
  const feet = Math.floor(totalInches / 12)
  const inches = totalInches % 12
  return inches === 0 ? `${feet}'-0"` : `${feet}'-${inches}"`
}
