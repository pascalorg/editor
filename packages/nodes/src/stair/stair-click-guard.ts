/**
 * Guards for the stair tool's commit triggers.
 *
 * One physical validation click can reach the stair tool's commit handler
 * twice: node-surface clicks (`slab:click`, `wall:click`, …) are synthesized
 * on *pointerup* by the viewer (`use-node-events`), while `grid:click` rides
 * the browser's native *click* event from a canvas-level DOM listener
 * (`use-grid-events`) that deliberately ignores R3F stopPropagation — and
 * after a single-continuation commit the tool's emitter subscriptions survive
 * until React unmounts it, which lands only after that native click. Without
 * these guards a validation click over any node surface (a deck or floor
 * slab, a wall, another stair) created TWO stairs from one click.
 *
 * Same hazard and same countermeasures as
 * `packages/nodes/src/shared/floor-placement.ts` (`stopPlacementCommitPropagation`)
 * and the `committed` flag in `move-registry-node-tool.tsx` — reimplemented
 * here because `@pascal-app/editor` cannot depend on `@pascal-app/nodes`.
 */

export type StairCommitGate = {
  /** True while the armed session may still commit. */
  shouldCommit: () => boolean
  /**
   * Mark the session exited (single continuation): every further click
   * trigger reaching the still-subscribed handler — the native follow-up
   * click, a stray second node click — is refused.
   */
  markExited: () => void
}

export function createStairCommitGate(): StairCommitGate {
  let exited = false
  return {
    shouldCommit: () => !exited,
    markExited: () => {
      exited = true
    },
  }
}

type ClickSwallowTarget = {
  addEventListener: (
    type: string,
    listener: (event: Event) => void,
    options?: AddEventListenerOptions,
  ) => void
  removeEventListener: (
    type: string,
    listener: (event: Event) => void,
    options?: EventListenerOptions,
  ) => void
}

/**
 * Eat the one native browser `click` that follows a pointerup-synthesized
 * node click, before it reaches the canvas `grid:click` listener (capture
 * phase on window runs first). Needed in repeat continuation too, where the
 * tool stays armed and the gate above must keep allowing one commit per
 * gesture. Self-disarms after the click or `timeoutMs`, whichever first.
 */
export function swallowFollowUpBrowserClick(
  target: ClickSwallowTarget | undefined = typeof window === 'undefined' ? undefined : window,
  timeoutMs = 300,
): void {
  if (!target) return
  const swallow = (event: Event) => {
    event.stopPropagation()
    event.preventDefault()
  }
  target.addEventListener('click', swallow, { capture: true, once: true })
  setTimeout(() => target.removeEventListener('click', swallow, { capture: true }), timeoutMs)
}
