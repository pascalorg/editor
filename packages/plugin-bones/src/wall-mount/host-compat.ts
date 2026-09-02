import * as core from '@pascal-app/core'
import { pauseSceneHistory, resumeSceneHistory, sceneRegistry, useScene } from '@pascal-app/core'

/**
 * Feature-detected bridges to host machinery newer than the pinned
 * @pascal-app/core types (0.9.2). The host app resolves the WORKSPACE core at
 * runtime (1.0.0-beta.x), which ships both APIs; standalone plugin tests run
 * against the pinned npm build, which ships only the refcounted pause pair.
 * Same pattern as the `parentFrame` capability casts in device/service
 * definition.ts — read structurally, degrade gracefully.
 */

type CoreExtras = {
  /** editor #694 — refcounted history-pause LEASE (idempotent release). */
  acquireSceneHistoryPause?: (store: typeof useScene) => () => void
  /** editor #689 — keep hidden walls pointer-targetable while a wall-surface
   * tool is active (X-ray 'down' mode walls are otherwise pointer-transparent). */
  holdHiddenWallPointerEvents?: () => () => void
}

const extras = core as unknown as CoreExtras

/**
 * One-undo-entry-per-gesture history session — the door/window MOVE tools'
 * `beginOpeningMoveHistorySession` contract (editor #694), generalized for
 * Bones wall-mount moves:
 *
 *  - the gesture holds a REFCOUNTED history pause for its whole lifetime, so
 *    `getSceneHistoryPauseDepth()` stays ≥ 1: cooperating host systems (the
 *    space-detection sync — the night-5 D2/D3 poison) see the interaction
 *    and stand down, and a balanced pause/resume pair inside a subscriber
 *    can never resume tracking out from under the drag;
 *  - `commitStep` opens the ONE deliberate tracking window for the drop
 *    write, then re-pauses so teardown writes stay out of history;
 *  - `end` releases the pause. Idempotent — cancel and the effect cleanup
 *    can both call it.
 *
 * Uses the host's lease API (`acquireSceneHistoryPause`) when present;
 * otherwise the refcounted `pauseSceneHistory`/`resumeSceneHistory` pair
 * (same depth counter — both are visible to `getSceneHistoryPauseDepth`).
 */
export type MoveHistorySession = {
  commitStep<T>(write: () => T): T
  end(): void
}

function acquirePause(): () => void {
  if (typeof extras.acquireSceneHistoryPause === 'function') {
    return extras.acquireSceneHistoryPause(useScene)
  }
  pauseSceneHistory(useScene)
  let released = false
  return () => {
    if (released) return
    released = true
    resumeSceneHistory(useScene)
  }
}

export function beginMoveHistorySession(): MoveHistorySession {
  let release = acquirePause()
  return {
    commitStep(write) {
      release()
      try {
        return write()
      } finally {
        release = acquirePause()
      }
    },
    end() {
      release()
    },
  }
}

/**
 * Hold hidden-wall pointer events for the tool's lifetime (editor #689):
 * X-ray 'down' mode makes hidden walls pointer-transparent for selection;
 * a wall-surface move tool needs their `wall:*` events to keep the node
 * sliding along its own hidden wall. No-op release when the host predates
 * the hold (the drag then only rides visible walls + the floor fallback).
 */
export function holdHiddenWallPointerEventsCompat(): () => void {
  if (typeof extras.holdHiddenWallPointerEvents === 'function') {
    return extras.holdHiddenWallPointerEvents()
  }
  return () => {}
}

/**
 * Live hide state of a wall's registered mesh — the host's `WallCutout` pass
 * stamps `userData.wallHidden` on the wall's scene-registry object every
 * frame (mirrors packages/nodes shared/opening-move-wall-gate.ts, which the
 * host does not export). Unregistered walls count as visible.
 */
export function isWallMeshHidden(wallId: string): boolean {
  const object = sceneRegistry.nodes.get(wallId as never) as
    | { userData?: Record<string, unknown> }
    | undefined
  return object?.userData?.wallHidden === true
}
