import type { GutterNode } from '@pascal-app/core'

/**
 * Shared outlet/profile geometry constants + math used by the gutter
 * mesh builder, the outlet lookup the downspout mounts against, and the
 * downspout's own routing. Kept in one place so the trough-floor probe
 * and the collar dimensions can't drift between the three call sites
 * (they did before this file — `profileFloorMidZ` was copied verbatim
 * into both `geometry.ts` and `outlet-lookup.ts`).
 */

// Wall thickness of the drop-tube collar — 3 mm matches typical
// residential gauge. After the CSG drill the stub becomes a tube with
// outer radius = bore + wall and inner radius = bore.
export const OUTLET_WALL_THICKNESS = 0.003

// Collar length — how far the drop-tube stub hangs below the trough
// floor. 6 cm reads as "drop outlet" without poking conspicuously far
// below the eave; the downspout slip-fits up into this collar.
export const OUTLET_STUB_LENGTH = 0.06

/**
 * Z (outward) coordinate of the trough floor's midpoint per profile —
 * where a drop outlet drills through. k-style bottom is `wBot = 0.8 ·
 * size` wide so its midpoint sits at `0.4 · size`; box bottom is `size`
 * wide → `size / 2`; half-round's lowest point is the centre of the
 * semicircle at Z = r = size.
 */
export function profileFloorMidZ(profile: GutterNode['profile'], size: number): number {
  if (profile === 'half-round') return size
  if (profile === 'box') return size / 2
  return size * 0.4
}

// ─── Outlet cross-section shape ──────────────────────────────────────

export type OutletShape = 'round' | 'rect'

/**
 * Which cross-section a gutter's drop outlet (and the downspout that
 * plugs into it) takes. Half-round gutters use a round leader; the
 * flat-bottomed profiles (k-style, box) use a rectangular one — matching
 * real residential hardware (round leaders on half-round, 2×3 / 3×4
 * rectangular leaders on k-style / commercial box).
 */
export function outletShapeForProfile(profile: GutterNode['profile']): OutletShape {
  return (profile ?? 'k-style') === 'half-round' ? 'round' : 'rect'
}

// Outward (Z) depth of a rectangular outlet as a fraction of its
// along-length (X) width — a 2×3 leader is ~0.66; 0.7 reads cleanly and
// still fits inside the k-style trough floor.
export const RECT_OUTLET_DEPTH_RATIO = 0.7

export type OutletDims = {
  shape: OutletShape
  /** Half-extent along the gutter length (X). Round: = radius. */
  halfX: number
  /** Half-extent outward (Z). Round: = radius. */
  halfZ: number
}

/**
 * Cross-section half-extents for a `nominalDiameter`-sized outlet of the
 * given shape. Round → a circle of that diameter (halfX = halfZ =
 * radius); rect → that diameter wide along the run, `RECT_OUTLET_DEPTH_
 * RATIO` as deep outward.
 */
export function outletDims(shape: OutletShape, nominalDiameter: number): OutletDims {
  const half = Math.max(0.01, nominalDiameter / 2)
  if (shape === 'round') return { shape, halfX: half, halfZ: half }
  return { shape, halfX: half, halfZ: half * RECT_OUTLET_DEPTH_RATIO }
}
