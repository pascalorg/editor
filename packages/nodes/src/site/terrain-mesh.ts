import type { HeightPatch, TerrainField } from '@pascal-app/core'
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Sphere } from 'three'
import {
  buildTerrainMesh,
  buildTerrainSkirt,
  HORIZON_PLANE_Y,
  patchUpdateRange,
  type TerrainMeshBuffers,
  type TerrainSkirtBuffers,
  updateTerrainMesh,
  updateTerrainSkirt,
} from './terrain-geometry'

/**
 * The Three.js side of the terrain heightfield: owns the `BufferGeometry` and the
 * dirty-rect upload.
 *
 * Kept beside the pure builder rather than in `viewer` because the dependency
 * runs `nodes -> viewer`, not the other way, and this is a per-kind concern
 * anyway. `terrain-geometry.ts` computes *what* goes in the buffers (testable
 * without a canvas); this owns the GPU resource. The only thing that cannot live
 * on the pure side is `addUpdateRange`/`needsUpdate`, which is why this file is
 * thin.
 *
 * Why patch instead of rebuild: a 129² field is 16 641 vertices, so a full
 * re-upload is ~400 KB per dab. There is no render-on-demand to hide behind —
 * `FrameLimiter` runs a perpetual rAF at 50 FPS — so a brush dragged across a
 * slope would re-upload the whole field dozens of times a second.
 */

/** A terrain geometry plus the CPU buffers backing it. */
export type TerrainGeometry = {
  readonly geometry: BufferGeometry
  readonly buffers: TerrainMeshBuffers
  /** Expands during live edits; a committed-field rebuild tightens it again. */
  readonly heightBounds: { minY: number; maxY: number }
  /** The edge curtain that closes the field against the horizon disc. */
  readonly skirt: { readonly geometry: BufferGeometry; readonly buffers: TerrainSkirtBuffers }
}

export function createTerrainGeometry(field: TerrainField): TerrainGeometry {
  const buffers = buildTerrainMesh(field)
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new BufferAttribute(buffers.positions, 3).setUsage(DynamicDrawUsage),
  )
  geometry.setAttribute(
    'normal',
    new BufferAttribute(buffers.normals, 3).setUsage(DynamicDrawUsage),
  )
  geometry.setAttribute('uv', new BufferAttribute(buffers.uvs, 2))
  geometry.setIndex(new BufferAttribute(buffers.indices, 1))
  const span = heightSpan(field)
  setTerrainBounds(geometry, field, span)

  // A separate geometry, not extra vertices on the surface: the surface's dirty
  // range is a row span over a `cols * rows` layout, and appending a perimeter ring
  // to it would break that indexing for a saving of one draw call.
  const skirtBuffers = buildTerrainSkirt(field)
  const skirtGeometry = new BufferGeometry()
  skirtGeometry.setAttribute(
    'position',
    new BufferAttribute(skirtBuffers.positions, 3).setUsage(DynamicDrawUsage),
  )
  skirtGeometry.setAttribute(
    'normal',
    new BufferAttribute(skirtBuffers.normals, 3).setUsage(DynamicDrawUsage),
  )
  skirtGeometry.setIndex(new BufferAttribute(skirtBuffers.indices, 1))
  setSkirtBounds(skirtGeometry, field, span)

  return {
    geometry,
    buffers,
    heightBounds: span,
    skirt: { geometry: skirtGeometry, buffers: skirtBuffers },
  }
}

/**
 * Push one patch to the GPU, touching only the affected rows.
 *
 * Both `position` and `normal` are updated: a height change moves its
 * neighbours' normals too, and `patchUpdateRange` already widens the span by one
 * row on each side to cover that. UVs are never touched — they are a function of
 * grid indices, not heights.
 */
export function applyTerrainPatch(
  target: TerrainGeometry,
  field: TerrainField,
  patch: HeightPatch,
): void {
  const range = patchUpdateRange(field, patch, 3)
  if (!range) return
  updateTerrainMesh(field, target.buffers, patch)
  if (
    patch.col0 <= 0 ||
    patch.row0 <= 0 ||
    patch.col0 + patch.cols >= field.cols ||
    patch.row0 + patch.rows >= field.rows
  ) {
    updateTerrainSkirt(field, target.skirt.buffers)
    for (const name of ['position', 'normal'] as const) {
      const attribute = target.skirt.geometry.getAttribute(name) as BufferAttribute
      attribute.needsUpdate = true
    }
  }
  for (const name of ['position', 'normal'] as const) {
    const attribute = target.geometry.getAttribute(name) as BufferAttribute
    let start = range.start
    let end = start + range.count
    // Only the renderer knows when an upload happened. Keep all dabs since then.
    for (const pending of attribute.updateRanges) {
      start = Math.min(start, pending.start)
      end = Math.max(end, pending.start + pending.count)
    }
    attribute.clearUpdateRanges()
    attribute.addUpdateRange(start, end - start)
    attribute.needsUpdate = true
  }
  // Keep bounds conservative while brushing: removing an old extreme need not
  // rescan the field, while a new extreme must become visible immediately.
  const span = target.heightBounds
  const col0 = Math.max(0, patch.col0)
  const row0 = Math.max(0, patch.row0)
  const col1 = Math.min(field.cols, patch.col0 + patch.cols)
  const row1 = Math.min(field.rows, patch.row0 + patch.rows)
  for (let row = row0; row < row1; row++) {
    for (let col = col0; col < col1; col++) {
      const height = (field.heights[row * field.cols + col] ?? 0) * field.step
      span.minY = Math.min(span.minY, height)
      span.maxY = Math.max(span.maxY, height)
    }
  }
  setTerrainBounds(target.geometry, field, span)
  setSkirtBounds(target.skirt.geometry, field, span)
}

/**
 * Set bounds analytically instead of calling `computeBoundingSphere()`.
 *
 * The computed version walks every vertex twice and allocates; the field's
 * horizontal extent is known in O(1) from `origin`/`spacing`/`cols`/`rows`, and
 * the height range is scanned once, then expanded from patches. Skipping bounds
 * entirely is not an option —
 * a stale bounding sphere gets a raised hill frustum-culled while it is still on
 * screen, which reads as terrain flickering out at certain camera angles.
 */
function setTerrainBounds(
  geometry: BufferGeometry,
  field: TerrainField,
  { minY, maxY }: { minY: number; maxY: number },
): void {
  const minX = field.origin[0]
  const minZ = field.origin[1]
  const maxX = minX + (field.cols - 1) * field.spacing
  const maxZ = minZ + (field.rows - 1) * field.spacing

  geometry.boundingSphere ??= new Sphere()
  const sphere = geometry.boundingSphere
  sphere.center.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2)
  sphere.radius = Math.hypot((maxX - minX) / 2, (maxY - minY) / 2, (maxZ - minZ) / 2)
  if (geometry.boundingBox) {
    geometry.boundingBox.min.set(minX, minY, minZ)
    geometry.boundingBox.max.set(maxX, maxY, maxZ)
  }
}

/**
 * Bounds for the skirt, which hangs below the field's own low point.
 *
 * Reusing `setTerrainBounds` would cull the curtain the moment its top edge left
 * the surface's sphere — the exact symptom the surface's analytic bounds exist to
 * avoid, one geometry over. The vertical span brackets the horizon plane for the
 * same reason the geometry does.
 */
function setSkirtBounds(
  geometry: BufferGeometry,
  field: TerrainField,
  { minY, maxY }: { minY: number; maxY: number },
): void {
  const low = Math.min(minY, HORIZON_PLANE_Y) - 1
  const high = Math.max(maxY, HORIZON_PLANE_Y)

  const minX = field.origin[0]
  const minZ = field.origin[1]
  const maxX = minX + (field.cols - 1) * field.spacing
  const maxZ = minZ + (field.rows - 1) * field.spacing

  geometry.boundingSphere ??= new Sphere()
  const sphere = geometry.boundingSphere
  sphere.center.set((minX + maxX) / 2, (low + high) / 2, (minZ + maxZ) / 2)
  sphere.radius = Math.hypot((maxX - minX) / 2, (high - low) / 2, (maxZ - minZ) / 2)
}

/** Height span in metres, always including the datum so flat ground has a box. */
function heightSpan(field: TerrainField): { minY: number; maxY: number } {
  let minH = 0
  let maxH = 0
  for (let i = 0; i < field.heights.length; i++) {
    const h = field.heights[i] ?? 0
    if (h < minH) minH = h
    if (h > maxH) maxH = h
  }
  return { minY: minH * field.step, maxY: maxH * field.step }
}

/**
 * True when a geometry was built for a differently-shaped field.
 *
 * A resized field cannot be patched — the vertex count changed — so the caller
 * must rebuild. Checking here keeps that decision in one place instead of every
 * caller comparing `cols`/`rows` by hand.
 */
export function needsRebuild(target: TerrainGeometry, field: TerrainField): boolean {
  return target.buffers.positions.length !== field.cols * field.rows * 3
}

export function disposeTerrainGeometry(target: TerrainGeometry): void {
  target.geometry.dispose()
  target.skirt.geometry.dispose()
}
