import type { BufferGeometry, GeometryGroup } from 'three'

/**
 * True when `geometry` has a bound `position` attribute and the active draw
 * range contains at least one vertex or index.
 *
 * A geometry whose `position` attribute has `count === 0` (or no `position` at
 * all) leaves WebGPU **vertex buffer slot 0 unbound**. The validator rejects the
 * draw with "Vertex buffer slot 0 … was not set", and — critically — that single
 * rejected draw **poisons the entire command encoder**: every other draw in the
 * frame (the whole scene + every editor overlay) is discarded on the next queue
 * submit ("Invalid CommandBuffer"). The visible result is the whole canvas
 * flickering/garbling, not just the offending mesh.
 *
 * Individual call-sites guard against *creating* empty geometry (see
 * `createPlaceholderGeometry`, the ceiling/door degenerate fallbacks, etc.), but
 * transient/derived geometries can still slip through. A geometry can also have
 * a non-empty position buffer while its `drawRange`, index, or active material
 * group resolves to zero vertices. Three.js still submits `Draw(0, …)` for that
 * case, and WebGPU validates every vertex-buffer slot required by the pipeline
 * even though the draw has no visible output. This predicate mirrors Three's
 * effective-range calculation and skips both forms of empty draw.
 */
export function hasDrawableGeometry(
  geometry: BufferGeometry | undefined | null,
  group?: GeometryGroup | null,
): boolean {
  const position = geometry?.attributes?.position
  if (!(geometry && position && position.count > 0)) return false

  let firstVertex = Math.max(geometry.drawRange.start, 0)
  let lastVertex = geometry.drawRange.start + geometry.drawRange.count

  if (group) {
    firstVertex = Math.max(firstVertex, group.start)
    lastVertex = Math.min(lastVertex, group.start + group.count)
  }

  const itemCount = geometry.index?.count ?? position.count
  lastVertex = Math.min(lastVertex, itemCount)

  const count = lastVertex - firstVertex
  return Number.isFinite(count) && count > 0
}
