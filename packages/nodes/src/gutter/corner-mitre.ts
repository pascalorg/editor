import type { GutterNode } from '@pascal-app/core'

/**
 * Auto-mitre detector for two gutters meeting at a roof corner.
 *
 * When two gutters' endpoints land within `CORNER_EPSILON` of each
 * other in segment-local space, the renderer treats them as a single
 * L-junction and skews each end so the back walls meet at the inner
 * corner while the front rims extend outward to a clean mitre.
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
 * Same-segment only in v1: hip roofs have all four eaves on one
 * segment, so this covers the headline use-case. Cross-segment corners
 * (e.g. gable + hip on adjacent sub-roofs) need parent-frame transform
 * work; deferred.
 */

export type GutterMitres = {
  /** Mitre angle (radians) at the gutter's −X end; 0 = no mitre. */
  left: number
  /** Mitre angle (radians) at the gutter's +X end; 0 = no mitre. */
  right: number
}

export const NO_MITRES: GutterMitres = { left: 0, right: 0 }

// 5 cm slack: the user is dragging endpoints by eye; eave snap is on a
// 5 cm grid, so anything closer than that reads as "they meant to
// meet" rather than "they're near each other".
const CORNER_EPSILON = 0.05
const CORNER_EPSILON_SQ = CORNER_EPSILON * CORNER_EPSILON

// Mitres beyond this are unphysical (an acute outer corner past 30°
// interior angle isn't a building corner, it's a CSG artefact). Capping
// keeps a misplaced gutter from producing a runaway skew that swallows
// the rest of the trough.
const MAX_MITRE = (75 * Math.PI) / 180

type Endpoint = {
  pos: readonly [number, number, number]
  /** Length-axis direction in segment frame, pointing from this end toward the other end. */
  awayDir: readonly [number, number]
}

function gutterEndpoints(g: GutterNode): { plus: Endpoint; minus: Endpoint } {
  const [px, py, pz] = g.position
  const r = g.rotation ?? 0
  // Gutter-local +X (length axis) rotated by `r` around Y. THREE's
  // rotation-y convention: local (1, 0, 0) → (cos r, 0, −sin r).
  const dirX = Math.cos(r)
  const dirZ = -Math.sin(r)
  const half = g.length / 2
  return {
    plus: {
      pos: [px + dirX * half, py, pz + dirZ * half],
      // From the +X endpoint, the rest of the gutter extends back
      // toward the −X end — so "away from this end" is −dir.
      awayDir: [-dirX, -dirZ],
    },
    minus: {
      pos: [px - dirX * half, py, pz - dirZ * half],
      awayDir: [dirX, dirZ],
    },
  }
}

function distSq(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return dx * dx + dy * dy + dz * dz
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
  return Math.min(mitre, MAX_MITRE)
}

/**
 * Compute mitres for `subject` against every other gutter under the
 * same parent. Walks each endpoint pair (subject's +X / −X × sibling's
 * +X / −X), keeps the first match within `CORNER_EPSILON`. Two corners
 * on the same end (rare — would require three gutters meeting at one
 * point) keep the first match found; order is the caller's siblings
 * order, so the result is deterministic.
 */
export function computeGutterMitres(subject: GutterNode, siblings: readonly GutterNode[]): GutterMitres {
  if (siblings.length === 0) return NO_MITRES

  const subj = gutterEndpoints(subject)
  let leftMitre = 0
  let rightMitre = 0

  for (const sib of siblings) {
    if (sib.id === subject.id) continue
    const other = gutterEndpoints(sib)

    if (leftMitre === 0) {
      if (distSq(subj.minus.pos, other.plus.pos) <= CORNER_EPSILON_SQ) {
        leftMitre = mitreBetween(subj.minus, other.plus)
      } else if (distSq(subj.minus.pos, other.minus.pos) <= CORNER_EPSILON_SQ) {
        leftMitre = mitreBetween(subj.minus, other.minus)
      }
    }
    if (rightMitre === 0) {
      if (distSq(subj.plus.pos, other.plus.pos) <= CORNER_EPSILON_SQ) {
        rightMitre = mitreBetween(subj.plus, other.plus)
      } else if (distSq(subj.plus.pos, other.minus.pos) <= CORNER_EPSILON_SQ) {
        rightMitre = mitreBetween(subj.plus, other.minus)
      }
    }
    if (leftMitre !== 0 && rightMitre !== 0) break
  }

  return { left: leftMitre, right: rightMitre }
}
