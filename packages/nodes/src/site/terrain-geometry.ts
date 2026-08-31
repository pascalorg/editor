import { type HeightPatch, heightAtSample, normalAt, type TerrainField } from '@pascal-app/core'

/**
 * Builds the terrain mesh buffers from a `TerrainField`.
 *
 * Split out of the renderer as pure array math so the vertex layout is
 * unit-testable without a canvas, and so the partial-upload path has one
 * definition. The renderer owns the `BufferGeometry`; this owns what goes in it.
 *
 * The triangulation this file emits is the convention `surfaceHeightAt`
 * (`core/lib/terrain-field.ts`) reads back: two triangles per cell split along the
 * `(c+1,r)`–`(c,r+1)` diagonal. Anything drawn *on* the ground samples that
 * function, so changing the winding below without changing it there would make
 * every draped line sink into half of every cell.
 *
 * Two rules that are easy to get wrong and expensive to debug:
 *
 * - **Normals are analytic, never `computeVertexNormals()`.** Beyond the cost
 *   (~1.5 ms at 257²), `computeVertexNormals()` rewrites the *whole* normal
 *   attribute, which silently defeats the dirty-rect partial upload that makes
 *   sculpting cheap. `normalAt` central-differences the field instead, so a
 *   patch touches only the rows it changed.
 * - **Vertices are one-per-sample and shared between triangles**, so a partial
 *   upload is a contiguous row range. Duplicating verts per-triangle for flat
 *   shading would triple memory and scatter the dirty range.
 */

/**
 * Y of the site's presentation horizon disc (`site/renderer.tsx`).
 *
 * It lives here, next to the skirt, because the skirt is the thing that has to
 * bracket it: its top edge never sits below this plane and its base always clears
 * it, so no sightline can pass between the sculpted ground and the surrounding
 * one. Two readers, one number.
 */
export const HORIZON_PLANE_Y = -0.07

/**
 * How far the skirt's base hangs below the lowest thing it must close over.
 *
 * Only the top edge is visually load-bearing; the base just has to be out of sight
 * under the horizon disc. A metre reads as earth thickness from a grazing camera
 * without being tall enough to poke out of a neighbouring excavation.
 */
const SKIRT_DROP = 1

/** One vertex per sample, row-major — index `r * cols + c` matches the field. */
export type TerrainMeshBuffers = {
  /** xyz per sample, length `cols * rows * 3`. */
  positions: Float32Array
  /** xyz per sample, length `cols * rows * 3`. */
  normals: Float32Array
  /** uv per sample, length `cols * rows * 2`. */
  uvs: Float32Array
  /** Triangle indices, two per grid cell. */
  indices: Uint32Array
}

/** Vertex index of sample [c,r]. */
function vertexIndex(field: TerrainField, col: number, row: number): number {
  return row * field.cols + col
}

export function buildTerrainMesh(field: TerrainField): TerrainMeshBuffers {
  const count = field.cols * field.rows
  const positions = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const uvs = new Float32Array(count * 2)

  for (let r = 0; r < field.rows; r++) {
    for (let c = 0; c < field.cols; c++) {
      const i = r * field.cols + c
      writeVertex(field, positions, normals, uvs, c, r, i)
    }
  }

  // Two triangles per cell. Winding is counter-clockwise seen from +Y so the
  // surface faces up under the default FrontSide material.
  const cells = (field.cols - 1) * (field.rows - 1)
  const indices = new Uint32Array(Math.max(0, cells) * 6)
  let n = 0
  for (let r = 0; r < field.rows - 1; r++) {
    for (let c = 0; c < field.cols - 1; c++) {
      const a = vertexIndex(field, c, r)
      const b = vertexIndex(field, c + 1, r)
      const d = vertexIndex(field, c, r + 1)
      const e = vertexIndex(field, c + 1, r + 1)
      indices[n++] = a
      indices[n++] = d
      indices[n++] = b
      indices[n++] = b
      indices[n++] = d
      indices[n++] = e
    }
  }

  return { positions, normals, uvs, indices }
}

function writeVertex(
  field: TerrainField,
  positions: Float32Array,
  normals: Float32Array,
  uvs: Float32Array,
  col: number,
  row: number,
  index: number,
): void {
  const x = field.origin[0] + col * field.spacing
  const z = field.origin[1] + row * field.spacing
  const y = heightAtSample(field, col, row)

  positions[index * 3] = x
  positions[index * 3 + 1] = y
  positions[index * 3 + 2] = z

  const [nx, ny, nz] = normalAt(field, x, z)
  normals[index * 3] = nx
  normals[index * 3 + 1] = ny
  normals[index * 3 + 2] = nz

  // UVs span the field 0..1 so a tiled ground material scales with the site
  // rather than with sample count.
  uvs[index * 2] = field.cols > 1 ? col / (field.cols - 1) : 0
  uvs[index * 2 + 1] = field.rows > 1 ? row / (field.rows - 1) : 0
}

/**
 * A vertical curtain around the field boundary, closing the terrain against the
 * site's horizon disc.
 *
 * The disc is a flat plate at `HORIZON_PLANE_Y` standing in for ground beyond the
 * field, and the field's extent is punched out of it so an excavation is not simply
 * hidden under it. That punch leaves an open rim, and sculpted ground turns it into
 * a visible fault: a raised edge shows daylight under the terrain shell, a lowered
 * one shows the disc's cut edge hanging in the air over the pit.
 *
 * The curtain spans `[min(h, H) - SKIRT_DROP, max(h, H)]` at every boundary
 * sample, so it *brackets* both the terrain edge and the horizon plane no matter
 * which is higher. That is the whole correctness argument: a sightline through the
 * rim has to cross the curtain, because the curtain covers the rim's entire Y
 * range at the rim's exact XZ.
 *
 * One vertex pair (top, bottom) per boundary sample, in a ring whose first sample
 * is repeated at the end so the strip closes.
 */
export type TerrainSkirtBuffers = {
  /** xyz, `(perimeter + 1) * 2` vertices — top then bottom per ring position. */
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
}

/**
 * The field's own footprint, as a polygon to punch out of the horizon disc.
 *
 * The punch is the only reason an excavation is visible at all: without it the disc
 * — a flat plate at `HORIZON_PLANE_Y` standing in for ground beyond the field —
 * roofs over every pit, so digging a basement reads as no change whatsoever. On
 * raised or flat ground it costs nothing visually, because the terrain shell and its
 * skirt cover the hole from both sides.
 *
 * Inset by half a cell, so the disc and the terrain edge *overlap* rather than meet:
 * two coplanar edges at exactly the same XZ z-fight along the whole perimeter. The
 * inset is what the skirt's bracketing span is covering, which is why this lives
 * beside `buildTerrainSkirt` — the two have to agree about where the rim is, and a
 * footprint that punched wider than the skirt spans would open a gap the skirt never
 * closes.
 *
 * Kept here rather than in the renderer so it is reachable without Three.js: it
 * decides whether a pit is visible, and that is a property to assert, not to eyeball.
 */
export function terrainFootprint(field: TerrainField): Array<[number, number]> {
  const inset = field.spacing / 2
  const minX = field.origin[0] + inset
  const minZ = field.origin[1] + inset
  const maxX = field.origin[0] + (field.cols - 1) * field.spacing - inset
  const maxZ = field.origin[1] + (field.rows - 1) * field.spacing - inset
  return [
    [minX, minZ],
    [maxX, minZ],
    [maxX, maxZ],
    [minX, maxZ],
  ]
}

/** Boundary sample count — a function of the grid shape alone. */
function perimeterCount(field: TerrainField): number {
  if (field.cols < 2 || field.rows < 2) return 0
  return 2 * (field.cols - 1) + 2 * (field.rows - 1)
}

/**
 * The `i`th boundary sample, walking top → right → bottom → left.
 *
 * The direction matters: traversed this way the outward horizontal is the tangent
 * rotated as `(tx, tz) → (tz, -tx)` on every edge, which is what makes one winding
 * rule and one normal formula cover all four sides instead of four special cases.
 */
function boundarySample(field: TerrainField, i: number): { col: number; row: number } {
  const lastCol = field.cols - 1
  const lastRow = field.rows - 1
  if (i < lastCol) return { col: i, row: 0 }
  if (i < lastCol + lastRow) return { col: lastCol, row: i - lastCol }
  if (i < 2 * lastCol + lastRow) return { col: 2 * lastCol + lastRow - i, row: lastRow }
  return { col: 0, row: 2 * (lastCol + lastRow) - i }
}

export function buildTerrainSkirt(field: TerrainField): TerrainSkirtBuffers {
  const count = perimeterCount(field)
  const vertices = count === 0 ? 0 : (count + 1) * 2
  const buffers: TerrainSkirtBuffers = {
    positions: new Float32Array(vertices * 3),
    normals: new Float32Array(vertices * 3),
    indices: new Uint32Array(count * 6),
  }
  for (let i = 0; i < count; i++) {
    const base = i * 6
    const top = i * 2
    const nextTop = (i + 1) * 2
    // Outward faces front: see the winding note on `buildTerrainMesh`.
    buffers.indices[base] = top
    buffers.indices[base + 1] = nextTop
    buffers.indices[base + 2] = top + 1
    buffers.indices[base + 3] = top + 1
    buffers.indices[base + 4] = nextTop
    buffers.indices[base + 5] = nextTop + 1
  }
  updateTerrainSkirt(field, buffers)
  return buffers
}

/**
 * Rewrite the whole skirt in place.
 *
 * Whole, not dirty-ranged, unlike the surface: the perimeter is `2(cols + rows)`
 * vertices — 1 028 at 257², under 3% of the surface's vertex count — so the
 * bookkeeping to find which boundary samples a rectangular patch touched costs
 * more than re-uploading all of them. The surface's dirty range earns its
 * complexity because it saves 400 KB a dab; here there is nothing to save.
 */
export function updateTerrainSkirt(field: TerrainField, buffers: TerrainSkirtBuffers): void {
  const count = perimeterCount(field)
  if (count === 0) return

  for (let i = 0; i <= count; i++) {
    const { col, row } = boundarySample(field, i % count)
    const x = field.origin[0] + col * field.spacing
    const z = field.origin[1] + row * field.spacing
    const h = heightAtSample(field, col, row)

    const previous = boundarySample(field, (i - 1 + count) % count)
    const next = boundarySample(field, (i + 1) % count)
    // Tangent across the neighbours, so a corner gets the bevelled average of its
    // two edges rather than one of them arbitrarily.
    const tx = next.col - previous.col
    const tz = next.row - previous.row
    const tLength = Math.hypot(tx, tz) || 1
    const nx = tz / tLength
    const nz = -tx / tLength

    const topIndex = i * 2
    const bottomIndex = topIndex + 1
    writeSkirtVertex(buffers, topIndex, x, Math.max(h, HORIZON_PLANE_Y), z, nx, nz)
    writeSkirtVertex(buffers, bottomIndex, x, Math.min(h, HORIZON_PLANE_Y) - SKIRT_DROP, z, nx, nz)
  }
}

function writeSkirtVertex(
  buffers: TerrainSkirtBuffers,
  index: number,
  x: number,
  y: number,
  z: number,
  nx: number,
  nz: number,
): void {
  buffers.positions[index * 3] = x
  buffers.positions[index * 3 + 1] = y
  buffers.positions[index * 3 + 2] = z
  buffers.normals[index * 3] = nx
  buffers.normals[index * 3 + 1] = 0
  buffers.normals[index * 3 + 2] = nz
}

/**
 * The contiguous vertex range a patch dirties, in **array elements** — the unit
 * `BufferAttribute.addUpdateRange(start, count)` expects.
 *
 * A patch is rectangular, so the touched vertices are not contiguous unless the
 * patch spans full rows. Rather than issue one range per row, this returns the
 * single span from the patch's first vertex to its last: over-reporting a few
 * clean vertices is far cheaper than many small GPU uploads, and it keeps the
 * caller to one `addUpdateRange` call.
 *
 * The range is widened by one row on each side because a height change moves the
 * *normals* of its neighbours too (central differences reach one sample out).
 * Getting this wrong produces the classic symptom: correct silhouette, stale
 * shading along the edit boundary.
 */
export function patchUpdateRange(
  field: TerrainField,
  patch: HeightPatch,
  itemSize: number,
): { start: number; count: number } | null {
  const firstRow = Math.max(0, patch.row0 - 1)
  const lastRow = Math.min(field.rows - 1, patch.row0 + patch.rows)
  if (lastRow < firstRow) return null

  const startVertex = firstRow * field.cols
  const endVertex = lastRow * field.cols + (field.cols - 1)
  return {
    start: startVertex * itemSize,
    count: (endVertex - startVertex + 1) * itemSize,
  }
}

/**
 * Rewrites only the vertices a patch touched, in place.
 *
 * Takes the *already-patched* field (the one `applyHeightPatch` returned) and
 * the patch that produced it, so the caller cannot accidentally rebuild from
 * stale heights. Mutates the buffers rather than reallocating — that is the
 * whole point of the dirty-rect path.
 */
export function updateTerrainMesh(
  field: TerrainField,
  buffers: TerrainMeshBuffers,
  patch: HeightPatch,
): void {
  const firstRow = Math.max(0, patch.row0 - 1)
  const lastRow = Math.min(field.rows - 1, patch.row0 + patch.rows)
  for (let r = firstRow; r <= lastRow; r++) {
    for (let c = 0; c < field.cols; c++) {
      const i = r * field.cols + c
      writeVertex(field, buffers.positions, buffers.normals, buffers.uvs, c, r, i)
    }
  }
}
