import type { BufferGeometry } from 'three'

export type DrawGroupLike = {
  start?: number
  count?: number
} | null

/**
 * True when `geometry` has a bound, non-empty `position` attribute — i.e. it is
 * safe to submit to the WebGPU renderer.
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
 * transient/derived geometries can still slip through. This predicate is the
 * renderer-level safety net: skipping a count-0 draw is a no-op visually (it
 * would draw nothing anyway) while keeping the command encoder healthy.
 */
export function hasDrawableGeometry(
  geometry: BufferGeometry | undefined | null,
  group?: DrawGroupLike,
): boolean {
  const position = geometry?.attributes?.position
  if (!(position && position.count > 0)) return false

  const drawRangeCount = geometry?.drawRange?.count
  if (Number.isFinite(drawRangeCount) && drawRangeCount <= 0) return false

  const index = geometry?.index
  if (index && index.count <= 0) return false

  if (group) {
    const groupCount = group.count
    if (Number.isFinite(groupCount) && (groupCount ?? 0) <= 0) return false

    const groupStart = Math.max(0, group.start ?? 0)
    if (index) {
      if (groupStart >= index.count) return false
    } else if (groupStart >= position.count) {
      return false
    }
  }

  return true
}
