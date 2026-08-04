/**
 * The terrain heightfield: one regular grid of quantized heights, and the
 * only place terrain geometry is read from.
 *
 * Two invariants carry the whole design:
 *
 * 1. **Quantized to `Int16` multiples of `step`.** Heights are integers, so
 *    "is this ground flat?" is exact integer equality rather than an epsilon
 *    comparison. That is what lets the support election treat terrain as one
 *    discrete candidate (see `slab-support.ts`) instead of a float soup that
 *    never ties. `step` is metres per unit; at 0.01 the Int16 range covers
 *    ±327 m of relief, far past any building site.
 * 2. **Every read goes through `heightAt`.** Consumers never index `heights`
 *    directly. One authority means the mesh, the raycast, the placement
 *    predicate, and the tests cannot disagree about where the ground is.
 *
 * Pure data — no Three.js, per the core layer rule. The mesh built from this
 * lives in `@pascal-app/nodes`.
 */

/**
 * A regular grid of heights over the XZ plane.
 *
 * `origin` is the world XZ of sample [0,0]; sample [c,r] sits at
 * `(origin[0] + c * spacing, origin[1] + r * spacing)`. Row-major, so index
 * `r * cols + c`.
 *
 * Sized `2ⁿ+1` per side by convention (33, 65, 129, …) so a future LOD halving
 * lands on existing samples and shares edge vertices with its neighbour rather
 * than interpolating a seam.
 */
export type TerrainField = {
  /** World XZ of sample [0,0]. */
  readonly origin: readonly [number, number]
  /** Metres between adjacent samples. */
  readonly spacing: number
  readonly cols: number
  readonly rows: number
  /** Metres per `heights` unit — the quantization ladder. */
  readonly step: number
  /** Row-major quantized heights, length `cols * rows`. */
  readonly heights: Int16Array
}

/** A rectangular sub-block of samples — the unit of every terrain write. */
export type HeightPatch = {
  readonly col0: number
  readonly row0: number
  readonly cols: number
  readonly rows: number
  /** Row-major quantized heights, length `cols * rows`. */
  readonly heights: Int16Array
}

export const DEFAULT_TERRAIN_STEP = 0.01
export const DEFAULT_TERRAIN_SPACING = 0.5

export function createTerrainField(options?: {
  origin?: readonly [number, number]
  spacing?: number
  cols?: number
  rows?: number
  step?: number
}): TerrainField {
  const cols = options?.cols ?? 65
  const rows = options?.rows ?? 65
  return {
    origin: options?.origin ?? [0, 0],
    spacing: options?.spacing ?? DEFAULT_TERRAIN_SPACING,
    cols,
    rows,
    step: options?.step ?? DEFAULT_TERRAIN_STEP,
    heights: new Int16Array(cols * rows),
  }
}

/** Quantize a metre height onto the field's ladder, clamped to Int16. */
export function quantize(field: TerrainField, metres: number): number {
  if (!Number.isFinite(metres)) return 0
  const raw = Math.round(metres / field.step)
  return Math.max(-32768, Math.min(32767, raw))
}

/** Sample [c,r] in metres. Out-of-range indices clamp to the edge, so a
 * consumer reading just past the boundary gets the border height rather than
 * a hole — the same clamp-don't-ask rule the vertical model uses. */
export function heightAtSample(field: TerrainField, col: number, row: number): number {
  const c = Math.max(0, Math.min(field.cols - 1, Math.trunc(col)))
  const r = Math.max(0, Math.min(field.rows - 1, Math.trunc(row)))
  return (field.heights[r * field.cols + c] ?? 0) * field.step
}

/**
 * The ground height in metres at a world XZ, on the rendered triangle plane.
 *
 * This is the single read authority named in the plan. Each cell uses the same
 * `(c+1,r)`–`(c,r+1)` diagonal as `nodes/src/site/terrain-geometry.ts`, so
 * placement, picking, collision, draping, and pixels all answer the same height.
 */
export function heightAt(field: TerrainField, x: number, z: number): number {
  if (field.cols < 2 || field.rows < 2) return heightAtSample(field, 0, 0)

  const u = Math.min(field.cols - 1, Math.max(0, (x - field.origin[0]) / field.spacing))
  const v = Math.min(field.rows - 1, Math.max(0, (z - field.origin[1]) / field.spacing))
  const col = Math.min(field.cols - 2, Math.floor(u))
  const row = Math.min(field.rows - 2, Math.floor(v))
  const tc = u - col
  const tr = v - row

  const h00 = heightAtSample(field, col, row)
  const h10 = heightAtSample(field, col + 1, row)
  const h01 = heightAtSample(field, col, row + 1)
  const h11 = heightAtSample(field, col + 1, row + 1)

  if (tc + tr <= 1) return h00 + (h10 - h00) * tc + (h01 - h00) * tr
  return h11 + (h01 - h11) * (1 - tc) + (h10 - h11) * (1 - tr)
}

/**
 * Compatibility name for callers that explicitly describe a rendered surface.
 * There is intentionally no second interpolation model: `heightAt` is the
 * rendered triangle plane.
 */
export function surfaceHeightAt(field: TerrainField, x: number, z: number): number {
  return heightAt(field, x, z)
}

/**
 * Surface normal at a world XZ, from analytic central differences.
 *
 * Central differences rather than per-triangle face normals: the field is the
 * authority, so the normal is a property of the *field* and stays continuous
 * across triangle boundaries. Returns a unit vector, +Y up.
 */
export function normalAt(field: TerrainField, x: number, z: number): [number, number, number] {
  const d = field.spacing
  const dhdx = (heightAt(field, x + d, z) - heightAt(field, x - d, z)) / (2 * d)
  const dhdz = (heightAt(field, x, z + d) - heightAt(field, x, z - d)) / (2 * d)
  // Gradient (dh/dx, dh/dz) → normal (-dh/dx, 1, -dh/dz), normalized.
  const len = Math.hypot(dhdx, 1, dhdz)
  return [-dhdx / len, 1 / len, -dhdz / len]
}

/** Slope in radians from horizontal at a world XZ. 0 = flat, π/2 = vertical. */
export function slopeAt(field: TerrainField, x: number, z: number): number {
  const d = field.spacing
  const dhdx = (heightAt(field, x + d, z) - heightAt(field, x - d, z)) / (2 * d)
  const dhdz = (heightAt(field, x, z + d) - heightAt(field, x, z - d)) / (2 * d)
  return Math.atan(Math.hypot(dhdx, dhdz))
}

/**
 * True when every sample under the world-XZ rect is at the identical quantized
 * height — the placement predicate for kinds that need level ground.
 *
 * Exact integer equality, which is only meaningful because heights are
 * quantized (invariant 1). A float field would need a tolerance here, and that
 * tolerance would then have to agree with the support election's own epsilon —
 * two tunables that could drift apart. Instead there is one ladder and no
 * tolerance.
 */
export function isFlatOver(
  field: TerrainField,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
): boolean {
  const c0 = Math.max(0, Math.floor((minX - field.origin[0]) / field.spacing))
  const r0 = Math.max(0, Math.floor((minZ - field.origin[1]) / field.spacing))
  const c1 = Math.min(field.cols - 1, Math.ceil((maxX - field.origin[0]) / field.spacing))
  const r1 = Math.min(field.rows - 1, Math.ceil((maxZ - field.origin[1]) / field.spacing))
  if (c1 < c0 || r1 < r0) return true

  const first = field.heights[r0 * field.cols + c0] ?? 0
  for (let r = r0; r <= r1; r++) {
    const rowBase = r * field.cols
    for (let c = c0; c <= c1; c++) {
      if ((field.heights[rowBase + c] ?? 0) !== first) return false
    }
  }
  return true
}

/**
 * The one write API. Every terrain mutation — brush stroke, DEM import, scan
 * conversion, preset, MCP tool — lands here.
 *
 * Returns a new field with a new `heights` buffer, so a stroke's before/after
 * pair can be diffed for undo and for `diffToPatches`. Patch samples outside
 * the field are ignored rather than throwing: an imported DEM is allowed to
 * overhang the site, and clipping is the sane response.
 */
export function applyHeightPatch(field: TerrainField, patch: HeightPatch): TerrainField {
  const heights = new Int16Array(field.heights)
  for (let pr = 0; pr < patch.rows; pr++) {
    const row = patch.row0 + pr
    if (row < 0 || row >= field.rows) continue
    const destBase = row * field.cols
    const srcBase = pr * patch.cols
    for (let pc = 0; pc < patch.cols; pc++) {
      const col = patch.col0 + pc
      if (col < 0 || col >= field.cols) continue
      heights[destBase + col] = patch.heights[srcBase + pc] ?? 0
    }
  }
  return { ...field, heights }
}

/** The world-XZ sample range a rect covers, clamped to the field. Shared by
 * the brushes so every tool agrees which samples a footprint touches. */
export function sampleRangeOver(
  field: TerrainField,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
): { col0: number; row0: number; col1: number; row1: number } | null {
  const col0 = Math.max(0, Math.floor((minX - field.origin[0]) / field.spacing))
  const row0 = Math.max(0, Math.floor((minZ - field.origin[1]) / field.spacing))
  const col1 = Math.min(field.cols - 1, Math.ceil((maxX - field.origin[0]) / field.spacing))
  const row1 = Math.min(field.rows - 1, Math.ceil((maxZ - field.origin[1]) / field.spacing))
  if (col1 < col0 || row1 < row0) return null
  return { col0, row0, col1, row1 }
}

/**
 * The only brush in the first slice: set every sample under a world-XZ rect to
 * one absolute height.
 *
 * Absolute-height flatten before raise/lower is deliberate. A raise/lower brush
 * answers "make this taller", which the user cannot aim; flatten-to-height
 * answers "put the ground at 2.5 m here", which is the actual task when siting
 * a building — and it is the one brush whose result is predictable enough to
 * test. Returns null when the rect misses the field entirely.
 */
export function flattenPatch(
  field: TerrainField,
  rect: { minX: number; minZ: number; maxX: number; maxZ: number },
  metres: number,
): HeightPatch | null {
  const range = sampleRangeOver(field, rect.minX, rect.minZ, rect.maxX, rect.maxZ)
  if (!range) return null
  const cols = range.col1 - range.col0 + 1
  const rows = range.row1 - range.row0 + 1
  const value = quantize(field, metres)
  const heights = new Int16Array(cols * rows)
  heights.fill(value)
  return { col0: range.col0, row0: range.row0, cols, rows, heights }
}

/**
 * Split the difference between two fields into patches that each stay under
 * `maxBytes` when serialized.
 *
 * This exists because scene operations are capped at
 * `MAX_SCENE_OPERATION_BYTES` (64 KiB) and each mutation carries both `from`
 * and `to` — so a whole-field write is over budget the moment the grid gets
 * interesting. Rows are the split unit: a patch is always whole rows, which
 * keeps reassembly trivial and means a single-row edit costs one row.
 *
 * Returns the minimal dirty row span, so a small brush stroke on a large field
 * produces a small patch rather than a full-field rewrite.
 */
export function diffToPatches(
  before: TerrainField,
  after: TerrainField,
  maxBytes: number,
): HeightPatch[] {
  if (before.cols !== after.cols || before.rows !== after.rows) {
    // Shape changed — the whole field is dirty; chunk it wholesale.
    return chunkRows(after, 0, after.rows - 1, maxBytes)
  }

  const patches: HeightPatch[] = []
  let runStart = -1
  for (let r = 0; r < after.rows; r++) {
    const base = r * after.cols
    let dirty = false
    for (let c = 0; c < after.cols; c++) {
      if (before.heights[base + c] !== after.heights[base + c]) {
        dirty = true
        break
      }
    }
    if (dirty && runStart < 0) runStart = r
    if (!dirty && runStart >= 0) {
      patches.push(...chunkRows(after, runStart, r - 1, maxBytes))
      runStart = -1
    }
  }
  if (runStart >= 0) patches.push(...chunkRows(after, runStart, after.rows - 1, maxBytes))
  return patches
}

/** Slice a whole-row span into patches that each fit `maxBytes`. */
function chunkRows(
  field: TerrainField,
  firstRow: number,
  lastRow: number,
  maxBytes: number,
): HeightPatch[] {
  // 2 bytes per Int16 sample, and the transport carries `from` + `to`, so a
  // row costs twice its raw size. Halving the budget up front keeps the caller
  // from having to know that.
  const bytesPerRow = field.cols * 2 * 2
  const rowsPerChunk = Math.max(1, Math.floor(maxBytes / Math.max(1, bytesPerRow)))
  const patches: HeightPatch[] = []
  for (let start = firstRow; start <= lastRow; start += rowsPerChunk) {
    const end = Math.min(lastRow, start + rowsPerChunk - 1)
    const rows = end - start + 1
    patches.push({
      col0: 0,
      row0: start,
      cols: field.cols,
      rows,
      heights: field.heights.slice(start * field.cols, (end + 1) * field.cols),
    })
  }
  return patches
}
