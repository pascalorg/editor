/**
 * Exterior MATERIAL RENDITION for elevations — the linework that makes a
 * stucco wall read as stucco and a lap-sided wall read as siding, drawn from
 * the wall's own assembly (`wall.assembly.exterior.finish`, WS5) instead of a
 * blank white rectangle.
 *
 * Every pattern is a drawing CONVENTION with its module (course / exposure /
 * batten spacing) stated next to it. The modules are the common trade values
 * a drafter would use for the symbol; they are not read off a product, so an
 * elevation drawn with them is a rendition, not a shop drawing. Where a value
 * is a product convention rather than a code, the comment says so.
 *
 * Coordinates: DRAWING space — x along the view's right axis, y = negated
 * world elevation (`drawY`). Hatches are clipped around openings analytically
 * (interval subtraction), so nothing here needs SVG clip paths.
 */
import type { FloorplanGeometry } from '@pascal-app/core'
import { INK, line } from './style'
import type { Vec2 } from './types'

export type Interval = readonly [number, number]

/** An opening's hole in the wall face, in DRAWING coordinates. */
export type FaceHole = {
  u: Interval
  /** [top, bottom] in drawing y (top is the smaller number). */
  y: Interval
}

/** The exterior finish kinds a wall assembly can declare (core `WallAssemblyExteriorFinish`). */
export type FinishKind = 'siding' | 'stucco' | 'brick' | 'stone' | 'fiber-cement' | 'none'

/**
 * Pattern modules, metres.
 *
 * - LAP_EXPOSURE 7 in: the weather exposure of an 8-1/4 in lap plank
 *   (fibre-cement and wood lap sidings are commonly drawn at 7 in exposure —
 *   product convention, e.g. HardiePlank 8.25 in = 7 in exposure).
 * - BRICK_COURSE 2-2/3 in: modular brick, three courses per 8 in
 *   (BIA modular coursing — product convention).
 * - STUCCO stipple density: drafting convention only.
 * - SHINGLE_COURSE 5-5/8 in: exposure of a standard three-tab / laminated
 *   asphalt shingle (product convention); the elevation spacing is the
 *   exposure foreshortened by the roof pitch.
 */
export const LAP_EXPOSURE = 7 * 0.0254
export const BRICK_COURSE = (8 / 3) * 0.0254
export const STONE_COURSE = 6 * 0.0254
export const SHINGLE_COURSE = 5.625 * 0.0254
export const BATTEN_SPACING = 16 * 0.0254
/** Stipple dots per square metre of stucco face — drafting convention. */
export const STUCCO_DOTS_PER_M2 = 14

const HATCH = {
  stroke: INK,
  strokeWidth: 0.0035,
  opacity: 0.55,
} as const

/** `span` minus every hole that overlaps it, as the remaining pieces (sorted). */
export function subtractIntervals(span: Interval, holes: readonly Interval[]): Interval[] {
  let pieces: Interval[] = [[Math.min(span[0], span[1]), Math.max(span[0], span[1])]]
  for (const hole of holes) {
    const h0 = Math.min(hole[0], hole[1])
    const h1 = Math.max(hole[0], hole[1])
    const next: Interval[] = []
    for (const [a, b] of pieces) {
      if (h1 <= a || h0 >= b) {
        next.push([a, b])
        continue
      }
      if (h0 > a) next.push([a, h0])
      if (h1 < b) next.push([h1, b])
    }
    pieces = next
  }
  return pieces.filter(([a, b]) => b - a > 1e-6)
}

/** Deterministic 0..1 noise — the stipple must not change between renders. */
function noise(i: number, j: number): number {
  const n = Math.sin(i * 127.1 + j * 311.7) * 43758.5453
  return n - Math.floor(n)
}

/**
 * Hatch for one wall face rectangle `[u0,u1] × [yTop,yBottom]` (drawing
 * coordinates), clipped around `holes`.
 */
export function finishHatch(
  finish: FinishKind | null | undefined,
  u: Interval,
  yTop: number,
  yBottom: number,
  holes: readonly FaceHole[],
): FloorplanGeometry[] {
  if (!finish || finish === 'none') return []
  const out: FloorplanGeometry[] = []
  const [u0, u1] = [Math.min(u[0], u[1]), Math.max(u[0], u[1])]
  const top = Math.min(yTop, yBottom)
  const bottom = Math.max(yTop, yBottom)
  const holesAtY = (y: number): Interval[] =>
    holes.filter((h) => y > Math.min(h.y[0], h.y[1]) && y < Math.max(h.y[0], h.y[1])).map((h) => h.u)
  const holesAtU = (x: number): Interval[] =>
    holes.filter((h) => x > Math.min(h.u[0], h.u[1]) && x < Math.max(h.u[0], h.u[1])).map((h) => h.y)

  const courses = (module: number, weight: number = HATCH.strokeWidth) => {
    // Courses are laid from the BOTTOM (the sill / first course) upward.
    for (let y = bottom - module; y > top + 1e-6; y -= module) {
      for (const [a, b] of subtractIntervals([u0, u1], holesAtY(y))) {
        out.push(line([a, y], [b, y], { ...HATCH, strokeWidth: weight }))
      }
    }
  }

  switch (finish) {
    case 'siding':
    case 'fiber-cement':
      courses(LAP_EXPOSURE)
      break
    case 'brick':
      courses(BRICK_COURSE, 0.0025)
      break
    case 'stone':
      // Coursed stone reads as irregular horizontal beds with staggered joints.
      courses(STONE_COURSE)
      for (let i = 0, y = bottom - STONE_COURSE; y > top; y -= STONE_COURSE, i++) {
        const yAbove = Math.max(top, y - STONE_COURSE)
        let x = u0 + (i % 2) * STONE_COURSE * 1.1 + noise(i, 0) * 0.2
        while (x < u1) {
          if (holesAtU(x).every((h) => !(y > Math.min(...h) && yAbove < Math.max(...h)))) {
            out.push(line([x, yAbove], [x, y], HATCH))
          }
          x += STONE_COURSE * (1.6 + noise(i, Math.round(x * 10)))
        }
      }
      break
    case 'stucco': {
      const area = (u1 - u0) * (bottom - top)
      const count = Math.min(4000, Math.round(area * STUCCO_DOTS_PER_M2))
      for (let k = 0; k < count; k++) {
        const x = u0 + noise(k, 1) * (u1 - u0)
        const y = top + noise(k, 2) * (bottom - top)
        if (holesAtY(y).some(([a, b]) => x > Math.min(a, b) && x < Math.max(a, b))) continue
        out.push({
          kind: 'circle',
          cx: x,
          cy: y,
          r: 0.006 + noise(k, 3) * 0.006,
          fill: INK,
          stroke: 'none',
          opacity: 0.35,
        } as FloorplanGeometry)
      }
      break
    }
    default:
      break
  }
  return out
}

/** Vertical board-and-batten lines — used when a siding wall is flagged vertical. */
export function battenLines(u: Interval, yTop: number, yBottom: number, holes: readonly FaceHole[]) {
  const out: FloorplanGeometry[] = []
  const [u0, u1] = [Math.min(u[0], u[1]), Math.max(u[0], u[1])]
  for (let x = u0 + BATTEN_SPACING; x < u1; x += BATTEN_SPACING) {
    const holeYs = holes
      .filter((h) => x > Math.min(h.u[0], h.u[1]) && x < Math.max(h.u[0], h.u[1]))
      .map((h) => h.y)
    for (const [a, b] of subtractIntervals([yTop, yBottom], holeYs)) {
      out.push(line([x, a], [x, b], HATCH))
    }
  }
  return out
}

/**
 * Horizontal scan-line clipping of `y = const` lines to a simple polygon
 * (even-odd) — the shingle courses inside a projected roof outline.
 */
export function scanlinesInPolygon(
  polygon: readonly Vec2[],
  spacing: number,
  style: Partial<FloorplanGeometry & { kind: 'line' }> = HATCH,
): FloorplanGeometry[] {
  if (polygon.length < 3 || spacing <= 0) return []
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const [, y] of polygon) {
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  const out: FloorplanGeometry[] = []
  for (let y = maxY - spacing; y > minY; y -= spacing) {
    const xs: number[] = []
    for (let i = 0, n = polygon.length; i < n; i++) {
      const [x0, y0] = polygon[i] as Vec2
      const [x1, y1] = polygon[(i + 1) % n] as Vec2
      if (y0 === y1) continue
      if (y < Math.min(y0, y1) || y >= Math.max(y0, y1)) continue
      xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0))
    }
    xs.sort((a, b) => a - b)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = xs[k] as number
      const b = xs[k + 1] as number
      if (b - a > 1e-4) out.push(line([a, y], [b, y], style))
    }
  }
  return out
}

/** Metres → feet-inches, architect's style: 9'-0", -1'-6", 0'-0". */
export function formatFeetInches(metres: number): string {
  const sign = metres < 0 ? '-' : ''
  const totalInches = Math.round(Math.abs(metres) / 0.0254)
  const feet = Math.floor(totalInches / 12)
  const inches = totalInches % 12
  return `${sign}${feet}'-${inches}"`
}

/** What the finish key calls each finish. */
export const FINISH_LABEL: Record<FinishKind, string> = {
  siding: 'LAP SIDING',
  'fiber-cement': 'FIBER-CEMENT LAP SIDING',
  stucco: '3-COAT CEMENT PLASTER (STUCCO)',
  brick: 'BRICK VENEER',
  stone: 'STONE VENEER',
  none: 'NO CLADDING SPECIFIED',
}

/**
 * Ground hatch below a grade line — short diagonal ticks, the way grade is
 * conventionally shown on an elevation, spaced 0.3 m.
 */
export function gradeTicks(points: readonly Vec2[], depth = 0.12): FloorplanGeometry[] {
  const out: FloorplanGeometry[] = []
  for (let i = 0; i + 1 < points.length; i++) {
    const [x0, y0] = points[i] as Vec2
    const [x1, y1] = points[i + 1] as Vec2
    const length = Math.hypot(x1 - x0, y1 - y0)
    const steps = Math.max(1, Math.floor(length / 0.3))
    for (let s = 0; s < steps; s++) {
      const t = (s + 0.5) / steps
      const x = x0 + (x1 - x0) * t
      const y = y0 + (y1 - y0) * t
      out.push(line([x, y], [x - depth * 0.7, y + depth], { ...HATCH, opacity: 0.8 }))
    }
  }
  return out
}
