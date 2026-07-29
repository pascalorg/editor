/**
 * Laying a polyline *on* the terrain surface, exactly.
 *
 * The site boundary is the first consumer: a ring of four flat vertices at
 * `y = 0.01` slices straight through any hill it crosses and floats over any
 * excavation, which is the single most obvious way sculpted ground looks broken —
 * the lot line is the one element always on screen.
 *
 * The approach is exactness rather than density. The rendered surface is
 * piecewise-**planar**: `buildTerrainMesh` emits two triangles per cell, so the
 * only places it creases are the grid lines and each cell's diagonal. Subdivide a
 * segment at exactly those crossings and every resulting sub-segment lies inside
 * one triangle, where the surface is a plane and a straight line on it is on it
 * everywhere. Uniform oversampling can only approach that, and needs an arbitrary
 * density to argue about.
 *
 * In field index space (`u = (x - originX) / spacing`, `v = (z - originZ) /
 * spacing`) the three crease families are just `u ∈ ℤ`, `v ∈ ℤ`, and `u + v ∈ ℤ` —
 * the last being the diagonals, since a cell's diagonal runs from `(c+1, r)` to
 * `(c, r+1)`. All three are affine in the segment parameter, so each crossing is
 * one division.
 *
 * Heights come from `surfaceHeightAt`, the explicit rendered-surface alias for
 * the shared `heightAt` triangle-plane authority.
 *
 * Nothing here touches Three.js: it is array math over a field, so the guarantee
 * that a sub-segment lies inside one triangle is asserted in unit tests rather
 * than eyeballed on a canvas.
 */

import { surfaceHeightAt, type TerrainField } from '@pascal-app/core'

/** A draped polyline: xyz per vertex, plus normalized arc length per vertex. */
export type DrapedPolyline = {
  /** xyz per vertex, length `count * 3`. */
  positions: Float32Array
  /** Normalized distance along the line per vertex, length `count`. */
  uvs: Float32Array
}

/**
 * Crossings per segment, as a backstop only.
 *
 * A real segment produces at most ~3 × the field's sample count along it — a few
 * hundred at 257². The cap exists so a caller that passes a segment spanning a
 * degenerate field (tiny `spacing`, huge extent) cannot allocate unboundedly.
 */
const MAX_CROSSINGS_PER_SEGMENT = 4096

/** Two crossings closer than this (in segment parameter) are the same vertex. */
const PARAM_EPSILON = 1e-9

/**
 * Parameters in `(0, 1)` where the segment crosses a crease of the rendered
 * surface, sorted and deduplicated.
 *
 * Exported for tests: the crease convention is the load-bearing part, and
 * asserting it on the parameter list is far sharper than inferring it from
 * vertex positions.
 */
export function creaseCrossings(
  field: TerrainField,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number[] {
  const u0 = (ax - field.origin[0]) / field.spacing
  const v0 = (az - field.origin[1]) / field.spacing
  const u1 = (bx - field.origin[0]) / field.spacing
  const v1 = (bz - field.origin[1]) / field.spacing

  const crossings: number[] = []
  // Families are clamped to the index range the surface actually creases over.
  // Outside the field the surface is the border cell's plane extruded outward, so
  // crossings out there would add vertices to a stretch that is already flat —
  // harmless geometrically, but an edge far from a fine grid would emit thousands.
  addFamily(crossings, u0, u1, 0, field.cols - 1)
  addFamily(crossings, v0, v1, 0, field.rows - 1)
  addFamily(crossings, u0 + v0, u1 + v1, 0, field.cols - 1 + (field.rows - 1))

  crossings.sort((a, b) => a - b)
  const unique: number[] = []
  for (const t of crossings) {
    const previous = unique.at(-1)
    if (previous !== undefined && t - previous <= PARAM_EPSILON) continue
    unique.push(t)
  }
  return unique
}

/**
 * Push the parameters where an affine coordinate `from → to` passes an integer in
 * `[loBound, hiBound]`.
 */
function addFamily(
  out: number[],
  from: number,
  to: number,
  loBound: number,
  hiBound: number,
): void {
  const delta = to - from
  // Parallel to this family: no crossing, whether or not it lies *on* a crease.
  // A segment running along a grid line is already inside the planes on both
  // sides, so it needs no extra vertex.
  if (Math.abs(delta) < 1e-12) return

  const lo = Math.max(loBound, Math.ceil(Math.min(from, to)))
  const hi = Math.min(hiBound, Math.floor(Math.max(from, to)))
  let emitted = 0
  for (let k = lo; k <= hi; k++) {
    const t = (k - from) / delta
    if (t <= PARAM_EPSILON || t >= 1 - PARAM_EPSILON) continue
    out.push(t)
    emitted += 1
    if (emitted >= MAX_CROSSINGS_PER_SEGMENT) return
  }
}

/**
 * Build a draped polyline through `points`.
 *
 * `field` of `null` means flat ground at the datum: the result is the input
 * points at `y = lift`, no subdivision. Keeping that case *here* rather than at
 * every call site is what lets a consumer hold one geometry and one code path
 * whether or not the site has terrain — and it means a scene that never touched
 * terrain builds byte-identical buffers to the ones it built before draping
 * existed.
 *
 * `closed` repeats the first point at the end, so a `LineStrip` closes the ring.
 */
export function buildDrapedPolyline({
  points,
  field,
  lift,
  closed,
}: {
  points: ReadonlyArray<readonly [number, number]>
  field: TerrainField | null
  lift: number
  closed: boolean
}): DrapedPolyline {
  const xz: Array<[number, number]> = []
  const segments = closed ? points.length : points.length - 1

  for (let index = 0; index < segments; index++) {
    const from = points[index]
    const to = points[(index + 1) % points.length]
    if (!(from && to)) continue
    const [ax, az] = from
    const [bx, bz] = to
    xz.push([ax, az])
    if (!field) continue
    for (const t of creaseCrossings(field, ax, az, bx, bz)) {
      xz.push([ax + (bx - ax) * t, az + (bz - az) * t])
    }
  }
  // The final vertex: the ring's start again when closed, otherwise the last
  // point, which the segment loop above never emits.
  const last = closed ? points[0] : points.at(-1)
  if (last) xz.push([last[0], last[1]])

  const positions = new Float32Array(xz.length * 3)
  for (let index = 0; index < xz.length; index++) {
    const [x, z] = xz[index]!
    positions[index * 3] = x
    positions[index * 3 + 2] = z
  }
  const ring: DrapedPolyline = { positions, uvs: new Float32Array(xz.length) }
  writeDrapedHeights(ring, field, lift)
  writeArcLengths(ring)
  return ring
}

/**
 * Rewrite only the heights of an existing draped polyline, in place.
 *
 * This is the sculpt-stroke path. The crease set is a function of the field's
 * *grid* — origin, spacing, sample counts — and not of its heights, so every dab
 * of a stroke leaves the XZ of every vertex exactly where it was. Rebuilding the
 * ring per dab would reallocate two buffers and a `BufferGeometry` at pointer
 * rate for a result that differs only in Y.
 *
 * Reads each vertex's own XZ back out of the buffer rather than taking the source
 * polygon again: there is then no second copy of the subdivision to keep in step.
 *
 * Arc lengths are deliberately *not* refreshed — see `writeArcLengths`.
 */
export function updateDrapedHeights(
  ring: DrapedPolyline,
  field: TerrainField | null,
  lift: number,
): void {
  writeDrapedHeights(ring, field, lift)
}

function writeDrapedHeights(ring: DrapedPolyline, field: TerrainField | null, lift: number): void {
  const count = ring.uvs.length
  for (let index = 0; index < count; index++) {
    const x = ring.positions[index * 3] ?? 0
    const z = ring.positions[index * 3 + 2] ?? 0
    ring.positions[index * 3 + 1] = field ? surfaceHeightAt(field, x, z) + lift : lift
  }
}

/**
 * Normalized cumulative distance along the line, measured in **XZ**.
 *
 * Horizontal, not 3D: the value has to be stable while the ground moves under a
 * stroke, and a 3D arc length is not — it would stretch as a hill rises, sliding
 * any dash pattern along the ring dab by dab. XZ length is what a plan-view
 * reading of the lot line uses anyway, so the 2D and 3D views agree on it.
 */
function writeArcLengths(ring: DrapedPolyline): void {
  const count = ring.uvs.length
  if (count === 0) return
  let total = 0
  for (let index = 1; index < count; index++) {
    const dx = (ring.positions[index * 3] ?? 0) - (ring.positions[(index - 1) * 3] ?? 0)
    const dz = (ring.positions[index * 3 + 2] ?? 0) - (ring.positions[(index - 1) * 3 + 2] ?? 0)
    total += Math.hypot(dx, dz)
    ring.uvs[index] = total
  }
  if (total <= 0) return
  for (let index = 1; index < count; index++) {
    ring.uvs[index] = (ring.uvs[index] ?? 0) / total
  }
}

/**
 * Everything about a field that changes the crease set, and nothing that doesn't.
 *
 * A React consumer needs to rebuild a draped ring when the *grid* moves and only
 * rewrite heights when the *heights* move. Keying a memo on the field object would
 * rebuild every dab (each `applyHeightPatch` returns a new field); keying it on
 * this rebuilds only when a resize or re-origin actually invalidates the
 * subdivision, which in practice means import. `null` for no terrain, so the
 * flat-ground ring is one more value in the same key space.
 */
export function terrainGridKey(field: TerrainField | null): string | null {
  if (!field) return null
  return `${field.origin[0]}:${field.origin[1]}:${field.spacing}:${field.cols}:${field.rows}`
}
