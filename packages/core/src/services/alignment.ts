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

/** Forward rotation: local XZ → world XZ for a node whose parent has
 *  position `bx,_,bz` and rotation-Y `rotY` (radians). Matches the
 *  transform used throughout the editor's tools / floor-plan. */
function localToWorld(
  x: number,
  z: number,
  bx: number,
  bz: number,
  cos: number,
  sin: number,
): { x: number; z: number } {
  return {
    x: bx + x * cos + z * sin,
    z: bz - x * sin + z * cos,
  }
}

function transformAnchorToWorld(
  anchor: AlignmentAnchor,
  bx: number,
  bz: number,
  cos: number,
  sin: number,
): AlignmentAnchor {
  const w = localToWorld(anchor.x, anchor.z, bx, bz, cos, sin)
  return { nodeId: anchor.nodeId, kind: anchor.kind, x: w.x, z: w.z }
}

export type BuildingPose = {
  position: readonly [number, number, number]
  rotationY: number
}

export type ResolveAlignmentInBuildingResult = {
  /** Guides in WORLD coordinates. Renderers must be in a world-space group. */
  guides: AlignmentGuide[]
  /** Snap delta in the BUILDING-LOCAL frame, ready to add to a local position. */
  snap: { dx: number; dz: number } | null
}

/**
 * Resolve alignment in WORLD space while accepting BUILDING-LOCAL anchors.
 *
 * Why this exists: the floor-plan grid lives in world XZ (rendered outside
 * the rotated scene group), so alignment must follow the same axes —
 * otherwise rotating a building drags the alignment guides off the visible
 * grid and onto the rotated wall's local axes (the bug the user hit). The
 * resolver itself is frame-agnostic; this wrapper just transforms anchors
 * to world, resolves, then rotates the snap delta back into building-local
 * so callers can add it to a local position without further math.
 *
 * `pose === null` → resolve in the caller's frame as-is (no transform).
 */
export function resolveAlignmentInBuildingWorld(input: {
  moving: readonly AlignmentAnchor[]
  candidates: readonly AlignmentAnchor[]
  threshold: number
  pose: BuildingPose | null
}): ResolveAlignmentInBuildingResult {
  const { moving, candidates, threshold, pose } = input
  if (!pose) {
    return resolveAlignment({ moving, candidates, threshold })
  }
  const cos = Math.cos(pose.rotationY)
  const sin = Math.sin(pose.rotationY)
  const bx = pose.position[0]
  const bz = pose.position[2]
  const movingWorld = moving.map((a) => transformAnchorToWorld(a, bx, bz, cos, sin))
  const candidatesWorld = candidates.map((a) => transformAnchorToWorld(a, bx, bz, cos, sin))
  const result = resolveAlignment({
    moving: movingWorld,
    candidates: candidatesWorld,
    threshold,
  })
  if (!result.snap) return { guides: result.guides, snap: null }
  // World → local rotation (orthogonal matrix → transpose). The inverse of
  // `localToWorld` above maps (dx_world, dz_world) → (dx_local, dz_local).
  const dxW = result.snap.dx
  const dzW = result.snap.dz
  const dxL = dxW * cos - dzW * sin
  const dzL = dxW * sin + dzW * cos
  return { guides: result.guides, snap: { dx: dxL, dz: dzL } }
}

export function resolveAlignment(input: ResolveAlignmentInput): ResolveAlignmentResult {
  const { moving, candidates, threshold } = input
  if (threshold <= 0 || moving.length === 0 || candidates.length === 0) return EMPTY

  // Best match per axis: among all candidate anchors within `threshold` of
  // the moving anchor on the matched axis, pick the one CLOSEST in the
  // perpendicular direction — so the guide always connects to the visually
  // nearest actual point of the candidate. Primary delta only breaks perp
  // ties.
  //
  // Why perp-first: a wall pre-rotation contributes anchors that share an
  // exact X (vertical wall) or Z (horizontal wall), so primary deltas tie
  // and perp picks the nearer endpoint. Post-rotation, the same wall's
  // anchors are at slightly-different world coordinates after a float
  // rotation — primary deltas differ by tiny amounts and a primary-first
  // tie-break would lock onto whichever happens to be marginally tighter,
  // often the far endpoint. Perp-first keeps the "closest point of
  // reference" behaviour stable through rotation.
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
        (bestX === null || adz < bestX.perp || (adz === bestX.perp && adx < bestX.primary))
      ) {
        bestX = { delta: dx, primary: adx, perp: adz, m, c }
      }
      if (
        adz <= threshold &&
        (bestZ === null || adx < bestZ.perp || (adx === bestZ.perp && adz < bestZ.primary))
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
