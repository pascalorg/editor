import type { LiveNodeOverrides } from '@pascal-app/core'

/**
 * Live-drag reactivity (night-6, user report): the host's move/placement
 * tools ride TRANSIENT node overrides (useLiveNodeOverrides) during a drag
 * and only write useScene.nodes on commit — so the X-ray's framing froze
 * mid-gesture and kings/trimmers/headers snapped only on drop. This helper
 * folds the live overrides into a nodes snapshot so computeLevel can follow
 * the gesture; the renderer throttles the recompute.
 */

/**
 * Merge live overrides into `nodes`. Returns NULL when nothing relevant is
 * being dragged (no override id exists in the snapshot) so callers can fall
 * back to the memoized committed compute with zero extra work.
 */
export function effectiveNodesFor(
  nodes: Record<string, Record<string, unknown>>,
  overrides: ReadonlyMap<string, LiveNodeOverrides>,
): Record<string, Record<string, unknown>> | null {
  if (overrides.size === 0) return null
  let out: Record<string, Record<string, unknown>> | null = null
  for (const [id, patch] of overrides) {
    const base = nodes[id]
    if (!base) continue
    if (!out) out = { ...nodes }
    out[id] = { ...base, ...patch }
  }
  return out
}

/**
 * Trailing-edge throttle: fires at most once per `waitMs`, always ending
 * with the LATEST call's execution (a drag's final position must never be
 * dropped). `cancel` clears any pending trailing call.
 */
export function throttleTrailing(
  fn: () => void,
  waitMs: number,
): { run: () => void; cancel: () => void } {
  let last = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  const run = () => {
    const now = Date.now()
    const elapsed = now - last
    if (elapsed >= waitMs) {
      // A trailing timer may still be pending (scheduled inside the window
      // but delayed past its slot by event-loop lag). Firing immediately
      // AND letting the stale timer land would double-execute within one
      // window — clear it first (night-8 storm-counter gate caught the
      // ceil(span/wait)+1 breach).
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      last = now
      fn()
      return
    }
    if (timer === null) {
      timer = setTimeout(() => {
        timer = null
        last = Date.now()
        fn()
      }, waitMs - elapsed)
    }
  }
  const cancel = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }
  return { run, cancel }
}
