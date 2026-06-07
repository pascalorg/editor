import type { BufferGeometry } from 'three'

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
export function hasDrawableGeometry(geometry: BufferGeometry | undefined | null): boolean {
  const position = geometry?.attributes?.position
  return Boolean(position && position.count > 0)
}
