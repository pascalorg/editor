import type { GutterNode } from '@pascal-app/core'

/**
 * Outlet position lookup — used by the downspout renderer to mount
 * the pipe at the gutter's outlet without having to walk the gutter's
 * geometry pipeline.
 *
 * Returns the outlet's center in GUTTER-MESH-LOCAL frame (i.e. after
 * the gutter's own `position` + `rotation` have already been applied
 * by the renderer chain): X is along the gutter length, Y is the
 * gutter's vertical extent (−size, the trough floor), Z is outward
 * (the profile-dependent floor midpoint).
 *
 * Ignores mitres — when a gutter end is mitred its cap collapses,
 * which shifts the outlet's clamp bound by `wallThickness` (≤ 6 mm
 * at default settings). The downspout drift in that case is below
 * what reads visually; the gutter's own CSG drill still cuts in the
 * exact spot since it sees the full mitre context.
 */

const OUTLET_WALL_THICKNESS = 0.003

export type GutterOutletPlacement = {
  /** Gutter-mesh-local X — along the length axis, signed from center. */
  x: number
  /** Gutter-mesh-local Y — the trough floor at −size. */
  y: number
  /** Gutter-mesh-local Z — profile-dependent floor midpoint. */
  z: number
  /** Outlet bore radius (the open hole the downspout descends through). */
  bore: number
}

function profileFloorMidZ(profile: GutterNode['profile'], size: number): number {
  if (profile === 'half-round') return size
  if (profile === 'box') return size / 2
  return size * 0.4
}

export function resolveGutterOutletPlacement(gutter: GutterNode): GutterOutletPlacement | null {
  const side = gutter.outletSide ?? 'none'
  if (side === 'none') return null

  const len = Math.max(0.05, gutter.length)
  const size = Math.max(0.04, gutter.size)
  const t = Math.min(Math.max(0.001, gutter.thickness), size * 0.4)
  const bore = Math.max(0.01, (gutter.outletDiameter ?? 0.07) / 2)
  const outer = bore + OUTLET_WALL_THICKNESS
  const inset = Math.max(outer, gutter.outletInset ?? 0.15)

  // Default-cap reservation — no mitre awareness here; see header note.
  const capLeftLen = (gutter.endCapLeft ?? true) ? t : 0
  const capRightLen = (gutter.endCapRight ?? true) ? t : 0

  const minX = -len / 2 + capLeftLen + outer
  const maxX = len / 2 - capRightLen - outer
  if (maxX <= minX) return null
  let x = side === 'left' ? -len / 2 + capLeftLen + inset : len / 2 - capRightLen - inset
  x = Math.max(minX, Math.min(maxX, x))

  return {
    x,
    y: -size,
    z: profileFloorMidZ(gutter.profile ?? 'k-style', size),
    bore,
  }
}
