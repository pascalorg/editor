// The one place that answers "where is the ground under this pointer ray?".
//
// Before terrain there was no question to answer: the ground was `y = 0` and
// every consumer intersected its own horizontal plane. Terrain makes those
// planes wrong in a way that is invisible on flat ground and badly wrong on a
// slope — a ray intersected at the datum instead of at the surface reports an XZ
// that slides along the ray, further the more oblique the camera. Item placement
// already repairs this locally (`resolvePointerSupportSurface`); this module
// exists so the repair is shared instead of copied into column, wall, fence, and
// the sculpt tool.
//
// It lives in `editor` rather than `core` because the decision needs one piece of
// editor knowledge — which plane a consumer is asking about — while the geometry
// it delegates to (`raycastTerrain`, `heightAt`) is pure core.

import {
  heightAt,
  isSiteDatum,
  raycastTerrain,
  type SiteNode,
  type TerrainField,
  type TerrainHit,
  terrainFieldOf,
  useScene,
} from '@pascal-app/core'

/** The active site's terrain field, or null when the scene has no sculpted ground. */
export function siteTerrainField(): TerrainField | null {
  const { nodes, rootNodeIds } = useScene.getState()
  const siteId = rootNodeIds[0]
  const site = siteId ? nodes[siteId] : null
  if (site?.type !== 'site') return null
  return terrainFieldOf(site as SiteNode)
}

/**
 * True when a horizontal query plane at `planeY` is the *site ground*, as opposed
 * to a built flat surface that happens to be horizontal.
 *
 * This is the whole scoping rule, and getting it wrong in either direction is
 * worse than not having terrain at all:
 *
 * - Treat every horizontal plane as ground and a second-storey wall draft snaps
 *   to the hillside under the building.
 * - Treat none of them as ground and every ground tool keeps the perspective skew
 *   terrain was supposed to remove.
 *
 * The datum is exactly the right discriminator because terrain *is* the surface at
 * the datum: the site renderer removes the flat ground fill when terrain mounts,
 * so at the datum there is nothing else to hit. Every other horizontal plane —
 * a storey base, a slab top, a shelf — is a real flat surface built by the user,
 * and a plane is the correct model for it.
 *
 * `isSiteDatum` comes from core so this rule and the one the support resolver
 * applies (`terrain-support.ts`) cannot drift into disagreeing about which
 * surfaces are ground.
 */
export function isSiteGroundPlane(planeY: number): boolean {
  return isSiteDatum(planeY)
}

/**
 * Where a pointer ray meets the sculpted ground, or null when the flat-plane path
 * should be used instead — no terrain, the ray misses the field, or the query
 * plane is a built surface rather than the ground.
 *
 * Returning null rather than a fallback hit is deliberate: the caller already owns
 * a correct plane intersection for its own frame (world for grid events,
 * level-local for support election), and duplicating that here would mean two
 * definitions of the fallback to keep in sync.
 */
export function resolveTerrainGroundHit(
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
  planeY: number,
): TerrainHit | null {
  if (!isSiteGroundPlane(planeY)) return null
  const field = siteTerrainField()
  if (!field) return null
  return raycastTerrain(field, origin, direction)
}

/**
 * Ground height at a world XZ, for consumers with no ray to march.
 *
 * The 2D plan view is the case this exists for: an orthographic top-down camera
 * makes the pointer ray vertical, so the march degenerates to a single sample and
 * there is no XZ skew to correct — only a Y to report.
 */
export function groundHeightAt(x: number, z: number, planeY: number): number | null {
  if (!isSiteGroundPlane(planeY)) return null
  const field = siteTerrainField()
  if (!field) return null
  return heightAt(field, x, z)
}
