'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type ChildQuery,
  createDragSession,
  createSceneApi,
  type DragAction,
  type DragSessionInput,
  emitter,
  type GridEvent,
  type Modifiers,
  type SpatialQuery,
  useScene,
} from '@pascal-app/core'
import { useEffect, useRef } from 'react'

const sceneApi = createSceneApi(useScene)

function modifiersFromGridEvent(event: GridEvent): Modifiers {
  const ne = event.nativeEvent?.nativeEvent as Partial<KeyboardEvent> | undefined
  return {
    shift: ne?.shiftKey ?? false,
    alt: ne?.altKey ?? false,
    ctrl: ne?.ctrlKey ?? false,
    meta: ne?.metaKey ?? false,
  }
}

export type UseDragActionArgs<Ctx, Draft> = {
  /** When true the session is live: subscribes to grid events + Esc.
   * Flipping to false (or unmount) cancels and cleans up. */
  active: boolean
  action: DragAction<Ctx, Draft>
  /** Captured once at the moment `active` flips to true. */
  initial: DragSessionInput
  /** Relations cascade plumbing. */
  spatialQuery?: SpatialQuery
  childQuery?: ChildQuery
  /** Fires once after `action.commit` returns true. */
  onCommit?: () => void
  /** Fires once after `action.cancel` (Esc, unmount, or commit-returns-false). */
  onCancel?: () => void
}

/**
 * React hook wrapping the pure `createDragSession` orchestrator with the
 * editor's grid event emitter and an Esc-to-cancel keyboard binding.
 *
 * - Pauses scene history when active → resumes on commit/cancel/unmount
 * - Per `grid:move` runs preview + snap + apply and cascades dirty marks
 * - `grid:click` triggers commit; Escape triggers cancel
 *
 * For tests of the underlying behavior, drive `createDragSession` directly
 * (no React needed). This hook is the thin glue.
 */
export function useDragAction<Ctx, Draft>(args: UseDragActionArgs<Ctx, Draft>) {
  // Stable refs so handlers don't re-bind when callbacks change.
  const argsRef = useRef(args)
  argsRef.current = args

  useEffect(() => {
    if (!args.active) return

    const session = createDragSession<Ctx, Draft>(argsRef.current.action, sceneApi, {
      spatialQuery: argsRef.current.spatialQuery,
      childQuery: argsRef.current.childQuery,
      onCommit: () => argsRef.current.onCommit?.(),
      onCancel: () => argsRef.current.onCancel?.(),
    })

    session.start(argsRef.current.initial)

    const onMove = (event: GridEvent) => {
      const point: readonly [number, number] = [event.localPosition[0], event.localPosition[2]]
      session.move(point, modifiersFromGridEvent(event))
    }

    const onClick = (_event: GridEvent) => {
      session.commit()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') session.cancel()
    }

    emitter.on('grid:move', onMove)
    emitter.on('grid:click', onClick)
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', onKeyDown)
    }

    return () => {
      emitter.off('grid:move', onMove)
      emitter.off('grid:click', onClick)
      if (typeof window !== 'undefined') {
        window.removeEventListener('keydown', onKeyDown)
      }
      // If the parent flipped `active` to false (or unmounted) while we were
      // still mid-drag, treat it as a cancel — no dangling history pause.
      session.dispose()
    }
  }, [args.active])
}

export type { AnyNode, AnyNodeId, DragAction, Modifiers }
