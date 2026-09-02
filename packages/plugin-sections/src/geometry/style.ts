import type { FloorplanGeometry } from '@pascal-app/core'
import type { Vec2 } from './types'

/**
 * Architectural line weights, in DRAWING metres (the same units the
 * primitives' coordinates use), so a section printed at 1:50 lands on paper
 * with the right relative hierarchy. The floor-plan SVG renderer honours
 * `stroke`, `strokeWidth`, `strokeDasharray`, `fill`, `fillOpacity`,
 * `strokeLinejoin` and `opacity` (see `floorplan-geometry-renderer.tsx`
 * `styleAttrs`), which is the whole vocabulary used here.
 */
export const INK = '#111111'
export const PAPER = '#ffffff'
/** Framing-cavity poché — light grey so the cut reads solid without going black. */
export const POCHE = '#c9c9cf'
/** Sheathing / finish layers inside a cut wall. */
export const POCHE_SHEATHING = '#a9a9b2'
export const POCHE_FINISH = '#e4e4e8'
export const POCHE_SLAB = '#b7b7be'
export const POCHE_ROOF = '#bfbfc6'
export const GRADE_FILL = '#dededf'

export const WEIGHT = {
  /** Anything the cut plane passes through. */
  cut: 0.028,
  /** Layer boundaries inside a cut assembly. */
  cutLayer: 0.008,
  /** Visible edges beyond the cut plane / the elevation's own outlines. */
  projected: 0.01,
  /** Openings, sills, mullions, fascia. */
  detail: 0.006,
  /** Level lines, plate/ridge datums, grade. */
  datum: 0.005,
} as const

export const DASH = {
  datum: '0.18 0.09 0.03 0.09',
  hidden: '0.08 0.06',
} as const

export function polygon(
  points: readonly Vec2[],
  style: Partial<FloorplanGeometry & { kind: 'polygon' }> = {},
): FloorplanGeometry {
  return {
    kind: 'polygon',
    points: points.map(([x, y]) => [x, y] as const),
    fill: 'none',
    stroke: INK,
    strokeWidth: WEIGHT.projected,
    strokeLinejoin: 'miter',
    ...style,
  } as FloorplanGeometry
}

export function line(
  a: Vec2,
  b: Vec2,
  style: Partial<FloorplanGeometry & { kind: 'line' }> = {},
): FloorplanGeometry {
  return {
    kind: 'line',
    x1: a[0],
    y1: a[1],
    x2: b[0],
    y2: b[1],
    stroke: INK,
    strokeWidth: WEIGHT.projected,
    ...style,
  } as FloorplanGeometry
}

export function polyline(
  points: readonly Vec2[],
  style: Partial<FloorplanGeometry & { kind: 'polyline' }> = {},
): FloorplanGeometry {
  return {
    kind: 'polyline',
    points: points.map(([x, y]) => [x, y] as const),
    fill: 'none',
    stroke: INK,
    strokeWidth: WEIGHT.projected,
    ...style,
  } as FloorplanGeometry
}

export function label(
  x: number,
  y: number,
  text: string,
  style: Partial<FloorplanGeometry & { kind: 'text' }> = {},
): FloorplanGeometry {
  return {
    kind: 'text',
    x,
    y,
    text,
    fontSize: 0.16,
    fill: INK,
    textAnchor: 'start',
    dominantBaseline: 'alphabetic',
    ...style,
  } as FloorplanGeometry
}

/** Axis-aligned rectangle from two opposite corners, as a polygon. */
export function rectPolygon(x0: number, y0: number, x1: number, y1: number): Vec2[] {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ]
}
