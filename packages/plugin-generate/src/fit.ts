/**
 * Fitting the plan to the lot — PlanCrafters' `generateFit` (gen.js), ported
 * as pure helpers: the buildable envelope's edges as frontages with their
 * perpendicular depths, and the reface candidates when the street-facing
 * frontage cannot take the plan.
 *
 * PlanCrafters measured it: "a 60'-wide × 26'-deep lot fits facing the wide
 * edge; the same lot facing its 26' edge throws" — the generator builds a
 * wide, shallow house happily but not a narrow, deep one. So when the roll
 * cannot narrow the plan to the street frontage, the house is turned to face
 * the widest lot edge that can take it, and the run says so. Nothing is
 * forced: a reface that still crosses a setback is not taken.
 */
type Pt = readonly [number, number]

export interface EdgeFit {
  /** Envelope edge index: the edge runs from `envelope[index]` to `envelope[index + 1]`. */
  index: number
  /** The edge's length — the frontage a house facing it can use. Feet. */
  frontageFt: number
  /** How far the envelope reaches back from that edge, measured square to it. Feet. */
  depthFt: number
}

const FT = 0.3048

/** Every envelope edge as a frontage with its perpendicular depth. Metres in, feet out. */
export function envelopeEdges(envelope: readonly Pt[]): EdgeFit[] {
  const n = envelope.length
  if (n < 3) return []
  // inward from the ring's winding (a centroid test fails on L-shaped lots)
  let area = 0
  for (let k = 0; k < n; k++) {
    const a = envelope[k] as Pt
    const b = envelope[(k + 1) % n] as Pt
    area += a[0] * b[1] - b[0] * a[1]
  }
  const ccw = area > 0
  const out: EdgeFit[] = []
  for (let i = 0; i < n; i++) {
    const p = envelope[i] as Pt
    const q = envelope[(i + 1) % n] as Pt
    const ex = q[0] - p[0]
    const ez = q[1] - p[1]
    const el = Math.hypot(ex, ez)
    if (el < 1e-9) {
      out.push({ index: i, frontageFt: 0, depthFt: 0 })
      continue
    }
    // inward normal: the left normal of a counter-clockwise ring in this frame
    const nx = ccw ? -ez / el : ez / el
    const nz = ccw ? ex / el : -ex / el
    let depth = 0
    for (const v of envelope) depth = Math.max(depth, (v[0] - p[0]) * nx + (v[1] - p[1]) * nz)
    out.push({ index: i, frontageFt: el / FT, depthFt: depth / FT })
  }
  return out
}

/**
 * The edges a house could face instead of `frontEdge`, widest first — only
 * those wider than the street frontage, since the failure is a too-narrow
 * frontage.
 */
/**
 * The BAND a house standing square to the front edge can occupy: at every
 * depth station from the front setback line back to `depthM`, the envelope's
 * chord across the front direction (the run containing the front edge's
 * midpoint); the band is the intersection of those chords. On a rectangle it
 * is the frontage; on a pie / tapered lot (Steve, 2026-09-09, 2544 Beatrice
 * Ln, Modesto: "the procedural designs go into the setbacks") it is the
 * narrowest chord the house reaches, and its centre is where the house
 * should stand — not the front edge's midpoint. `offsetM` is that centre
 * along the front edge's direction from the edge's midpoint (+ toward the
 * edge's end vertex).
 */
export function bandFit(
  envelope: readonly Pt[],
  frontEdge: number,
  depthM: number,
  stepM = 0.5,
  minWidthM = 0,
): { widthFt: number; offsetM: number; depthFt: number } {
  const n = envelope.length
  if (n < 3) return { widthFt: 0, offsetM: 0, depthFt: 0 }
  const i = ((frontEdge % n) + n) % n
  const p = envelope[i] as Pt
  const q = envelope[(i + 1) % n] as Pt
  const ex = q[0] - p[0]
  const ez = q[1] - p[1]
  const el = Math.hypot(ex, ez)
  if (el < 1e-9) return { widthFt: 0, offsetM: 0, depthFt: 0 }
  const ux = ex / el
  const uz = ez / el
  let area = 0
  for (let k = 0; k < n; k++) {
    const a = envelope[k] as Pt
    const b = envelope[(k + 1) % n] as Pt
    area += a[0] * b[1] - b[0] * a[1]
  }
  const ccw = area > 0
  // inward normal (the left normal of a counter-clockwise ring in this frame)
  const nx = ccw ? -uz : uz
  const nz = ccw ? ux : -ux
  const mx = (p[0] + q[0]) / 2
  const mz = (p[1] + q[1]) / 2
  // every vertex in the (lateral t, depth d) frame of the front edge
  const local = envelope.map((v): Pt => [
    (v[0] - mx) * ux + (v[1] - mz) * uz,
    (v[0] - mx) * nx + (v[1] - mz) * nz,
  ])
  let maxDepth = 0
  for (const v of local) maxDepth = Math.max(maxDepth, v[1])
  const chordAt = (d: number): [number, number] | null => {
    const ts: number[] = []
    for (let k = 0; k < n; k++) {
      const a = local[k] as Pt
      const b = local[(k + 1) % n] as Pt
      const da = a[1] - d
      const db = b[1] - d
      if (Math.abs(da) < 1e-9 && Math.abs(db) < 1e-9) {
        ts.push(a[0], b[0])
        continue
      }
      if ((da < 0 && db < 0) || (da > 0 && db > 0)) continue
      if (Math.abs(da - db) < 1e-12) continue
      const f = da / (da - db)
      if (f < -1e-9 || f > 1 + 1e-9) continue
      ts.push(a[0] + (b[0] - a[0]) * f)
    }
    if (ts.length < 2) return null
    ts.sort((a, b) => a - b)
    // the run holding t = 0 (the front edge's midpoint), else the widest
    let best: [number, number] | null = null
    for (let k = 0; k + 1 < ts.length; k += 2) {
      const lo = ts[k] as number
      const hi = ts[k + 1] as number
      if (lo <= 1e-6 && hi >= -1e-6) return [lo, hi]
      if (!best || hi - lo > best[1] - best[0]) best = [lo, hi]
    }
    return best
  }
  // Walk the stations from the front line to the back of the envelope. The
  // band at the asked depth is the intersection of the chords up to it; the
  // band's DEPTH is where that intersection first narrows under `minWidthM`
  // — the narrowest house the caller would build (a tilted rear line or a
  // pie lot squeezes the last stations to a sliver no house reaches). A depth past the band's
  // depth is answered with the band AT its depth, so the caller sees the
  // plan is too deep from depthFt rather than from a collapsed band
  // (2026-09-09: the Modesto lot's rear line runs 4 cm out of square; the
  // band asked 8 ft past it collapsed to a 6 ft sliver at one corner and
  // its centre put the house outside the lot).
  const depth = Math.max(0, depthM)
  const stations: number[] = []
  for (let d = 0.01; d < maxDepth; d += stepM) stations.push(d)
  stations.push(Math.max(0.01, maxDepth - 0.01))
  if (depth > 0.01 && depth < maxDepth - 0.01) stations.push(depth - 0.01)
  stations.sort((a, b) => a - b)
  let lo = Number.NEGATIVE_INFINITY
  let hi = Number.POSITIVE_INFINITY
  let atDepth: [number, number] | null = null
  let reached = 0
  for (const d of stations) {
    const c = chordAt(d)
    if (!c) continue
    const nlo = Math.max(lo, c[0])
    const nhi = Math.min(hi, c[1])
    if (nhi - nlo < Math.max(minWidthM, 1e-6)) break
    lo = nlo
    hi = nhi
    reached = d
    if (d <= depth) atDepth = [lo, hi]
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return { widthFt: 0, offsetM: 0, depthFt: 0 }
  const band = atDepth ?? [lo, hi]
  return { widthFt: (band[1] - band[0]) / FT, offsetM: (band[0] + band[1]) / 2, depthFt: (reached + 0.01) / FT }
}

export function refaceCandidates(edges: readonly EdgeFit[], frontEdge: number): EdgeFit[] {
  const street = edges[frontEdge]
  if (!street) return []
  return edges
    .filter((e) => e.index !== frontEdge && e.frontageFt > street.frontageFt + 0.5)
    .sort((a, b) => b.frontageFt - a.frontageFt)
}

/** True when the roll said the plan crosses a side or the rear setback. */
export function crossesSetback(warnings: readonly string[]): boolean {
  return warnings.some((w) => /cross a side setback|cross the rear setback/.test(w))
}

/** The note a refaced run carries. */
export function refaceNote(street: EdgeFit, chosen: EdgeFit): string {
  return (
    `The street-facing side (${street.frontageFt.toFixed(0)}' buildable) was too narrow for this plan, so the house faces lot edge ${chosen.index + 1} ` +
    `(${chosen.frontageFt.toFixed(0)}') instead — pick the street side in the Site panel to turn it back, or ask for a smaller plan.`
  )
}
