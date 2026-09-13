/**
 * Parcel geometry projection — pure functions, no network.
 *
 * `server-parcel.cjs` returns parcel rings as GeoJSON-style `[lng, lat]`
 * degree pairs (NOT feet — the PlanCrafters browser bundle projected them
 * client-side in `js/parcel.js#ringsToPlan`). This module is the same
 * local equirectangular ("flat earth") projection, ported so the API route
 * can hand the editor a plan-frame polygon directly.
 *
 * PLAN FRAME (matches the site-node contract):
 *   origin = the geocoded point, x → east, z → south.
 * Latitude increases north, so z flips sign. At parcel scale (≪ 1 mile) the
 * equirectangular error is sub-inch.
 */

/** 1° of latitude ≈ 364,000 ft (≈ 69 mi). Same constant as server-parcel.cjs. */
export const FEET_PER_DEG_LAT = 364000
export const METRES_PER_FOOT = 0.3048
const DEG2RAD = Math.PI / 180

export type LngLat = readonly [number, number]
export type Ring = readonly LngLat[]
/** `[x, z]` pair — x east, z south. */
export type PlanPoint = [number, number]

/**
 * Project `[lng, lat]` rings into the plan frame, in FEET, with `origin`
 * (`[lng, lat]`) at (0, 0). Rings with fewer than 3 usable vertices drop out.
 */
export function ringsToPlanFeet(rings: readonly Ring[], origin: LngLat): PlanPoint[][] {
  const [oLng, oLat] = origin
  if (!Number.isFinite(oLng) || !Number.isFinite(oLat)) return []
  const ftPerDegLng = FEET_PER_DEG_LAT * Math.cos(oLat * DEG2RAD)
  const out: PlanPoint[][] = []
  for (const ring of rings ?? []) {
    if (!Array.isArray(ring)) continue
    const projected: PlanPoint[] = []
    for (const p of ring) {
      if (!Array.isArray(p) || p.length < 2) continue
      const lng = Number(p[0])
      const lat = Number(p[1])
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
      projected.push([(lng - oLng) * ftPerDegLng, -(lat - oLat) * FEET_PER_DEG_LAT])
    }
    if (projected.length >= 3) out.push(projected)
  }
  return out
}

/** Feet → metres, elementwise. */
export function planFeetToMetres(ring: readonly PlanPoint[]): PlanPoint[] {
  return ring.map(([x, z]) => [x * METRES_PER_FOOT, z * METRES_PER_FOOT] as PlanPoint)
}

/**
 * Outer ring of a projected set, in METRES, closing vertex dropped (the
 * site polygon is implicitly closed) and consecutive duplicates removed.
 */
export function outerRingMetres(ringsFeet: readonly PlanPoint[][]): PlanPoint[] {
  const outer = ringsFeet[0]
  if (!outer || outer.length < 3) return []
  const m = planFeetToMetres(outer)
  const EPS = 1e-6
  const deduped: PlanPoint[] = []
  for (const p of m) {
    const last = deduped[deduped.length - 1]
    if (last && Math.abs(last[0] - p[0]) < EPS && Math.abs(last[1] - p[1]) < EPS) continue
    deduped.push(p)
  }
  const first = deduped[0]
  const last = deduped[deduped.length - 1]
  if (
    deduped.length > 3 &&
    first &&
    last &&
    Math.abs(first[0] - last[0]) < EPS &&
    Math.abs(first[1] - last[1]) < EPS
  ) {
    deduped.pop()
  }
  return deduped
}

/** Signed-shoelace area (positive units²) of a closed polygon. */
export function polygonArea(points: readonly PlanPoint[]): number {
  let a = 0
  for (let i = 0, n = points.length; i < n; i++) {
    const p = points[i]
    const q = points[(i + 1) % n]
    if (!p || !q) continue
    a += p[0] * q[1] - q[0] * p[1]
  }
  return Math.abs(a / 2)
}
