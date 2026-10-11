/**
 * Holds the viewport's LAST presented frame on screen while a capture works
 * on the shared scene: the frame loop keeps ticking (useFrame systems still
 * run, a capture can pump frames by hand) but the live draw is skipped, so
 * whatever a capture swaps in for its own renders — a presentation flip, a
 * hidden ground, an override material held across a GPU readback — never
 * reaches the canvas.
 *
 * Holds nest; each one expires on its own after `maxMs` so a capture that
 * never settles cannot freeze the viewport for the session.
 */

let holds = 0
let frameHolds = 0

export function holdLiveFrame(maxMs = 60_000, freezeUpdates = false): () => void {
  holds += 1
  if (freezeUpdates) frameHolds += 1
  let released = false
  const release = () => {
    if (released) return
    released = true
    clearTimeout(expiry)
    holds -= 1
    if (freezeUpdates) frameHolds -= 1
  }
  const expiry = setTimeout(release, maxMs)
  return release
}

export function isLiveFrameHeld(): boolean {
  return holds > 0
}

/** Read-only captures hold animation/controls at their exact in-flight state. */
export function areLiveFrameUpdatesHeld(): boolean {
  return frameHolds > 0
}
