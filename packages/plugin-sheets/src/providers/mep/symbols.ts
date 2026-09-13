/**
 * The standard residential electrical symbol set, as plan geometry.
 *
 * Every builder returns primitives in LEVEL-LOCAL METRES around the origin,
 * wrapped by the caller in a `group` translated to the device's plan point —
 * so a symbol is defined once and stamped wherever the engine put the device.
 *
 * SIZE. Electrical symbols are drawn to a fixed PAPER size, not to scale: a
 * duplex receptacle is a 3/16-in circle on the sheet whether the plan is at
 * 1/4" or 1/8". The builders take a `unit` in metres — the world length that
 * prints as one symbol module — which the provider derives from the
 * viewport's scale (`symbolUnit`). At 1/4" = 1'-0" that is ~0.22 m, so the
 * receptacle circle reads at 3/16 in of paper exactly as it does on a hand
 * drawn sheet.
 *
 * The vocabulary follows the reference set (AE Drafting A10, the symbols
 * legend): circle-with-ticks receptacle, `S` switch, four-spoke ceiling
 * light, square-in-circle recessed can, `SD`/`CO` alarms, filled panel
 * rectangle, and the tag letters that qualify them (GFCI, WP, TR, 240V).
 */
import type { FloorplanGeometry } from '@pascal-app/core'
import { INCHES_PER_METRE } from '../../scale'

export const SYMBOL_INK = '#111827'
export const SYMBOL_ACCENT = '#7c2d12'
export const PAPER_WHITE = '#ffffff'
export const SANS = '"IBM Plex Sans", "Helvetica Neue", Helvetica, Arial, sans-serif'

/**
 * The world length that prints as 3/16 in of paper at this drawing scale —
 * the module every symbol is built from. Clamped so an absurd scale cannot
 * produce a symbol larger than a room or smaller than a printer dot.
 */
export function symbolUnit(scale: number): number {
  const metres = (0.1875 * scale) / INCHES_PER_METRE
  return Math.max(0.05, Math.min(0.6, metres))
}

/** Line weight for symbol linework, in metres at this scale. */
export function symbolStroke(unit: number): number {
  return unit * 0.11
}

export type SymbolStyle = {
  unit: number
  stroke: number
  ink: string
}

export function styleFor(scale: number, ink = SYMBOL_INK): SymbolStyle {
  const unit = symbolUnit(scale)
  return { unit, stroke: symbolStroke(unit), ink }
}

/* ------------------------------------------------------------- text */

/**
 * A tag beside a symbol (circuit number, GFCI, WP, 240V). `dy` is measured in
 * symbol units so tags stack clear of the glyph at any scale.
 */
export function tag(
  s: SymbolStyle,
  text: string,
  dx: number,
  dy: number,
  options: { anchor?: 'start' | 'middle' | 'end'; size?: number; fill?: string } = {},
): FloorplanGeometry {
  return {
    kind: 'text',
    x: dx,
    y: dy,
    text,
    fontSize: s.unit * (options.size ?? 0.62),
    fill: options.fill ?? s.ink,
    fontWeight: 700,
    fontFamily: SANS,
    textAnchor: options.anchor ?? 'middle',
  }
}

/** Text centred inside a glyph. */
function glyphText(s: SymbolStyle, text: string, size = 0.66, fill?: string): FloorplanGeometry {
  return {
    kind: 'text',
    x: 0,
    y: s.unit * size * 0.36,
    text,
    fontSize: s.unit * size,
    fill: fill ?? s.ink,
    fontWeight: 800,
    fontFamily: SANS,
    textAnchor: 'middle',
  }
}

/* ------------------------------------------------- receptacle family */

/**
 * Duplex receptacle: a circle on the wall line with two parallel ticks
 * running out of it towards the room — the standard NEMA duplex symbol.
 * `rotation` is the device's `rotationY`; the ticks point along the wall's
 * outward normal so the symbol reads as mounted ON that wall.
 */
export function duplexReceptacle(s: SymbolStyle, options: { poles?: 2 | 3 } = {}): FloorplanGeometry[] {
  const r = s.unit * 0.5
  const out: FloorplanGeometry[] = [
    { kind: 'circle', cx: 0, cy: 0, r, fill: PAPER_WHITE, stroke: s.ink, strokeWidth: s.stroke },
    // The bar across the face and the two (or three) straps through it.
    { kind: 'line', x1: -r, y1: 0, x2: r, y2: 0, stroke: s.ink, strokeWidth: s.stroke },
  ]
  const poles = options.poles ?? 2
  const spread = r * 0.5
  for (let i = 0; i < poles; i++) {
    const x = poles === 2 ? (i === 0 ? -spread : spread) : (i - 1) * spread
    out.push({
      kind: 'line',
      x1: x,
      y1: 0,
      x2: x,
      y2: -r * 1.25,
      stroke: s.ink,
      strokeWidth: s.stroke * 0.8,
    })
  }
  return out
}

/** Split-wired / dedicated appliance receptacle — filled face. */
export function dedicatedReceptacle(s: SymbolStyle): FloorplanGeometry[] {
  const r = s.unit * 0.5
  return [
    { kind: 'circle', cx: 0, cy: 0, r, fill: s.ink, stroke: s.ink, strokeWidth: s.stroke },
    { kind: 'line', x1: -r, y1: 0, x2: r, y2: 0, stroke: PAPER_WHITE, strokeWidth: s.stroke },
  ]
}

/* ----------------------------------------------------- switch family */

/** Wall switch. `S` for single-pole, `S3` where the engine grouped 3-ways. */
export function switchSymbol(s: SymbolStyle, threeWay: boolean): FloorplanGeometry[] {
  return [
    {
      kind: 'text',
      x: 0,
      y: s.unit * 0.42,
      text: threeWay ? 'S3' : 'S',
      fontSize: s.unit * 1.15,
      fill: s.ink,
      fontWeight: 800,
      fontFamily: SANS,
      textAnchor: 'middle',
    },
  ]
}

/* ---------------------------------------------------- lighting family */

/** Ceiling-mounted luminaire: a circle with four spokes. */
export function ceilingLight(s: SymbolStyle): FloorplanGeometry[] {
  const r = s.unit * 0.46
  const arm = s.unit * 0.9
  const out: FloorplanGeometry[] = [
    { kind: 'circle', cx: 0, cy: 0, r, fill: PAPER_WHITE, stroke: s.ink, strokeWidth: s.stroke },
  ]
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    out.push({
      kind: 'line',
      x1: dx * r,
      y1: dy * r,
      x2: dx * arm,
      y2: dy * arm,
      stroke: s.ink,
      strokeWidth: s.stroke * 0.85,
    })
  }
  return out
}

/** Recessed can: a circle inside a square. */
export function recessedLight(s: SymbolStyle): FloorplanGeometry[] {
  const half = s.unit * 0.62
  return [
    {
      kind: 'rect',
      x: -half,
      y: -half,
      width: half * 2,
      height: half * 2,
      fill: PAPER_WHITE,
      stroke: s.ink,
      strokeWidth: s.stroke,
    },
    {
      kind: 'circle',
      cx: 0,
      cy: 0,
      r: half * 0.62,
      fill: 'none',
      stroke: s.ink,
      strokeWidth: s.stroke * 0.85,
    },
  ]
}

/** Paddle fan: a hub with four blades. */
export function ceilingFan(s: SymbolStyle): FloorplanGeometry[] {
  const hub = s.unit * 0.24
  const blade = s.unit * 1.15
  const out: FloorplanGeometry[] = [
    { kind: 'circle', cx: 0, cy: 0, r: hub, fill: PAPER_WHITE, stroke: s.ink, strokeWidth: s.stroke },
  ]
  for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
    const c = Math.cos(angle)
    const sn = Math.sin(angle)
    out.push({
      kind: 'polygon',
      points: [
        [hub * c, hub * sn],
        [blade * c - hub * 0.7 * sn, blade * sn + hub * 0.7 * c],
        [blade * c + hub * 0.7 * sn, blade * sn - hub * 0.7 * c],
      ],
      fill: PAPER_WHITE,
      stroke: s.ink,
      strokeWidth: s.stroke * 0.8,
    })
  }
  return out
}

/** Exhaust fan: a square with a diagonal cross and the EF letters. */
export function exhaustFan(s: SymbolStyle): FloorplanGeometry[] {
  const half = s.unit * 0.68
  return [
    {
      kind: 'rect',
      x: -half,
      y: -half,
      width: half * 2,
      height: half * 2,
      fill: PAPER_WHITE,
      stroke: s.ink,
      strokeWidth: s.stroke,
    },
    { kind: 'line', x1: -half, y1: -half, x2: half, y2: half, stroke: s.ink, strokeWidth: s.stroke * 0.7 },
    { kind: 'line', x1: half, y1: -half, x2: -half, y2: half, stroke: s.ink, strokeWidth: s.stroke * 0.7 },
  ]
}

/* ------------------------------------------------------ alarm family */

/** Smoke / CO alarm: a circle with its letters inside. */
export function alarm(s: SymbolStyle, letters: string): FloorplanGeometry[] {
  const r = s.unit * 0.72
  return [
    { kind: 'circle', cx: 0, cy: 0, r, fill: PAPER_WHITE, stroke: s.ink, strokeWidth: s.stroke },
    glyphText(s, letters, 0.66),
  ]
}

/* --------------------------------------------------- service family */

/** Panel: a filled rectangle with reversed-out letters. */
export function panelSymbol(s: SymbolStyle, letters = 'P'): FloorplanGeometry[] {
  const w = s.unit * 1.7
  const h = s.unit * 0.95
  return [
    {
      kind: 'rect',
      x: -w / 2,
      y: -h / 2,
      width: w,
      height: h,
      fill: s.ink,
      stroke: s.ink,
      strokeWidth: s.stroke,
    },
    glyphText(s, letters, 0.7, PAPER_WHITE),
  ]
}

/** Meter: a circle with its letter, drawn heavier than a device. */
export function meterSymbol(s: SymbolStyle, letter = 'M'): FloorplanGeometry[] {
  const r = s.unit * 0.75
  return [
    { kind: 'circle', cx: 0, cy: 0, r, fill: PAPER_WHITE, stroke: s.ink, strokeWidth: s.stroke * 1.3 },
    glyphText(s, letter, 0.72),
  ]
}

/** Disconnect / junction: a square with its letters. */
export function boxSymbol(s: SymbolStyle, letters: string): FloorplanGeometry[] {
  const half = s.unit * 0.62
  return [
    {
      kind: 'rect',
      x: -half,
      y: -half,
      width: half * 2,
      height: half * 2,
      fill: PAPER_WHITE,
      stroke: s.ink,
      strokeWidth: s.stroke,
    },
    glyphText(s, letters, 0.6),
  ]
}

/** Thermostat: a circle with a T. */
export function thermostat(s: SymbolStyle): FloorplanGeometry[] {
  const r = s.unit * 0.55
  return [
    { kind: 'circle', cx: 0, cy: 0, r, fill: PAPER_WHITE, stroke: s.ink, strokeWidth: s.stroke },
    glyphText(s, 'T', 0.62),
  ]
}

/* ------------------------------------------------- plumbing symbols */

/**
 * Plumbing rough-in point: a hexagon, the mark used for stub-outs and
 * vent/waste penetrations on the reference plumbing sheet.
 */
export function hexMark(s: SymbolStyle, letters: string, ink: string): FloorplanGeometry[] {
  const r = s.unit * 0.75
  const points: [number, number][] = []
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2
    points.push([r * Math.cos(a), r * Math.sin(a)])
  }
  return [
    { kind: 'polygon', points, fill: PAPER_WHITE, stroke: ink, strokeWidth: s.stroke },
    { ...glyphText(s, letters, 0.56, ink) },
  ]
}

/** Vent stack: a circle with a cross through it. */
export function ventStack(s: SymbolStyle, ink: string): FloorplanGeometry[] {
  const r = s.unit * 0.62
  return [
    { kind: 'circle', cx: 0, cy: 0, r, fill: PAPER_WHITE, stroke: ink, strokeWidth: s.stroke },
    { kind: 'line', x1: -r, y1: 0, x2: r, y2: 0, stroke: ink, strokeWidth: s.stroke * 0.8 },
    { kind: 'line', x1: 0, y1: -r, x2: 0, y2: r, stroke: ink, strokeWidth: s.stroke * 0.8 },
  ]
}

/* ------------------------------------------------------------ frame */

/**
 * Stamp a symbol at a plan point. Wall-mounted symbols take the device's
 * `rotationY` so their ticks face out of the wall; ceiling symbols pass 0.
 *
 * The Bones fixture rotation is a Y-axis rotation in the 3D frame; in plan
 * (x east, y = z south) that is the same angle measured the same way, which
 * is why it is handed straight to the group transform.
 */
export function stamp(
  children: FloorplanGeometry[],
  x: number,
  y: number,
  rotation = 0,
): FloorplanGeometry {
  return { kind: 'group', transform: { translate: [x, y], rotate: rotation }, children }
}
