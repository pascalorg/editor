import type { GutterNode, RoofSegmentNode } from '@pascal-app/core'

/**
 * Auto-mitre detector for two gutters meeting at a roof corner.
 *
 * When two gutters' endpoints land within `CORNER_EPSILON` of each
 * other in plan (ROOF-local X/Z — see `planDistSq`), the renderer
 * treats them as a single L-junction and skews each end so the back
 * walls meet at the inner corner while the front rims extend outward to
 * a clean mitre.
 *
 * Why "back wall stays at the corner": the gutter mounts against the
 * fascia (gutter-local +X is the length, +Z is outward over the eave).
 * Two perpendicular fascias meet at the eave corner — that's the
 * fixed point. The rims hang in space past the building, so they're
 * the parts that need to extend to actually touch each other.
 *
 * For 90° (typical hip / rectangular plan) corners the mitre is 45°
 * each side; arbitrary angles use the standard mitre formula
 * `(π − interior) / 2`. Aligned gutters (interior ≈ π) → mitre 0 → no
 * displacement, no cap suppression — they read as a straight run.
 *
 * Cross-segment: endpoints + length axes are lifted into the shared
 * ROOF frame (each gutter's segment position + Y-rotation applied), so
 * gutters on DIFFERENT roof segments (L-shaped plans, additions) mitre
 * at the corner where their segments meet — not just gutters sharing a
 * segment. Same-segment corners fall out of the same path (both gutters
 * carry the same segment transform). The skew assumes a convex (outer)
 * corner; a concave inner corner mitres approximately.
 */

export type GutterMitres = {
  /**
   * SIGNED mitre angle (radians) at the gutter's −X end; 0 = no mitre.
   * Positive = CONVEX (outer) corner — the front rim EXTENDS past the
   * end to reach the outer eave intersection. Negative = CONCAVE (inner)
   * corner — the rim RETRACTS to the inner intersection. The geometry
   * builder feeds the value straight through `Math.tan`, so the sign
   * flips the skew direction; `=== 0` still means "no mitre / keep cap".
   */
  left: number
  /** Signed mitre angle (radians) at the gutter's +X end; see `left`. */
  right: number
}

export const NO_MITRES: GutterMitres = { left: 0, right: 0 }

// Match the length-snap's 10 cm catch radius (`length-snap.ts`): any two
// endpoints close enough for the corner snap to bind are close enough to
// read as "they meant to meet". The corner snap pulls them to the exact
// eave intersection (≈ 0 cm), so this is mostly slack for eyeballed /
// move-tool corners that never went through the length handle.
const CORNER_EPSILON = 0.1
export const CORNER_EPSILON_SQ = CORNER_EPSILON * CORNER_EPSILON

// Mitres beyond this are unphysical (an acute outer corner past 30°
// interior angle isn't a building corner, it's a CSG artefact). Capping
// keeps a misplaced gutter from producing a runaway skew that swallows
// the rest of the trough.
const MAX_MITRE = (75 * Math.PI) / 180

// Cross product below this magnitude counts as parallel length-axes — a
// straight collinear run, no corner. Matches `length-snap.ts`.
const AXIS_PARALLEL_EPSILON = 1e-3

/** A sibling gutter paired with the segment it sits on, for the frame lift. */
export type GutterWithSegment = {
  gutter: GutterNode
  segment: Pick<RoofSegmentNode, 'position' | 'rotation'>
}

export type Endpoint = {
  pos: readonly [number, number, number]
  /** Length-axis direction in segment frame, pointing from this end toward the other end. */
  awayDir: readonly [number, number]
  /** Outward normal (gutter-local +Z, "away from the building") in this frame. */
  outDir: readonly [number, number]
}

function gutterEndpoints(g: GutterNode): { plus: Endpoint; minus: Endpoint } {
  const [px, py, pz] = g.position
  const r = g.rotation ?? 0
  // Gutter-local +X (length axis) rotated by `r` around Y. THREE's
  // rotation-y convention: local (1, 0, 0) → (cos r, 0, −sin r).
  const dirX = Math.cos(r)
  const dirZ = -Math.sin(r)
  // Gutter-local +Z (outward) rotated by `r`: (0, 0, 1) → (sin r, 0, cos r).
  const outX = Math.sin(r)
  const outZ = Math.cos(r)
  const half = g.length / 2
  return {
    plus: {
      pos: [px + dirX * half, py, pz + dirZ * half],
      // From the +X endpoint, the rest of the gutter extends back
      // toward the −X end — so "away from this end" is −dir.
      awayDir: [-dirX, -dirZ],
      outDir: [outX, outZ],
    },
    minus: {
      pos: [px - dirX * half, py, pz - dirZ * half],
      awayDir: [dirX, dirZ],
      outDir: [outX, outZ],
    },
  }
}

/**
 * Gutter endpoints lifted from segment-local into the shared ROOF frame
 * by applying the host segment's position + Y-rotation. Two gutters on
 * different segments can then be compared in one frame. THREE's
 * rotation-y convention: a point/dir (x, z) rotates to
 * (x·cos + z·sin, −x·sin + z·cos).
 */
export function gutterEndpointsInFrame(
  g: GutterNode,
  segment: Pick<RoofSegmentNode, 'position' | 'rotation'>,
): { plus: Endpoint; minus: Endpoint } {
  const local = gutterEndpoints(g)
  const sx = segment.position?.[0] ?? 0
  const sz = segment.position?.[2] ?? 0
  const sr = segment.rotation ?? 0
  const c = Math.cos(sr)
  const s = Math.sin(sr)
  const liftPos = (p: readonly [number, number, number]): [number, number, number] => [
    sx + (p[0] * c + p[2] * s),
    p[1],
    sz + (-p[0] * s + p[2] * c),
  ]
  const liftDir = (d: readonly [number, number]): [number, number] => [
    d[0] * c + d[1] * s,
    -d[0] * s + d[1] * c,
  ]
  return {
    plus: {
      pos: liftPos(local.plus.pos),
      awayDir: liftDir(local.plus.awayDir),
      outDir: liftDir(local.plus.outDir),
    },
    minus: {
      pos: liftPos(local.minus.pos),
      awayDir: liftDir(local.minus.awayDir),
      outDir: liftDir(local.minus.outDir),
    },
  }
}

// Plan-space (X/Z) distance only — deliberately ignores Y. Gutters are
// pinned to the eave line so they're coplanar in eave-Y, AND the
// renderer draws them at the LIVE `computeEaveY(segment)`, not the
// stored `position[1]` (which goes stale if the segment's wallHeight /
// pitch changed after placement). Folding Y in would reject a real
// corner whenever two gutters' stored Ys drifted apart even though they
// visibly meet. The length-snap that feeds this also works purely in
// plan, so the match must too.
export function planDistSq(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const dx = a[0] - b[0]
  const dz = a[2] - b[2]
  return dx * dx + dz * dz
}

function mitreBetween(a: Endpoint, b: Endpoint): number {
  // Both `awayDir`s point from the corner toward the FAR end of their
  // gutter. The interior angle of the joint is the angle between them.
  // Mitre = half the supplementary angle (standard carpenter formula).
  const dot = a.awayDir[0] * b.awayDir[0] + a.awayDir[1] * b.awayDir[1]
  const clamped = Math.max(-1, Math.min(1, dot))
  const interior = Math.acos(clamped)
  const mitre = (Math.PI - interior) / 2
  // Aligned-or-nearly so → straight run, no mitre needed.
  if (mitre < 1e-3) return 0

  // Convex vs concave. `a.outDir` is THIS gutter's outward normal; `b`'s
  // body runs from the corner along `b.awayDir`. On a CONVEX (outer)
  // corner the neighbour's body sits on the INWARD side of our rim, so
  // `b.awayDir · a.outDir < 0` (it heads away from our outward face) —
  // the rim must EXTEND (positive). On a CONCAVE (inner) corner the
  // neighbour's body sits on our OUTWARD side (`· > 0`) and the rim must
  // RETRACT (negative) to the inner intersection.
  const concave = b.awayDir[0] * a.outDir[0] + b.awayDir[1] * a.outDir[1] > 0
  const signed = concave ? -mitre : mitre
  return Math.max(-MAX_MITRE, Math.min(MAX_MITRE, signed))
}

// Intersection (in plan X/Z) of two infinite length-axis lines, each
// given as a point + run direction. Returns null when the runs are
// parallel (no single crossing — a straight collinear run, not a
// corner). Mirrors the `length-snap.ts` corner solve.
function axisIntersectionXZ(
  aPos: readonly [number, number, number],
  aDir: readonly [number, number],
  bPos: readonly [number, number, number],
  bDir: readonly [number, number],
): readonly [number, number, number] | null {
  const cross = aDir[0] * bDir[1] - aDir[1] * bDir[0]
  if (Math.abs(cross) < AXIS_PARALLEL_EPSILON) return null
  const dx = bPos[0] - aPos[0]
  const dz = bPos[2] - aPos[2]
  const t = (dx * bDir[1] - dz * bDir[0]) / cross
  return [aPos[0] + t * aDir[0], 0, aPos[2] + t * aDir[1]]
}

/**
 * Compute mitres for `subject` against every other gutter under the
 * same parent.
 *
 * A corner is the INTERSECTION of the two gutters' length-axis lines —
 * not the proximity of their endpoints. This is what makes inner
 * (concave) corners work: there the two eave drip-lines meet out in the
 * notch, a full overhang away from where either gutter naturally ends,
 * so an endpoint-to-endpoint test never fired. Keying off the axis
 * crossing treats convex and concave identically. The length-snap pulls
 * both ends out to that shared point, so by the time we mitre the
 * subject's end AND the sibling's end both sit on the intersection — we
 * require both to be within `CORNER_EPSILON` of it, which also rejects
 * runs that merely cross in the middle (a T, not an L).
 *
 * First match per end wins; siblings order is the caller's, so the
 * result is deterministic.
 */
export function computeGutterMitres(
  subject: GutterNode,
  subjectSegment: Pick<RoofSegmentNode, 'position' | 'rotation'>,
  siblings: readonly GutterWithSegment[],
): GutterMitres {
  if (siblings.length === 0) return NO_MITRES

  const subj = gutterEndpointsInFrame(subject, subjectSegment)
  let leftMitre = 0
  let rightMitre = 0

  for (const sib of siblings) {
    if (sib.gutter.id === subject.id) continue
    const other = gutterEndpointsInFrame(sib.gutter, sib.segment)

    // `minus.awayDir` runs from the −X end toward +X, i.e. along the
    // length — so it's a valid direction for either gutter's axis line.
    const corner = axisIntersectionXZ(
      subj.minus.pos,
      subj.minus.awayDir,
      other.minus.pos,
      other.minus.awayDir,
    )
    if (!corner) continue

    // The sibling end that sits on the corner is the one we mitre against.
    const otherPlusAtCorner = planDistSq(other.plus.pos, corner) <= CORNER_EPSILON_SQ
    const otherMinusAtCorner = planDistSq(other.minus.pos, corner) <= CORNER_EPSILON_SQ
    if (!otherPlusAtCorner && !otherMinusAtCorner) continue
    const otherEnd = otherPlusAtCorner ? other.plus : other.minus

    if (leftMitre === 0 && planDistSq(subj.minus.pos, corner) <= CORNER_EPSILON_SQ) {
      leftMitre = mitreBetween(subj.minus, otherEnd)
    }
    if (rightMitre === 0 && planDistSq(subj.plus.pos, corner) <= CORNER_EPSILON_SQ) {
      rightMitre = mitreBetween(subj.plus, otherEnd)
    }
    if (leftMitre !== 0 && rightMitre !== 0) break
  }

  return { left: leftMitre, right: rightMitre }
}
