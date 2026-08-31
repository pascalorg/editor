// Proximity / alignment guides for wall-hosted openings (doors, windows).
//
// Pure geometry over a single host wall's LOCAL frame — no Three.js, no scene
// store, no React — so it runs identically for the 3D viewport and the 2D
// floor plan and is unit-testable in isolation. Callers extract the spans from
// the scene graph (an opening's `position[0]` is its along-wall centre, its
// `position[1]` its vertical centre with the wall base at y=0) and feed them in;
// the renderers transform the returned wall-local coordinates back to world
// (3D) or plan (2D).
//
// What it produces, mirroring the affordances architects expect (and Figma's
// smart guides):
//   - sill/head    : a window's bottom edge → floor and top edge → wall top.
//   - edge gaps     : along-wall clearance to the nearest neighbour opening (or
//                     the wall end) on each side.
//   - alongWall     : the moving opening's edge/centre lining up with a
//                     neighbour's edge/centre along the wall.
//   - vertical      : two openings sharing a sill / head / vertical centre.
//   - equalSpacing  : a run of 3+ openings with (near-)equal gaps between them.
//
// Detection is passive — it reports what currently coincides within tolerance
// and the snap delta that would make it exact, leaving the snap decision to the
// caller's manipulation policy (grid vs. alignment vs. Shift bypass).

/** An opening's footprint in its host wall's local frame. */
export type OpeningSpan = {
  id: string
  /** Centre along the wall, measured from `wall.start` (m). */
  centerS: number
  /** Along-wall extent (m). */
  width: number
  /** Vertical centre above the wall base (floor at y=0) (m). */
  centerY: number
  /** Vertical extent (m). */
  height: number
}

export type WallExtent = {
  /** Wall length (m). */
  length: number
  /** Wall height (m). */
  height: number
}

export type OpeningGuideTolerances = {
  /** Max distance for an edge/centre to count as aligned with a neighbour (m). */
  align: number
  /** Max difference between two gaps for them to count as equal (m). */
  equalSpacing: number
  /** Gaps below this are treated as touching/overlap noise and ignored (m). */
  minGap: number
}

export const DEFAULT_OPENING_GUIDE_TOLERANCES: OpeningGuideTolerances = {
  // Parity with the along-wall snap threshold (`ALONG_WALL_ALIGN_THRESHOLD_M`).
  align: 0.08,
  equalSpacing: 0.03,
  minGap: 0.02,
}

/** Which along-wall feature of an opening a guide references. */
export type AlongWallFeature = 'left' | 'center' | 'right'
/** Which vertical feature of an opening a guide references. */
export type VerticalFeature = 'sill' | 'center' | 'top'

export type SillHeadGuide = {
  /** Floor (y=0) → the opening's bottom edge (m). */
  sill: number
  /** Wall-local y of the bottom edge. */
  bottomY: number
  /** The opening's top edge → the wall top (m). */
  head: number
  /** Wall-local y of the top edge. */
  topY: number
}

export type EdgeGap = {
  side: 'left' | 'right'
  /** Clearance along the wall (m). */
  distance: number
  /** Wall-local s of the moving opening's edge. */
  fromS: number
  /** Wall-local s of the neighbour edge / wall end. */
  toS: number
  target: 'opening' | 'wall-start' | 'wall-end'
  /** Set when `target === 'opening'`. */
  targetId?: string
}

export type AlongWallAlignment = {
  /** Wall-local s the two features share. */
  s: number
  movingFeature: AlongWallFeature
  targetId: string
  targetFeature: AlongWallFeature
  /** Delta to add to the moving opening's `centerS` to make them coincide. */
  snap: number
}

export type VerticalAlignment = {
  /** Wall-local y the two features share. */
  y: number
  movingFeature: VerticalFeature
  targetId: string
  targetFeature: VerticalFeature
  /** Delta to add to the moving opening's `centerY` to make them coincide. */
  snap: number
}

export type EqualSpacingRun = {
  /** The repeated gap value (average of the run's gaps) (m). */
  gap: number
  /** The equal-gap segments along the wall, in order (left → right). */
  segments: { fromS: number; toS: number }[]
  /** Participating opening ids, ordered along the wall, including the moving one. */
  openingIds: string[]
}

export type OpeningGuides = {
  sillHead: SillHeadGuide | null
  gaps: EdgeGap[]
  alongWall: AlongWallAlignment | null
  vertical: VerticalAlignment | null
  equalSpacing: EqualSpacingRun | null
}

export type OpeningGuideInput = {
  moving: OpeningSpan
  /** Other openings on the SAME wall (the moving opening excluded). */
  siblings: readonly OpeningSpan[]
  wall: WallExtent
  /**
   * Whether to compute vertical (sill/head/vertical-alignment) guides. True for
   * windows; false for doors, which sit on the floor so their sill is always 0.
   */
  includeVertical: boolean
  tolerances?: Partial<OpeningGuideTolerances>
}

const leftEdge = (s: OpeningSpan) => s.centerS - s.width / 2
const rightEdge = (s: OpeningSpan) => s.centerS + s.width / 2
const bottomEdge = (s: OpeningSpan) => s.centerY - s.height / 2
const topEdge = (s: OpeningSpan) => s.centerY + s.height / 2

function alongWallFeatureCoord(s: OpeningSpan, feature: AlongWallFeature): number {
  if (feature === 'left') return leftEdge(s)
  if (feature === 'right') return rightEdge(s)
  return s.centerS
}

function verticalFeatureCoord(s: OpeningSpan, feature: VerticalFeature): number {
  if (feature === 'sill') return bottomEdge(s)
  if (feature === 'top') return topEdge(s)
  return s.centerY
}

const ALONG_WALL_FEATURES: AlongWallFeature[] = ['left', 'center', 'right']
const VERTICAL_FEATURES: VerticalFeature[] = ['sill', 'center', 'top']

/**
 * Edge-to-edge clearance from the moving opening to the nearest neighbour on
 * each side, falling back to the wall ends when there is no neighbour — the
 * "how much wall is left here" reading. Returns 0–2 gaps (one per side); a side
 * is omitted when its clearance is below `minGap` (the opening is flush against
 * or overlapping that neighbour).
 */
export function computeEdgeGaps(
  moving: OpeningSpan,
  siblings: readonly OpeningSpan[],
  wall: WallExtent,
  minGap: number,
): EdgeGap[] {
  const movingLeft = leftEdge(moving)
  const movingRight = rightEdge(moving)

  // A sibling that straddles one of the moving opening's edges is an OVERLAP,
  // not a neighbour: there is no clearance on that side, and we must not fall
  // back to the wall end (which would report a misleading distance measured
  // "through" the overlapping opening).
  const leftCrossed = siblings.some((s) => leftEdge(s) < movingLeft && rightEdge(s) > movingLeft)
  const rightCrossed = siblings.some((s) => leftEdge(s) < movingRight && rightEdge(s) > movingRight)

  let leftNeighbour: { s: number; id: string } | null = null
  let rightNeighbour: { s: number; id: string } | null = null
  for (const sib of siblings) {
    const sibRight = rightEdge(sib)
    const sibLeft = leftEdge(sib)
    // Entirely to the left of the moving opening → candidate left neighbour.
    if (sibRight <= movingLeft && (leftNeighbour === null || sibRight > leftNeighbour.s)) {
      leftNeighbour = { s: sibRight, id: sib.id }
    }
    // Entirely to the right → candidate right neighbour.
    if (sibLeft >= movingRight && (rightNeighbour === null || sibLeft < rightNeighbour.s)) {
      rightNeighbour = { s: sibLeft, id: sib.id }
    }
  }

  const gaps: EdgeGap[] = []

  if (!leftCrossed) {
    const leftToS = leftNeighbour ? leftNeighbour.s : 0
    const leftDistance = movingLeft - leftToS
    if (leftDistance >= minGap) {
      gaps.push({
        side: 'left',
        distance: leftDistance,
        fromS: movingLeft,
        toS: leftToS,
        target: leftNeighbour ? 'opening' : 'wall-start',
        targetId: leftNeighbour?.id,
      })
    }
  }

  if (!rightCrossed) {
    const rightToS = rightNeighbour ? rightNeighbour.s : wall.length
    const rightDistance = rightToS - movingRight
    if (rightDistance >= minGap) {
      gaps.push({
        side: 'right',
        distance: rightDistance,
        fromS: movingRight,
        toS: rightToS,
        target: rightNeighbour ? 'opening' : 'wall-end',
        targetId: rightNeighbour?.id,
      })
    }
  }

  return gaps
}

/**
 * The closest coincidence between any of the moving opening's edges/centre and
 * any sibling's edges/centre along the wall, within `tolerance`. Edge-to-edge
 * and centre-to-centre are weighed equally; the single closest pair wins
 * (matching the one-guide-per-axis behaviour of the floor-plane resolver).
 */
export function detectAlongWallAlignment(
  moving: OpeningSpan,
  siblings: readonly OpeningSpan[],
  tolerance: number,
): AlongWallAlignment | null {
  let best: AlongWallAlignment | null = null
  let bestAbs = tolerance
  for (const movingFeature of ALONG_WALL_FEATURES) {
    const movingCoord = alongWallFeatureCoord(moving, movingFeature)
    for (const sib of siblings) {
      if (sib.id === moving.id) continue
      for (const targetFeature of ALONG_WALL_FEATURES) {
        const targetCoord = alongWallFeatureCoord(sib, targetFeature)
        const diff = targetCoord - movingCoord
        const abs = Math.abs(diff)
        if (abs <= bestAbs && (best === null || abs < bestAbs)) {
          bestAbs = abs
          best = {
            s: targetCoord,
            movingFeature,
            targetId: sib.id,
            targetFeature,
            snap: diff,
          }
        }
      }
    }
  }
  return best
}

/**
 * The closest coincidence between the moving opening's sill/centre/top and any
 * sibling's sill/centre/top, within `tolerance` — the "these two windows share
 * a sill height" detector. Same single-best-match policy as the along-wall
 * variant.
 */
export function detectVerticalAlignment(
  moving: OpeningSpan,
  siblings: readonly OpeningSpan[],
  tolerance: number,
): VerticalAlignment | null {
  let best: VerticalAlignment | null = null
  let bestAbs = tolerance
  for (const movingFeature of VERTICAL_FEATURES) {
    const movingCoord = verticalFeatureCoord(moving, movingFeature)
    for (const sib of siblings) {
      if (sib.id === moving.id) continue
      for (const targetFeature of VERTICAL_FEATURES) {
        const targetCoord = verticalFeatureCoord(sib, targetFeature)
        const diff = targetCoord - movingCoord
        const abs = Math.abs(diff)
        if (abs <= bestAbs && (best === null || abs < bestAbs)) {
          bestAbs = abs
          best = {
            y: targetCoord,
            movingFeature,
            targetId: sib.id,
            targetFeature,
            snap: diff,
          }
        }
      }
    }
  }
  return best
}

/**
 * Figma-style equal-spacing detection: order all openings along the wall, look
 * at the clearances BETWEEN consecutive openings, and return the longest run of
 * ≥2 consecutive gaps that are equal within `tolerance` and that the moving
 * opening participates in (so the badges only appear while the drag is actually
 * forming or extending a series). Returns null when no such run exists.
 *
 * Gaps below `minGap` (touching/overlapping openings) break a run — a row of
 * flush openings is not "equally spaced".
 */
export function detectEqualSpacing(
  allOpenings: readonly OpeningSpan[],
  movingId: string,
  tolerance: number,
  minGap: number,
): EqualSpacingRun | null {
  if (allOpenings.length < 3) return null
  const sorted = [...allOpenings].sort((a, b) => a.centerS - b.centerS)
  const movingIndex = sorted.findIndex((s) => s.id === movingId)
  if (movingIndex < 0) return null

  // Clearance between opening i and i+1.
  const gaps: { value: number; fromS: number; toS: number }[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (!a || !b) continue
    const fromS = rightEdge(a)
    const toS = leftEdge(b)
    gaps.push({ value: toS - fromS, fromS, toS })
  }

  // Longest contiguous window of gaps that are (a) each ≥ minGap and (b)
  // mutually equal within tolerance (window max − min ≤ tolerance), spanning at
  // least 2 gaps and including the moving opening. Brute force over windows
  // (openings per wall are few). A first-gap-anchored greedy scan is NOT
  // equivalent: it drops a valid run that begins partway through a drifting
  // sequence — e.g. gaps 1.00, 1.02, 1.04 with the moving opening at the end,
  // where [1.02, 1.04] is a real run. On a length tie the leftmost window wins,
  // for determinism.
  let best: EqualSpacingRun | null = null
  for (let lo = 0; lo < gaps.length; lo++) {
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (let hi = lo; hi < gaps.length; hi++) {
      const gap = gaps[hi]
      if (!gap || gap.value < minGap) break // a sub-minGap gap can't join a run
      min = Math.min(min, gap.value)
      max = Math.max(max, gap.value)
      if (max - min > tolerance) break // extending only widens the spread
      const gapCount = hi - lo + 1
      if (gapCount < 2) continue
      const firstOpening = lo // gap i sits between openings i and i+1
      const lastOpening = hi + 1
      if (movingIndex < firstOpening || movingIndex > lastOpening) continue
      if (best !== null && gapCount <= best.segments.length) continue
      const windowGaps = gaps.slice(lo, hi + 1)
      best = {
        gap: windowGaps.reduce((sum, g) => sum + g.value, 0) / windowGaps.length,
        segments: windowGaps.map((g) => ({ fromS: g.fromS, toS: g.toS })),
        openingIds: sorted.slice(firstOpening, lastOpening + 1).map((s) => s.id),
      }
    }
  }
  return best
}

/**
 * Compute every proximity/alignment guide for the moving opening in one pass.
 * Pure: feed it the moving opening's wall-local span, its same-wall siblings,
 * and the wall extent; render the result in whichever view.
 */
export function computeOpeningGuides(input: OpeningGuideInput): OpeningGuides {
  const tol = { ...DEFAULT_OPENING_GUIDE_TOLERANCES, ...input.tolerances }
  const { moving, siblings, wall, includeVertical } = input

  const sillHead: SillHeadGuide | null = includeVertical
    ? {
        sill: bottomEdge(moving),
        bottomY: bottomEdge(moving),
        head: wall.height - topEdge(moving),
        topY: topEdge(moving),
      }
    : null

  return {
    sillHead,
    gaps: computeEdgeGaps(moving, siblings, wall, tol.minGap),
    alongWall: detectAlongWallAlignment(moving, siblings, tol.align),
    vertical: includeVertical ? detectVerticalAlignment(moving, siblings, tol.align) : null,
    equalSpacing: detectEqualSpacing(
      [moving, ...siblings],
      moving.id,
      tol.equalSpacing,
      tol.minGap,
    ),
  }
}
