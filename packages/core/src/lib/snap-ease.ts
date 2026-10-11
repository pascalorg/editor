/**
 * The ghost snapping to a corner (the owner, 8 October): a short eased move, never a jump or a
 * bounce. Under 200 ms and easing out, so it feels like the window was pulled in; it keeps following
 * the cursor while it eases, and does nothing at all under reduced motion.
 */

/** How long the ghost takes to move into, or out of, a snap (ms). */
export const SNAP_EASE_MS = 120

/** Whether the reader asked for reduced motion; false where the browser cannot say. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3

export function createSnapEaser() {
  let snapped = false
  let last: number | null = null
  let from = 0
  let started = Number.NEGATIVE_INFINITY

  return {
    /**
     * Where to draw the ghost along its wall: `target` is where it belongs (the cursor, or the
     * snapped place), `isSnapped` whether it is snapped now. A change of `isSnapped` starts the move.
     */
    display(target: number, isSnapped: boolean, now: number, reducedMotion: boolean): number {
      if (isSnapped !== snapped) {
        snapped = isSnapped
        if (reducedMotion || last === null) started = Number.NEGATIVE_INFINITY
        else {
          from = last
          started = now
        }
      }
      const progress = Math.min(1, Math.max(0, (now - started) / SNAP_EASE_MS))
      const shown = progress >= 1 ? target : target + (from - target) * (1 - easeOutCubic(progress))
      last = shown
      return shown
    },
    /** Whether a move is under way at `now`, so the caller keeps drawing frames. */
    active(now: number): boolean {
      return now - started < SNAP_EASE_MS
    },
    reset() {
      snapped = false
      last = null
      started = Number.NEGATIVE_INFINITY
    },
  }
}
