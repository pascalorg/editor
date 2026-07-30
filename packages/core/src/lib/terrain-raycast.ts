/**
 * Ray → terrain intersection.
 *
 * This is the function that replaces `t = -oy / dy` (the flat-ground plane
 * solve) everywhere the editor asks "where on the ground is the pointer?".
 * It lives in `core` with no Three.js so the 2D view, the tools, the placement
 * coordinator, and the tests all call the same code — the failure mode this
 * avoids is each surface having its own idea of where the ground is, which on
 * flat ground is invisible and on a slope is a perspective-skewed offset that
 * only some tools correct for.
 *
 * Method: march the ray in `spacing`-sized steps, watching the sign of
 * `rayY - terrainY`, then bisect the bracketing interval. Marching (rather than
 * per-triangle intersection over the whole grid) is what keeps this O(path
 * length) instead of O(samples) — a 129² field is 32 768 triangles, and testing
 * all of them per pointer-move is not affordable at 50 FPS.
 *
 * The bisection is exact to `spacing / 2^ITERATIONS`; at 0.5 m spacing and 20
 * iterations that is under half a micrometre, i.e. far below the quantization
 * ladder, so the returned point is on the same rendered triangle plane
 * `heightAt` reports.
 */

import { heightAt, type TerrainField } from './terrain-field'

export type TerrainHit = {
  /** Distance along the (unnormalized) direction vector. */
  readonly t: number
  readonly x: number
  readonly y: number
  readonly z: number
}

/** Bisection depth. 20 halvings of one cell is sub-micrometre at any sane spacing. */
const REFINE_ITERATIONS = 20

/**
 * How far to march before giving up, in multiples of `spacing`.
 *
 * A ray aimed just above a distant ridge can travel a long way before it dips
 * below the surface, but an unbounded march is a hang risk if a caller passes a
 * near-horizontal ray. The bound is generous relative to any site: at 0.5 m
 * spacing this is 4 km of travel.
 */
const MAX_STEPS = 8192

/**
 * World-XZ bounds of the field, in metres. The march is clipped to this so a ray
 * pointing away from the site terminates immediately instead of stepping
 * MAX_STEPS times through empty space.
 */
function fieldBounds(field: TerrainField): {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
} {
  return {
    minX: field.origin[0],
    minZ: field.origin[1],
    maxX: field.origin[0] + (field.cols - 1) * field.spacing,
    maxZ: field.origin[1] + (field.rows - 1) * field.spacing,
  }
}

/**
 * Min/max height in metres, cached per `heights` buffer.
 *
 * The vertical extent is what bounds the march for rays that never leave the
 * field in XZ — a straight-down pointer ray, which is the single most common
 * case, has `dx = dz = 0` and therefore an infinite XZ exit. Without a Y bound
 * such a ray relies on `MAX_STEPS` to terminate, and an *upward* one burns all
 * 8192 steps before returning null.
 *
 * The scan is O(samples), so it is cached on the buffer rather than repeated per
 * ray. `applyHeightPatch` allocates a new `Int16Array` for every mutation, which
 * makes the buffer identity a correct version key: a patched field misses the
 * cache and rescans exactly once, and a stale entry is unreachable. `WeakMap`
 * keeps it from retaining fields past their use.
 */
const heightRangeCache = new WeakMap<Int16Array, { minY: number; maxY: number }>()

function heightRange(field: TerrainField): { minY: number; maxY: number } {
  const cached = heightRangeCache.get(field.heights)
  if (cached) return cached
  let min = 0
  let max = 0
  if (field.heights.length > 0) {
    min = field.heights[0] ?? 0
    max = min
    for (let i = 1; i < field.heights.length; i++) {
      const h = field.heights[i] ?? 0
      if (h < min) min = h
      if (h > max) max = h
    }
  }
  const range = { minY: min * field.step, maxY: max * field.step }
  heightRangeCache.set(field.heights, range)
  return range
}

/**
 * Slab-method clip of the ray against the field's bounding box, returning the
 * `[tEnter, tExit]` interval to march. Null when the ray misses the box.
 *
 * All three axes are clipped, not just XZ. The Y slab is what bounds a
 * straight-down ray — `dx = dz = 0` makes both XZ slabs "parallel and inside",
 * so an XZ-only clip returns an infinite exit and the march has to fall back on
 * `MAX_STEPS`. The Y slab is padded because the surface is bilinear between
 * samples and a tangent ray must not be clipped exactly at the extremum.
 */
function clipToField(
  field: TerrainField,
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
): { tEnter: number; tExit: number } | null {
  const bounds = fieldBounds(field)
  const { minY, maxY } = heightRange(field)
  const pad = field.spacing
  let tEnter = 0
  let tExit = Number.POSITIVE_INFINITY

  const axes: Array<[number, number, number, number]> = [
    [origin[0], direction[0], bounds.minX, bounds.maxX],
    [origin[1], direction[1], minY - pad, maxY + pad],
    [origin[2], direction[2], bounds.minZ, bounds.maxZ],
  ]

  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-12) {
      // Parallel to this slab: either always inside or never.
      if (o < lo || o > hi) return null
      continue
    }
    const t1 = (lo - o) / d
    const t2 = (hi - o) / d
    tEnter = Math.max(tEnter, Math.min(t1, t2))
    tExit = Math.min(tExit, Math.max(t1, t2))
    if (tEnter > tExit) return null
  }

  return { tEnter, tExit }
}

/**
 * First intersection of a ray with the terrain surface, or `null` if it misses.
 *
 * `direction` need not be normalized; `t` is in units of `direction`'s length,
 * matching `Ray.at(t)` semantics so a viewer-side caller can pass a three.js ray
 * through unchanged.
 *
 * The march tracks the *sign change* of `rayY - surfaceY` rather than assuming
 * the ray starts above the ground, so a ray fired from inside a hill or from a
 * basement finds the surface it exits through. A ray whose origin is already
 * exactly on the surface returns `t = 0`.
 */
export function raycastTerrain(
  field: TerrainField,
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
): TerrainHit | null {
  const dirLength = Math.hypot(direction[0], direction[1], direction[2])
  if (dirLength < 1e-12) return null

  const clip = clipToField(field, origin, direction)
  if (!clip) return null
  const { tEnter, tExit } = clip

  // Step in world-space multiples of one cell, converted into t units. Half a
  // cell, not a full one, so a ray crossing a single-cell spike cannot step over
  // its peak and report the ground beyond it.
  const stepT = field.spacing / 2 / dirLength
  const at = (t: number) => ({
    x: origin[0] + direction[0] * t,
    y: origin[1] + direction[1] * t,
    z: origin[2] + direction[2] * t,
  })
  const surfaceGap = (t: number) => {
    const p = at(t)
    return p.y - heightAt(field, p.x, p.z)
  }
  const hitAt = (t: number): TerrainHit => {
    const p = at(t)
    return { t, x: p.x, y: heightAt(field, p.x, p.z), z: p.z }
  }

  let prevT = tEnter
  let prevGap = surfaceGap(tEnter)
  // Entering exactly on the surface counts as a hit — a pointer ray grazing the
  // ground plane must not fall through to the caller's flat-plane fallback.
  if (prevGap === 0) return hitAt(tEnter)
  const startedAbove = prevGap > 0

  for (let step = 1; step <= MAX_STEPS; step++) {
    const t = Math.min(tExit, tEnter + step * stepT)
    const gap = surfaceGap(t)

    // A crossing in either direction is a surface hit.
    if (gap === 0 || gap > 0 !== startedAbove) {
      let lo = prevT
      let hi = t
      for (let i = 0; i < REFINE_ITERATIONS; i++) {
        const mid = (lo + hi) / 2
        if (surfaceGap(mid) > 0 === startedAbove) lo = mid
        else hi = mid
      }
      return hitAt(hi)
    }

    prevT = t
    prevGap = gap
    if (t >= tExit) break
  }

  return null
}
