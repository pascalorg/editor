/**
 * Drawing vocabulary for the S-series: line weights, hidden lines, member
 * symbols, tags and callouts — all in LEVEL-LOCAL WORLD METRES, because a
 * structural plan is a live window.
 *
 * LINE WEIGHT IS A LANGUAGE on a structural sheet, and it has to survive the
 * scale: a "heavy" line is heavy in INCHES OF PAPER, not in metres of world.
 * Everything here is therefore specified in paper inches and converted once
 * through the viewport's drawing scale (`world = paperInches × scale ×
 * 0.0254`). The same 0.026 in cut line reads identically at 1/4" = 1'-0" and
 * at 1/8".
 *
 * The conventions follow the reference sheets (a WCD S1.0 / S5.0 / S6.0 set):
 *  - cut/bearing walls heavy, non-bearing medium, background light;
 *  - anything below or behind the cut (footings, beams over) DASHED;
 *  - beam / footing tags in circles and hexagons;
 *  - joist and rafter runs called out with a double-headed extent arrow.
 */
import type { FloorplanGeometry } from '@pascal-app/core'
import type { Pt } from './model'

export const INK = '#111827'
export const INK_MID = '#4b5563'
export const INK_SOFT = '#9ca3af'
export const INK_FAINT = '#d1d5db'
export const SANS = '"IBM Plex Sans", "Helvetica Neue", Helvetica, Arial, sans-serif'
export const MONO = '"IBM Plex Mono", "SFMono-Regular", Menlo, Consolas, monospace'

/** Paper widths, inches — the pen set a drafter would load. */
export const PEN = {
  hair: 0.005,
  thin: 0.008,
  light: 0.011,
  medium: 0.016,
  heavy: 0.026,
  extraHeavy: 0.038,
} as const

/** Paper text heights, inches. */
export const TYPE = {
  micro: 0.062,
  small: 0.078,
  body: 0.094,
  large: 0.125,
  title: 0.16,
} as const

/**
 * The paper→world converter for one viewport. `scale` is the plain world:paper
 * ratio the sheet carries (48 = 1/4" = 1'-0").
 */
export type Pen = {
  scale: number
  /** Paper inches → world metres. */
  w: (paperInches: number) => number
  /** A dash pattern given in paper inches. */
  dash: (...paperInches: number[]) => string
}

export function pen(scale: number): Pen {
  const factor = Math.max(1, scale) * 0.0254
  const w = (paperInches: number) => paperInches * factor
  return {
    scale,
    w,
    dash: (...parts: number[]) => parts.map((p) => w(p).toFixed(4)).join(' '),
  }
}

/* ------------------------------------------------------------- shapes */

export function polyline(points: readonly Pt[], style: Record<string, unknown>): FloorplanGeometry {
  return { kind: 'polyline', points: points.map((p) => [p[0], p[1]] as [number, number]), ...style }
}

export function polygon(points: readonly Pt[], style: Record<string, unknown>): FloorplanGeometry {
  return { kind: 'polygon', points: points.map((p) => [p[0], p[1]] as [number, number]), ...style }
}

export function line(a: Pt, b: Pt, style: Record<string, unknown>): FloorplanGeometry {
  return { kind: 'line', x1: a[0], y1: a[1], x2: b[0], y2: b[1], ...style }
}

export function dot(at: Pt, r: number, fill = INK): FloorplanGeometry {
  return { kind: 'circle', cx: at[0], cy: at[1], r, fill, stroke: 'none' }
}

export function square(at: Pt, side: number, style: Record<string, unknown>): FloorplanGeometry {
  return {
    kind: 'rect',
    x: at[0] - side / 2,
    y: at[1] - side / 2,
    width: side,
    height: side,
    ...style,
  }
}

export function text(
  at: Pt,
  value: string,
  size: number,
  options: {
    fill?: string
    weight?: number
    anchor?: 'start' | 'middle' | 'end'
    family?: string
    opacity?: number
  } = {},
): FloorplanGeometry {
  return {
    kind: 'text',
    x: at[0],
    y: at[1],
    text: value,
    fontSize: size,
    fill: options.fill ?? INK,
    fontWeight: options.weight ?? 400,
    fontFamily: options.family ?? SANS,
    textAnchor: options.anchor ?? 'start',
    ...(options.opacity !== undefined ? { opacity: options.opacity } : {}),
  }
}

/* -------------------------------------------------------------- tags */

/**
 * A tag bubble — the mark that ties a member on the plan to its row in a
 * schedule. `shape: 'hex'` is the footing/beam-type convention on the
 * reference set; 'circle' is the detail/keynote convention.
 */
export function tag(
  at: Pt,
  label: string,
  radius: number,
  p: Pen,
  shape: 'circle' | 'hex' = 'circle',
): FloorplanGeometry {
  const body: FloorplanGeometry =
    shape === 'circle'
      ? {
          kind: 'circle',
          cx: at[0],
          cy: at[1],
          r: radius,
          fill: '#ffffff',
          stroke: INK,
          strokeWidth: p.w(PEN.light),
        }
      : polygon(hexPoints(at, radius), {
          fill: '#ffffff',
          stroke: INK,
          strokeWidth: p.w(PEN.light),
        })
  return {
    kind: 'group',
    children: [
      body,
      text([at[0], at[1] + radius * 0.36], label, radius * 1.05, {
        weight: 700,
        anchor: 'middle',
        family: MONO,
      }),
    ],
  }
}

function hexPoints(at: Pt, r: number): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2
    out.push([at[0] + r * Math.cos(a), at[1] + r * Math.sin(a)])
  }
  return out
}

/* ----------------------------------------------------------- callouts */

/**
 * A leadered note: a short leader from `from` to `to` with a solid arrow
 * head, then the text on a horizontal shoulder. The workhorse annotation of
 * a framing plan ("2x10 @ 16" O.C.", "4" CONC. SLAB ON GRADE …").
 */
export function callout(
  from: Pt,
  to: Pt,
  lines: string[],
  p: Pen,
  options: { anchor?: 'start' | 'end'; size?: number } = {},
): FloorplanGeometry[] {
  const size = options.size ?? p.w(TYPE.small)
  const anchor = options.anchor ?? 'start'
  const shoulder: Pt = [to[0] + (anchor === 'start' ? p.w(0.16) : -p.w(0.16)), to[1]]
  const out: FloorplanGeometry[] = [
    polyline([from, to, shoulder], {
      stroke: INK,
      strokeWidth: p.w(PEN.thin),
      fill: 'none',
      strokeLinecap: 'round',
    }),
    ...arrowHead(to, from, p.w(0.05), p),
  ]
  const start: Pt = [shoulder[0] + (anchor === 'start' ? p.w(0.03) : -p.w(0.03)), shoulder[1]]
  lines.forEach((value, i) => {
    out.push(
      text([start[0], start[1] - size * 0.35 + i * size * 1.25], value, size, {
        anchor,
        weight: i === 0 ? 600 : 400,
      }),
    )
  })
  return out
}

/** A solid triangular arrow head at `at`, pointing away from `from`. */
export function arrowHead(at: Pt, from: Pt, size: number, p: Pen): FloorplanGeometry[] {
  const dx = at[0] - from[0]
  const dy = at[1] - from[1]
  const len = Math.hypot(dx, dy)
  if (len < 1e-9) return []
  const ux = dx / len
  const uy = dy / len
  const base: Pt = [at[0] - ux * size, at[1] - uy * size]
  const half = size * 0.32
  return [
    polygon(
      [
        [at[0], at[1]],
        [base[0] - uy * half, base[1] + ux * half],
        [base[0] + uy * half, base[1] - ux * half],
      ],
      { fill: INK, stroke: 'none', strokeWidth: p.w(PEN.hair) },
    ),
  ]
}

/**
 * A framing DIRECTION / EXTENT arrow: a double-headed line spanning the run
 * of a joist or rafter family with its size-and-spacing note riding on it.
 * This is how a framing plan says "these members run this way, this far".
 */
export function extentArrow(a: Pt, b: Pt, label: string, p: Pen): FloorplanGeometry[] {
  const head = p.w(0.07)
  const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0])
  // Text always reads left-to-right: flip the label side, never the text.
  const flip = Math.abs(angle) > Math.PI / 2
  const size = p.w(TYPE.body)
  const offset = size * 0.6
  const nx = -Math.sin(angle)
  const ny = Math.cos(angle)
  return [
    line(a, b, { stroke: INK, strokeWidth: p.w(PEN.medium), strokeLinecap: 'butt' }),
    ...arrowHead(a, b, head, p),
    ...arrowHead(b, a, head, p),
    {
      kind: 'group',
      transform: {
        translate: [mid[0] - nx * offset, mid[1] - ny * offset],
        rotate: flip ? angle + Math.PI : angle,
      },
      children: [text([0, 0], label, size, { anchor: 'middle', weight: 700 })],
    },
  ]
}

/* ------------------------------------------------------------ hatches */

/**
 * Diagonal hatch inside an axis-aligned box — concrete/pad hatching where a
 * pour is called out. Clipped to the box by construction (the lines are
 * generated inside it), so no clip path is needed in the primitive stream.
 */
export function diagonalHatch(
  points: readonly Pt[],
  spacing: number,
  style: Record<string, unknown>,
): FloorplanGeometry[] {
  if (points.length < 3) return []
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const [x, y] of points) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  const out: FloorplanGeometry[] = []
  const span = maxX - minX + (maxY - minY)
  for (let t = 0; t <= span; t += spacing) {
    const a: Pt = [minX + t, minY]
    const b: Pt = [minX + t - (maxY - minY), maxY]
    // Trim to the box; a segment fully outside is skipped.
    const clipped = clipSegmentToBox(a, b, minX, minY, maxX, maxY)
    if (clipped) out.push(line(clipped[0], clipped[1], style))
  }
  return out
}

function clipSegmentToBox(
  a: Pt,
  b: Pt,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): [Pt, Pt] | null {
  let t0 = 0
  let t1 = 1
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const tests: [number, number][] = [
    [-dx, a[0] - minX],
    [dx, maxX - a[0]],
    [-dy, a[1] - minY],
    [dy, maxY - a[1]],
  ]
  for (const [pv, qv] of tests) {
    if (Math.abs(pv) < 1e-12) {
      if (qv < 0) return null
      continue
    }
    const r = qv / pv
    if (pv < 0) {
      if (r > t1) return null
      if (r > t0) t0 = r
    } else {
      if (r < t0) return null
      if (r < t1) t1 = r
    }
  }
  return [
    [a[0] + t0 * dx, a[1] + t0 * dy],
    [a[0] + t1 * dx, a[1] + t1 * dy],
  ]
}
