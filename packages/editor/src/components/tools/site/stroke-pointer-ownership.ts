/**
 * Which pointer a terrain stroke belongs to, and what every other one does.
 *
 * A stroke is a sustained drag with uncommitted state, so "who owns the pointer"
 * is a real decision rather than plumbing — and each wrong answer fails silently
 * in its own way. The tool used to have no answer at all: every branch below fell
 * through to the owning-pointer path.
 *
 * Extracted as a pure function because the interesting part is the *matrix*, which
 * cannot be asserted through the component — reproducing it needs a WebGL canvas,
 * a camera, and synthetic multi-touch. The tool keeps the DOM plumbing.
 */
export type StrokePointerAction =
  /** Start a stroke owned by this pointer. */
  | 'begin'
  /** Route the event into the active stroke. */
  | 'apply'
  /** Drop the stroke, restoring the pre-stroke ground. */
  | 'abandon'
  /** Finish and persist the stroke. */
  | 'commit'
  /** Not our pointer, or nothing in flight. */
  | 'ignore'

export type StrokePointerEvent = 'down' | 'move' | 'up' | 'cancel'

/**
 * `ownerPointerId` is `null` when no stroke is in flight.
 *
 * The rules, in the order they matter:
 *
 * - **A second `down` abandons.** Two fingers on the glass is a pinch-zoom, and by
 *   then the first finger has already deposited a dab; abandoning is what makes
 *   "pinch to look closer" leave no accidental bump. Falling through was the worst
 *   of the options: it orphaned an uncommitted stroke whose dabs were already
 *   baked into the live field's snapshot, so they survived on screen while being
 *   unreachable by undo.
 * - **A non-owning `up` is ignored, not a commit.** Lifting a resting second finger
 *   would otherwise persist a stroke the other finger is still drawing.
 * - **`cancel` abandons where `up` commits.** The browser fires `cancel` when it
 *   takes the gesture away (OS edge swipe, palm rejection), meaning the user never
 *   finished — committing there persists a half-drag nobody released.
 */
export function strokePointerAction(args: {
  event: StrokePointerEvent
  pointerId: number
  ownerPointerId: number | null
}): StrokePointerAction {
  const { event, pointerId, ownerPointerId } = args

  if (event === 'down') {
    return ownerPointerId === null ? 'begin' : 'abandon'
  }
  if (ownerPointerId === null || pointerId !== ownerPointerId) return 'ignore'
  if (event === 'move') return 'apply'
  return event === 'cancel' ? 'abandon' : 'commit'
}
