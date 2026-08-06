import type { CadBounds } from './types'

/**
 * 2D affine transform, column-major like the DXF/OCS conventions:
 *   x' = a·x + c·y + e
 *   y' = b·x + d·y + f
 *
 * Used for block-reference (INSERT) placement and for the OCS mirror that a
 * negative extrusion direction implies. Curves are always sampled in their
 * own coordinate space and the resulting *points* are transformed, so mirror
 * and non-uniform scale come out right without any special-casing.
 */
export type Transform2D = {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export const IDENTITY: Transform2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

export function composeTransform(outer: Transform2D, inner: Transform2D): Transform2D {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  }
}

export function insertTransform(
  x: number,
  y: number,
  scaleX: number,
  scaleY: number,
  rotationRad: number,
): Transform2D {
  const cos = Math.cos(rotationRad)
  const sin = Math.sin(rotationRad)
  return {
    a: cos * scaleX,
    b: sin * scaleX,
    c: -sin * scaleY,
    d: cos * scaleY,
    e: x,
    f: y,
  }
}

/**
 * Uniform-ish scale a transform applies, used to evaluate curve tolerance in
 * the final coordinate space: a block scaled 100× must be tessellated 100×
 * finer or its arcs read as polygons.
 */
export function transformScale(t: Transform2D): number {
  return Math.sqrt(Math.abs(t.a * t.d - t.b * t.c)) || 1
}

/**
 * Growable segment sink. Parsing a 13 MB drawing emits a few hundred thousand
 * segments; pushing onto a plain array of tuples would allocate one object per
 * segment. Two parallel typed arrays with doubling growth keep it flat.
 */
export class SegmentSink {
  private xy: Float64Array
  private layers: Uint16Array
  private count = 0

  minX = Number.POSITIVE_INFINITY
  minY = Number.POSITIVE_INFINITY
  maxX = Number.NEGATIVE_INFINITY
  maxY = Number.NEGATIVE_INFINITY

  constructor(initialCapacity = 4096) {
    this.xy = new Float64Array(initialCapacity * 4)
    this.layers = new Uint16Array(initialCapacity)
  }

  get length(): number {
    return this.count
  }

  push(x1: number, y1: number, x2: number, y2: number, layer: number): void {
    // Zero-length segments carry no geometry but would still occupy a slot in
    // the snap index and a moveto/lineto in the SVG path. CAD files are full
    // of them (duplicate vertices, degenerate polyline closes).
    if (x1 === x2 && y1 === y2) return
    if (!(Number.isFinite(x1) && Number.isFinite(y1) && Number.isFinite(x2) && Number.isFinite(y2)))
      return

    if (this.count === this.layers.length) this.grow()

    const base = this.count * 4
    this.xy[base] = x1
    this.xy[base + 1] = y1
    this.xy[base + 2] = x2
    this.xy[base + 3] = y2
    this.layers[this.count] = layer
    this.count++

    if (x1 < this.minX) this.minX = x1
    if (x1 > this.maxX) this.maxX = x1
    if (y1 < this.minY) this.minY = y1
    if (y1 > this.maxY) this.maxY = y1
    if (x2 < this.minX) this.minX = x2
    if (x2 > this.maxX) this.maxX = x2
    if (y2 < this.minY) this.minY = y2
    if (y2 > this.maxY) this.maxY = y2
  }

  private grow(): void {
    const nextXy = new Float64Array(this.xy.length * 2)
    nextXy.set(this.xy)
    this.xy = nextXy
    const nextLayers = new Uint16Array(this.layers.length * 2)
    nextLayers.set(this.layers)
    this.layers = nextLayers
  }

  bounds(): CadBounds {
    if (this.count === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
    return { minX: this.minX, minY: this.minY, maxX: this.maxX, maxY: this.maxY }
  }

  segments(): Float64Array {
    return this.xy.slice(0, this.count * 4)
  }

  segmentLayers(): Uint16Array {
    return this.layers.slice(0, this.count)
  }
}

function apply(t: Transform2D, x: number, y: number): [number, number] {
  return [t.a * x + t.c * y + t.e, t.b * x + t.d * y + t.f]
}

export function emitLine(
  sink: SegmentSink,
  layer: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  t: Transform2D,
): void {
  const [ax, ay] = apply(t, x1, y1)
  const [bx, by] = apply(t, x2, y2)
  sink.push(ax, ay, bx, by, layer)
}

/**
 * Curve tessellation budget.
 *
 * `absolute` is a sagitta in drawing units — the right control when the
 * drawing declares its units, because it pins the error to a real-world size
 * (2 mm stays 2 mm whether the file is in millimetres or feet).
 *
 * `relative` is a fraction of each curve's own radius, used when the drawing
 * is unitless and an absolute figure would be meaningless: pick 0.5 for a
 * drawing that turns out to be in metres and every circle collapses to a
 * single chord.
 */
export type Tolerance = {
  absolute: number | null
  relative: number
}

export function resolveTolerance(tolerance: Tolerance, radius: number): number {
  return tolerance.absolute ?? radius * tolerance.relative
}

/**
 * Number of chords needed to keep an arc's sagitta within tolerance.
 *
 * sagitta = r·(1 − cos(θ/2)) for a step angle θ, so the largest admissible
 * step is θ = 2·acos(1 − tolerance/r). When tolerance ≥ r the arc is smaller
 * than the error budget and a single chord will do.
 */
export function arcStepCount(radius: number, sweep: number, tolerance: number): number {
  const absSweep = Math.abs(sweep)
  if (absSweep < 1e-12) return 0
  if (!(radius > 0) || tolerance >= radius) return 1

  const step = 2 * Math.acos(1 - tolerance / radius)
  if (!(step > 1e-9)) return MAX_ARC_STEPS
  return Math.min(MAX_ARC_STEPS, Math.max(1, Math.ceil(absSweep / step)))
}

// A tessellation ceiling per curve. Without it a drawing with a kilometre-radius
// arc and a millimetre tolerance emits millions of segments from one entity.
const MAX_ARC_STEPS = 512

export function emitArc(
  sink: SegmentSink,
  layer: number,
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  sweep: number,
  tolerance: Tolerance,
  t: Transform2D,
): void {
  // Tolerance is evaluated in the *final* coordinate space: a block scaled
  // 100× has to be tessellated 100× finer or its arcs read as polygons.
  const scaledRadius = radius * transformScale(t)
  const steps = arcStepCount(scaledRadius, sweep, resolveTolerance(tolerance, scaledRadius))
  if (steps === 0) return

  let [px, py] = apply(t, cx + radius * Math.cos(startAngle), cy + radius * Math.sin(startAngle))
  for (let i = 1; i <= steps; i++) {
    const angle = startAngle + (sweep * i) / steps
    const [qx, qy] = apply(t, cx + radius * Math.cos(angle), cy + radius * Math.sin(angle))
    sink.push(px, py, qx, qy, layer)
    px = qx
    py = qy
  }
}

/**
 * An ellipse or elliptical arc.
 *
 * DXF stores the major axis as a vector from the centre and the minor axis as
 * a ratio of it, so the ellipse carries its own rotation — there is no separate
 * angle to apply. `start` and `end` are parameters, not angles: the point at
 * parameter t is `centre + major·cos t + minor·sin t`, which only coincides
 * with the geometric angle on a circle.
 */
export function emitEllipse(
  sink: SegmentSink,
  layer: number,
  cx: number,
  cy: number,
  majorX: number,
  majorY: number,
  ratio: number,
  start: number,
  end: number,
  tolerance: Tolerance,
  t: Transform2D,
): void {
  const majorLength = Math.hypot(majorX, majorY)
  if (!(majorLength > 0)) return

  const minorX = -majorY * ratio
  const minorY = majorX * ratio

  let sweep = end - start
  while (sweep <= 0) sweep += TAU
  if (sweep > TAU) sweep = TAU

  // Tessellate against the larger semi-axis: budget for the tightest part of
  // the curve, or a flat ellipse reads as a polygon at its ends.
  const scaled = majorLength * Math.max(1, Math.abs(ratio)) * transformScale(t)
  const steps = arcStepCount(scaled, sweep, resolveTolerance(tolerance, scaled))
  if (steps === 0) return

  const at = (param: number): [number, number] => {
    const cos = Math.cos(param)
    const sin = Math.sin(param)
    return apply(t, cx + majorX * cos + minorX * sin, cy + majorY * cos + minorY * sin)
  }

  let [px, py] = at(start)
  for (let i = 1; i <= steps; i++) {
    const [qx, qy] = at(start + (sweep * i) / steps)
    sink.push(px, py, qx, qy, layer)
    px = qx
    py = qy
  }
}

const TAU = Math.PI * 2

/**
 * A polyline segment carrying a bulge — DXF's way of storing a circular arc
 * between two vertices. `bulge` is tan(Δ/4) of the included angle, signed:
 * positive sweeps counter-clockwise.
 */
export function emitBulge(
  sink: SegmentSink,
  layer: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  bulge: number,
  tolerance: Tolerance,
  t: Transform2D,
): void {
  if (bulge === 0) {
    emitLine(sink, layer, x1, y1, x2, y2, t)
    return
  }

  const sweep = 4 * Math.atan(bulge)
  const dx = x2 - x1
  const dy = y2 - y1
  const chord = Math.hypot(dx, dy)
  if (chord < 1e-12) return

  const radius = chord / (2 * Math.sin(Math.abs(sweep) / 2))
  // Centre sits on the chord's perpendicular bisector, offset by the apothem.
  // The sign of `bulge` picks which side, which is what makes the arc bulge
  // left or right of the direction of travel.
  const apothem = radius * Math.cos(sweep / 2)
  const midX = (x1 + x2) / 2
  const midY = (y1 + y2) / 2
  const nx = -dy / chord
  const ny = dx / chord
  const cx = midX + nx * apothem * Math.sign(bulge)
  const cy = midY + ny * apothem * Math.sign(bulge)

  const startAngle = Math.atan2(y1 - cy, x1 - cx)
  emitArc(sink, layer, cx, cy, radius, startAngle, sweep, tolerance, t)
}
