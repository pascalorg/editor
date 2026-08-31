/**
 * Hidden-wall pointer hold.
 *
 * Walls hidden by the wall-mode pass ('down' mode, cutaway-hidden faces,
 * auto-mode interior partitions) are pointer-TRANSPARENT: their invisible
 * full-height collision meshes early-return every pointer event so clicks
 * aimed at visible objects behind them (wall-mounted plugin device boxes,
 * items) reach their real target (see the wall renderer's gated handlers).
 *
 * That transparency breaks the tools whose ENTIRE cursor model is the wall
 * surface: the door / window move + place tools track the cursor through
 * `wall:enter` / `wall:move` / `wall:click` emitted by those same handlers.
 * With the wall silent, the floor free-follow takes over and the opening
 * floats off its wall as a red world-axis-aligned ghost — un-placeable.
 *
 * A wall-surface tool ACQUIRES this hold for its active lifetime; while any
 * hold is live, hidden walls keep their pointer events (they stay visually
 * hidden). Plain selection clicks — no tool active, no hold — keep passing
 * through, so the device-box fix this transparency shipped for is intact.
 *
 * Counter-based so overlapping tools compose; the returned release is
 * idempotent so a React effect cleanup can never double-decrement.
 */

let holdCount = 0

/** Keep hidden walls pointer-targetable while the caller's tool is active. */
export const holdHiddenWallPointerEvents = (): (() => void) => {
  holdCount += 1
  let released = false
  return () => {
    if (released) return
    released = true
    holdCount -= 1
  }
}

/** True while any wall-surface tool holds hidden-wall pointer events. */
export const hiddenWallPointerEventsHeld = (): boolean => holdCount > 0
