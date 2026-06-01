import type { GutterNode, GutterOutlet } from '@pascal-app/core'
import {
  OUTLET_WALL_THICKNESS,
  type OutletShape,
  outletDims,
  outletShapeForProfile,
  profileFloorMidZ,
} from './profile-geometry'

/**
 * Outlet position lookup — used by the downspout (renderer / tool /
 * routing) to mount a pipe at one of the gutter's outlets without
 * walking the gutter's geometry pipeline.
 *
 * Returns the outlet's center in GUTTER-MESH-LOCAL frame (i.e. after
 * the gutter's own `position` + `rotation` have already been applied
 * by the renderer chain): X is along the gutter length, Y is the
 * gutter's vertical extent (−size, the trough floor), Z is outward
 * (the profile-dependent floor midpoint).
 *
 * The clamp mirrors the geometry's `resolveOutletPlacements` so the
 * lookup and the drilled hole agree on X. Ignores mitres — when a
 * gutter end is mitred its cap collapses, which shifts the clamp bound
 * by ≤ 6 mm; the drift is below what reads visually, and the gutter's
 * own CSG drill still cuts in the exact spot since it sees the full
 * mitre context.
 */

export type GutterOutletPlacement = {
  /** Gutter-mesh-local X — along the length axis, signed from center. */
  x: number
  /** Gutter-mesh-local Y — the trough floor at −size. */
  y: number
  /** Gutter-mesh-local Z — profile-dependent floor midpoint. */
  z: number
  /** Nominal bore radius (= halfX); `bore * 2` is the outlet diameter. */
  bore: number
  /** Outlet cross-section — round on half-round, rect on k-style / box. */
  shape: OutletShape
  /** Bore half-extent along the gutter length (X) — the pipe nests just inside this. */
  innerHalfX: number
  /** Bore half-extent outward (Z) — the pipe nests just inside this. */
  innerHalfZ: number
}

function placeOutlet(
  gutter: GutterNode,
  outlet: GutterOutlet,
  len: number,
  size: number,
  t: number,
): GutterOutletPlacement | null {
  const shape = outletShapeForProfile(gutter.profile)
  const inner = outletDims(shape, outlet.diameter ?? 0.07)
  const outerHalfX = inner.halfX + OUTLET_WALL_THICKNESS

  // Default-cap reservation — no mitre awareness here; see header note.
  const capLeftLen = (gutter.endCapLeft ?? true) ? t : 0
  const capRightLen = (gutter.endCapRight ?? true) ? t : 0

  const minX = -len / 2 + capLeftLen + outerHalfX
  const maxX = len / 2 - capRightLen - outerHalfX
  if (maxX <= minX) return null
  const x = Math.max(minX, Math.min(maxX, outlet.offset ?? 0))

  return {
    x,
    y: -size,
    z: profileFloorMidZ(gutter.profile ?? 'k-style', size),
    bore: inner.halfX,
    shape,
    innerHalfX: inner.halfX,
    innerHalfZ: inner.halfZ,
  }
}

function gutterDims(gutter: GutterNode): { len: number; size: number; t: number } {
  const len = Math.max(0.05, gutter.length)
  const size = Math.max(0.04, gutter.size)
  const t = Math.min(Math.max(0.001, gutter.thickness), size * 0.4)
  return { len, size, t }
}

/** Placement of the gutter's outlet with the given id, or null if absent / doesn't fit. */
export function resolveGutterOutletById(
  gutter: GutterNode,
  outletId: string | undefined,
): GutterOutletPlacement | null {
  if (!outletId) return null
  const outlet = (gutter.outlets ?? []).find((o) => o.id === outletId)
  if (!outlet) return null
  const { len, size, t } = gutterDims(gutter)
  return placeOutlet(gutter, outlet, len, size, t)
}

/** Placements for every fitting outlet, tagged with its id. */
export function resolveGutterOutlets(
  gutter: GutterNode,
): Array<GutterOutletPlacement & { id: string }> {
  const { len, size, t } = gutterDims(gutter)
  const out: Array<GutterOutletPlacement & { id: string }> = []
  for (const outlet of gutter.outlets ?? []) {
    const p = placeOutlet(gutter, outlet, len, size, t)
    if (p) out.push({ ...p, id: outlet.id })
  }
  return out
}
