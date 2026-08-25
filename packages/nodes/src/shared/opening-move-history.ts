import { acquireSceneHistoryPause, useScene } from '@pascal-app/core'

/**
 * One-undo-entry-per-gesture history session for the door / window MOVE
 * tools (the E5 drag-commit contract: mid-drag writes none, drop writes
 * exactly one, undo restores the exact pre-drag state).
 *
 * The tools previously called `useScene.temporal.getState().pause()` /
 * `.resume()` RAW. That pause is invisible to the refcounted
 * `getSceneHistoryPauseDepth()` every cooperating system checks, which
 * broke the gesture's atomicity two ways:
 *
 *  1. zundo reads `isTracking` AFTER the store's subscribers run for a
 *     write. A subscriber that takes a balanced
 *     `pauseSceneHistory`/`resumeSceneHistory` pair during a mid-drag
 *     write (the space-detection sync does exactly this when a reparent
 *     touches a wall's `children`) sees depth 0 → its resume re-enables
 *     tracking — and the mid-drag write that TRIGGERED it, plus every
 *     write after, lands in `pastStates`. That is night-6's door-drag
 *     undo defect: a scene commit fired the moment the drag armed, and a
 *     completed drag left multiple undo entries, none of them the
 *     baseline (door isTransient/invisible, parented to the level, an
 *     orphan opening at the drop spot...).
 *  2. Systems that stand down during interactions gate on
 *     `getSceneHistoryPauseDepth() > 0`; a raw pause never registered, so
 *     they kept reconciling against half-written mid-drag states.
 *
 * This session holds a refcounted LEASE (`acquireSceneHistoryPause`)
 * instead. While it is held the depth is ≥ 1, so cooperating systems both
 * see the interaction and — crucially — can no longer zero the refcount
 * and resume tracking out from under the gesture. `commitStep` opens the
 * one deliberate tracking window for the drop write; `end` releases the
 * lease (idempotent, safe to call from both cancel and effect cleanup).
 */
export type OpeningMoveHistorySession = {
  /**
   * Run the gesture's single committing write with history tracking live:
   * releases the lease for exactly this call, then re-acquires it so any
   * teardown writes that follow (tool unmount, selection churn) stay out
   * of history. The caller restores the node to its exact pre-drag state
   * (still paused) right BEFORE this, so the one entry zundo records has
   * the true baseline as its past state.
   */
  commitStep<T>(write: () => T): T
  /** Release the gesture's history pause. Idempotent. */
  end(): void
}

export const beginOpeningMoveHistorySession = (): OpeningMoveHistorySession => {
  let release = acquireSceneHistoryPause(useScene)
  return {
    commitStep(write) {
      release()
      try {
        return write()
      } finally {
        release = acquireSceneHistoryPause(useScene)
      }
    },
    end() {
      release()
    },
  }
}
