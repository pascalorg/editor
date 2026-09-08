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
