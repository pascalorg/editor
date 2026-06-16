/**
 * Pure alignment-guide resolver — no React, no DOM, no scene access.
 *
 * Given a moving object's anchor points at its proposed position and a
 * pool of candidate anchors from nearby static objects, returns:
 *   - the best per-axis matches as `Guide` rendering primitives, and
 *   - an optional `{ dx, dz }` snap delta the caller can apply.
 *
 * Anchors are 2D points on the floor plane (XZ, in world meters). The
 * resolver picks at most one match per axis: the smallest |Δx| match
 * snaps X; the smallest |Δz| match snaps Z. This mirrors Figma's
 * behaviour — guides appear along the matched axes, regardless of how
 * many neighbours could have matched.
 *
 * Two guides max per call keeps the visual signal sharp at the cost of
 * not surfacing every possible alignment at once. Multi-guide ("this
 * lines up with three things") is intentionally out of scope for v1.
 */

export type AnchorKind = 'corner' | 'edge-mid' | 'center'

export type AlignmentAnchor = {
  /** Owning node id — informational; resolver does not use it. */
  nodeId: string
  kind: AnchorKind
  x: number
  z: number
}

export type AlignmentGuideAxis = 'x' | 'z'

/**
 * Rendering primitive — a guide line on the floor plane.
 *
 * `axis === 'x'`: vertical guide. Both endpoints share `coord` as their X.
 * `axis === 'z'`: horizontal guide. Both endpoints share `coord` as their Z.
 *
 * The line spans from the matched candidate anchor to the moving anchor
 * after snap. Renderers extend visually beyond the endpoints if they want
 * Figma-style "infinite line" feel.
 */
export type AlignmentGuide = {
  axis: AlignmentGuideAxis
  coord: number
  from: { x: number; z: number }
  to: { x: number; z: number }
  movingAnchorKind: AnchorKind
  candidateAnchorKind: AnchorKind
  candidateNodeId: string
  /** Perpendicular distance between the two anchors (used by the distance pill). */
  distance: number
}

export type ResolveAlignmentInput = {
  /** Anchors of the moving node, positioned at the proposed (pre-snap) location. */
  moving: readonly AlignmentAnchor[]
  /** Anchors from every other candidate node the caller has already filtered. */
  candidates: readonly AlignmentAnchor[]
  /**
   * Max |Δ| (meters) for an anchor pair to count as a match. Typically
   * derived from a screen-pixel budget × current units-per-pixel so the
   * snap feel is zoom-invariant.
   */
  threshold: number
}

export type ResolveAlignmentResult = {
  guides: AlignmentGuide[]
  /**
   * Delta the caller should add to the moving node's planar position so
   * its anchors land on the matched axes. `null` when no axis matched.
   */
  snap: { dx: number; dz: number } | null
}

const EMPTY: ResolveAlignmentResult = { guides: [], snap: null }

export function resolveAlignment(input: ResolveAlignmentInput): ResolveAlignmentResult {
  const { moving, candidates, threshold } = input
  if (threshold <= 0 || moving.length === 0 || candidates.length === 0) return EMPTY

  // Best match per axis: smallest |Δ| on the matched axis (tightest
  // alignment), then — crucially — tie-break to the candidate anchor NEAREST
  // on the perpendicular axis. Anchors are real points (corners / endpoints /
  // midpoints), so the guide always connects to the closest actual point of
  // the candidate, never a far one that merely shares the same coordinate.
  type Best = {
    delta: number
    primary: number
    perp: number
    m: AlignmentAnchor
    c: AlignmentAnchor
  }
  let bestX: Best | null = null
  let bestZ: Best | null = null

  for (const m of moving) {
    for (const c of candidates) {
      const dx = c.x - m.x
      const dz = c.z - m.z
      const adx = Math.abs(dx)
      const adz = Math.abs(dz)
      if (
        adx <= threshold &&
        (bestX === null || adx < bestX.primary || (adx === bestX.primary && adz < bestX.perp))
      ) {
        bestX = { delta: dx, primary: adx, perp: adz, m, c }
      }
      if (
        adz <= threshold &&
        (bestZ === null || adz < bestZ.primary || (adz === bestZ.primary && adx < bestZ.perp))
      ) {
        bestZ = { delta: dz, primary: adz, perp: adx, m, c }
      }
    }
  }

  if (!bestX && !bestZ) return EMPTY

  const dxSnap = bestX?.delta ?? 0
  const dzSnap = bestZ?.delta ?? 0
  const guides: AlignmentGuide[] = []

  if (bestX) {
    // X-axis match: vertical guide at x = bestX.c.x. The moving anchor
    // ends up at (c.x, m.z + dzSnap). Span the line between them.
    const snappedMz = bestX.m.z + dzSnap
    const z1 = Math.min(bestX.c.z, snappedMz)
    const z2 = Math.max(bestX.c.z, snappedMz)
    guides.push({
      axis: 'x',
      coord: bestX.c.x,
      from: { x: bestX.c.x, z: z1 },
      to: { x: bestX.c.x, z: z2 },
      movingAnchorKind: bestX.m.kind,
      candidateAnchorKind: bestX.c.kind,
      candidateNodeId: bestX.c.nodeId,
      distance: Math.abs(snappedMz - bestX.c.z),
    })
  }

  if (bestZ) {
    const snappedMx = bestZ.m.x + dxSnap
    const x1 = Math.min(bestZ.c.x, snappedMx)
    const x2 = Math.max(bestZ.c.x, snappedMx)
    guides.push({
      axis: 'z',
      coord: bestZ.c.z,
      from: { x: x1, z: bestZ.c.z },
      to: { x: x2, z: bestZ.c.z },
      movingAnchorKind: bestZ.m.kind,
      candidateAnchorKind: bestZ.c.kind,
      candidateNodeId: bestZ.c.nodeId,
      distance: Math.abs(snappedMx - bestZ.c.x),
    })
  }

  return { guides, snap: { dx: dxSnap, dz: dzSnap } }
}

// ─── Anchor extractors (pure) ─────────────────────────────────────────

/**
 * Produces the 9 standard anchors for an axis-aligned bounding box on the
 * floor plane: 4 corners, 4 edge midpoints, 1 center. Suitable for any
 * floor-plan entity whose footprint can be expressed as a bbox.
 *
 * Caller is responsible for computing the bbox — the resolver doesn't
 * care how (per-kind dimensions, SVG getBBox(), etc.).
 */
export function bboxAnchors(
  nodeId: string,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
): AlignmentAnchor[] {
  const cx = (minX + maxX) / 2
  const cz = (minZ + maxZ) / 2
  return [
    { nodeId, kind: 'corner', x: minX, z: minZ },
    { nodeId, kind: 'corner', x: maxX, z: minZ },
    { nodeId, kind: 'corner', x: maxX, z: maxZ },
    { nodeId, kind: 'corner', x: minX, z: maxZ },
    { nodeId, kind: 'edge-mid', x: cx, z: minZ },
    { nodeId, kind: 'edge-mid', x: maxX, z: cz },
    { nodeId, kind: 'edge-mid', x: cx, z: maxZ },
    { nodeId, kind: 'edge-mid', x: minX, z: cz },
    { nodeId, kind: 'center', x: cx, z: cz },
  ]
}

/**
 * The 4 corner anchors of a bbox — edges only, no edge-midpoints or center.
 * Used where alignment should lock to an object's edges (left/right/front/
 * back), never its centreline.
 */
export function bboxCornerAnchors(
  nodeId: string,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
): AlignmentAnchor[] {
  return [
    { nodeId, kind: 'corner', x: minX, z: minZ },
    { nodeId, kind: 'corner', x: maxX, z: minZ },
    { nodeId, kind: 'corner', x: maxX, z: maxZ },
    { nodeId, kind: 'corner', x: minX, z: maxZ },
  ]
}
