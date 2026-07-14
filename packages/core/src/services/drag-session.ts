import { type ChildQuery, cascadeDirty, type SpatialQuery } from '../registry/relations-resolver'
import type { DragAction, Modifiers, SceneApi } from '../registry/types'
import type { AnyNode, AnyNodeId } from '../schema/types'
import type { Vec2 } from './snap'

/**
 * Pure orchestrator for a single `DragAction` lifecycle:
 *   begin → (preview → snap? → apply → cascade dirty)* → commit | cancel
 *
 * Bracketed by `pauseHistory()` / `resumeHistory()` so the entire drag is one
 * undo step. The React hook (`useDragAction` in `@pascal-app/editor`) wraps
 * this with event subscriptions; tests drive it directly.
 */

export type DragSessionInput = {
  node?: AnyNode
  point: Vec2
  handleId?: string
  modifiers?: Modifiers
}

export type DragSessionOptions = {
  spatialQuery?: SpatialQuery
  childQuery?: ChildQuery
  /** Called once the session terminates via `commit()`. */
  onCommit?: () => void
  /** Called once the session terminates via `cancel()` or `dispose()`. */
  onCancel?: () => void
}

export type DragSession<Draft> = {
  /** Begin the drag — pause history, capture ctx via `action.begin`. */
  start: (input: DragSessionInput) => void
  /** Per-pointer-move tick — run preview/snap/apply and cascade dirty marks. */
  move: (point: Vec2, modifiers: Modifiers) => void
  /** Pointer-up / discrete commit. Returns true if `action.commit` agreed. */
  commit: () => boolean
  /** Pointer-cancel / Esc / external abort — restores all touched nodes. */
  cancel: () => void
  /** Returns the latest draft `apply` produced (or null before first move). */
  getDraft: () => Draft | null
  isActive: () => boolean
  /** Idempotent cleanup. If active, restores scene state and resumes
   * history, but does **not** fire `onCancel`. Use for React-effect
   * teardown — onCancel would re-trigger the parent's state machine and
   * break StrictMode's double-mount cycle. Esc / external aborts must
   * still call `cancel()` directly. */
  dispose: () => void
}

const EMPTY_MODIFIERS: Modifiers = { shift: false, alt: false, ctrl: false, meta: false }

export function createDragSession<Ctx, Draft>(
  action: DragAction<Ctx, Draft>,
  scene: SceneApi,
  options: DragSessionOptions = {},
): DragSession<Draft> {
  let active = false
  let ctx: Ctx | null = null
  let draft: Draft | null = null
  let dirtyMarked = new Set<AnyNodeId>()

  function markWithCascade(id: AnyNodeId): void {
    if (dirtyMarked.has(id)) return
    const ids = cascadeDirty(id, {
      scene,
      spatialQuery: options.spatialQuery,
      childQuery: options.childQuery,
    })
    for (const dirtyId of ids) {
      if (!dirtyMarked.has(dirtyId)) {
        scene.markDirty(dirtyId)
        dirtyMarked.add(dirtyId)
      }
    }
  }

  function terminate(committed: boolean): void {
    if (!active) return
    active = false
    ctx = null
    draft = null
    dirtyMarked = new Set()
    scene.resumeHistory()
    if (committed) options.onCommit?.()
    else options.onCancel?.()
  }

  return {
    start(input) {
      if (active) return // ignore re-entry
      scene.pauseHistory()
      ctx = action.begin({
        node: input.node,
        point: input.point,
        handleId: input.handleId,
        modifiers: input.modifiers ?? EMPTY_MODIFIERS,
      })
      active = true
    },

    move(point, modifiers) {
      if (!active || ctx == null) return
      let next = action.preview(ctx, point, modifiers)
      if (action.snap) {
        next = action.snap(next, ctx, undefined)
      }
      draft = next
      const dirtyIds = action.apply(next, ctx, scene)
      for (const id of dirtyIds) markWithCascade(id)
    },

    commit() {
      if (!active || ctx == null) return false
      const ok = action.commit?.(draft as Draft, ctx, scene) ?? true
      if (!ok) {
        action.cancel(ctx, scene)
        scene.restoreAll()
      }
      terminate(ok)
      return ok
    },

    cancel() {
      if (!active || ctx == null) return
      action.cancel(ctx, scene)
      scene.restoreAll()
      terminate(false)
    },

    getDraft() {
      return draft
    },

    isActive() {
      return active
    },

    dispose() {
      if (active && ctx != null) {
        action.cancel(ctx, scene)
        scene.restoreAll()
        // Silent terminate: no onCancel. The caller (e.g. useDragAction's
        // effect cleanup) is reacting to the parent unmounting and would
        // loop the state machine if onCancel re-set the parent's state.
        active = false
        ctx = null
        draft = null
        dirtyMarked = new Set()
        scene.resumeHistory()
      }
    },
  }
}
