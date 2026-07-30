import type { HeightPatch, TerrainField } from '@pascal-app/core'
import { BufferAttribute, BufferGeometry, Sphere, Vector3 } from 'three'
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
  /** The edge curtain that closes the field against the horizon disc. */
  readonly skirt: { readonly geometry: BufferGeometry; readonly buffers: TerrainSkirtBuffers }
}

export function createTerrainGeometry(field: TerrainField): TerrainGeometry {
  const buffers = buildTerrainMesh(field)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(buffers.positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(buffers.normals, 3))
  geometry.setAttribute('uv', new BufferAttribute(buffers.uvs, 2))
  geometry.setIndex(new BufferAttribute(buffers.indices, 1))
  setTerrainBounds(geometry, field)

  // A separate geometry, not extra vertices on the surface: the surface's dirty
  // range is a row span over a `cols * rows` layout, and appending a perimeter ring
  // to it would break that indexing for a saving of one draw call.
  const skirtBuffers = buildTerrainSkirt(field)
  const skirtGeometry = new BufferGeometry()
  skirtGeometry.setAttribute('position', new BufferAttribute(skirtBuffers.positions, 3))
  skirtGeometry.setAttribute('normal', new BufferAttribute(skirtBuffers.normals, 3))
  skirtGeometry.setIndex(new BufferAttribute(skirtBuffers.indices, 1))
  setSkirtBounds(skirtGeometry, field)

  return { geometry, buffers, skirt: { geometry: skirtGeometry, buffers: skirtBuffers } }
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
  updateTerrainMesh(field, target.buffers, patch)

  // The skirt goes up unconditionally, before the range bail: a patch that leaves
  // the surface's dirty span empty can still have moved a boundary sample, and a
  // stale skirt is a hole at the property line.
  updateTerrainSkirt(field, target.skirt.buffers)
  for (const name of ['position', 'normal'] as const) {
    const attribute = target.skirt.geometry.getAttribute(name) as BufferAttribute
    attribute.needsUpdate = true
  }
  setSkirtBounds(target.skirt.geometry, field)

  const range = patchUpdateRange(field, patch, 3)
  if (!range) return

  for (const name of ['position', 'normal'] as const) {
    const attribute = target.geometry.getAttribute(name) as BufferAttribute
    // `clearUpdateRanges` first: ranges accumulate, so a stroke dabbing 60 times
    // a second would otherwise grow an unbounded list that all gets re-uploaded.
    attribute.clearUpdateRanges()
    attribute.addUpdateRange(range.start, range.count)
    attribute.needsUpdate = true
  }

  setTerrainBounds(target.geometry, field)
}

/**
 * Set bounds analytically instead of calling `computeBoundingSphere()`.
 *
 * The computed version walks every vertex twice and allocates; the field's
 * horizontal extent is known in O(1) from `origin`/`spacing`/`cols`/`rows`, and
 * only the height range needs a scan. Skipping bounds entirely is not an option —
 * a stale bounding sphere gets a raised hill frustum-culled while it is still on
 * screen, which reads as terrain flickering out at certain camera angles.
 */
function setTerrainBounds(geometry: BufferGeometry, field: TerrainField): void {
  const { minY, maxY } = heightSpan(field)
  const minX = field.origin[0]
  const minZ = field.origin[1]
  const maxX = minX + (field.cols - 1) * field.spacing
  const maxZ = minZ + (field.rows - 1) * field.spacing

  const center = new Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2)
  const radius = Math.hypot((maxX - minX) / 2, (maxY - minY) / 2, (maxZ - minZ) / 2)

  geometry.boundingSphere = new Sphere(center, radius)
  if (geometry.boundingBox) {
    geometry.boundingBox.set(new Vector3(minX, minY, minZ), new Vector3(maxX, maxY, maxZ))
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
function setSkirtBounds(geometry: BufferGeometry, field: TerrainField): void {
  const { minY, maxY } = heightSpan(field)
  const low = Math.min(minY, HORIZON_PLANE_Y) - 1
  const high = Math.max(maxY, HORIZON_PLANE_Y)

  const minX = field.origin[0]
  const minZ = field.origin[1]
  const maxX = minX + (field.cols - 1) * field.spacing
  const maxZ = minZ + (field.rows - 1) * field.spacing

  const center = new Vector3((minX + maxX) / 2, (low + high) / 2, (minZ + maxZ) / 2)
  const radius = Math.hypot((maxX - minX) / 2, (high - low) / 2, (maxZ - minZ) / 2)
  geometry.boundingSphere = new Sphere(center, radius)
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
