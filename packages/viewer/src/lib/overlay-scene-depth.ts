import type { Texture } from 'three'

/**
 * The scene pass's depth, for materials drawn on the overlay layer. The overlay renders in a pass of
 * its own after the scene (`post-processing.tsx`), with no depth of the scene's, so an overlay that
 * wants to know what stands in front of it (to draw itself quietly behind a wall, say) reads it from
 * here: sample the texture at `screenUV` and compare its view Z with the fragment's.
 *
 * Null while no post-processing pipeline runs (the fallback draw, a capture camera, a viewer with
 * none): an overlay then draws as it always has, on top. A pipeline rebuild hands over a new texture;
 * a listener that already sampled the old one can swap it on its texture node.
 */
let current: Texture | null = null
const listeners = new Set<(depth: Texture | null) => void>()

export function getOverlaySceneDepth(): Texture | null {
  return current
}

/** Called with the scene depth now and whenever it changes; returns the unsubscribe. */
export function subscribeOverlaySceneDepth(listener: (depth: Texture | null) => void): () => void {
  listeners.add(listener)
  listener(current)
  return () => {
    listeners.delete(listener)
  }
}

/** The pipeline's side: the depth of the pass the overlay is composited over, or null when it goes. */
export function setOverlaySceneDepth(depth: Texture | null) {
  if (current === depth) return
  current = depth
  for (const listener of [...listeners]) listener(depth)
}
