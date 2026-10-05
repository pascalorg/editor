import { type AnyNodeId, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'
import useEditor, { isBrushMode } from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'
import type { ActiveInteractionScope, InteractionScope } from './interaction/scope'
import { usePaintRegionMode } from './paint-region-mode'

// The one lifecycle owner for pointer gestures and multi-click drafts (handle
// drags, room pick-ups and pushes, Divide, paint regions). A gesture registers
// what it was started under; the owner cancels it synchronously the moment
// that context goes away — mode, tool, paint sub-mode, phase, level or
// selection change, its scope replaced, what it edits deleted, any history
// command, or its host unmounting — and always releases what it holds (its
// own scope only, pointer capture, live overrides) in `finally`, so a throwing
// commit or cancel can never leave a gesture half-alive.

export type GestureCancelReason =
  | 'mode'
  | 'level'
  | 'selection'
  | 'scope'
  | 'stale'
  | 'history'
  | 'unmount'
  | 'cancel'

type CaptureTarget = Pick<Element, 'hasPointerCapture' | 'releasePointerCapture'> &
  Partial<Pick<Element, 'setPointerCapture'>>

export type GestureSpec = {
  /** What the gesture is, for diagnostics and tests. */
  kind: string
  /**
   * Drops the gesture's own in-flight state (draft, preview, listeners,
   * pending frames). Never writes the scene. Runs once, on cancel only.
   */
  onCancel: (reason: GestureCancelReason) => void
  /** A scope the owner begins for the gesture and releases only while it is still this one. */
  scope?: ActiveInteractionScope
  /**
   * Whether a scope is the gesture's own (after `update()`s); losing it
   * cancels. Defaults to the claimed scope's kind + node + handle; a gesture
   * whose host began the scope passes `scopeMatcher(thatScope)`.
   */
  ownsScope?: (scope: InteractionScope) => boolean
  /** The gesture no longer applies (its node or room is gone). */
  stale?: () => boolean
  /** Selection changes do not cancel (the gesture drives the selection itself). */
  keepSelection?: boolean
  /** The paint region sub-mode is part of the gesture's context (paint gestures only). */
  paintSubMode?: boolean
}

export type GestureHandle = {
  readonly kind: string
  /** Live until it ends, commits or is cancelled. */
  readonly active: boolean
  /** Captures a pointer for the gesture; released when it ends, whichever way. */
  capturePointer: (target: CaptureTarget, pointerId: number) => void
  /** Releases a pointer captured for this press (a multi-click draft between presses). */
  releasePointer: (pointerId?: number) => void
  /** Live override ids to clear when the gesture ends. */
  trackOverride: (id: string) => void
  /**
   * Commits: the gesture leaves the owner first (so reactions to the commit —
   * a selection change, a scope swap — cannot cancel it mid-write), the
   * commit runs, and the release runs in `finally`.
   */
  finish: <T>(commit: () => T) => T | undefined
  /** Normal end without a commit (nothing to paint, a refused release). */
  end: () => void
  /** Cancels (idempotent): `onCancel`, then the release in `finally`. */
  cancel: (reason?: GestureCancelReason) => void
}

type Context = {
  phase: string
  mode: string
  tool: string | null
  paintMode: string
  levelId: string | null
  selection: string
}

type Entry = {
  spec: GestureSpec
  handle: GestureHandle
  context: Context
  ownsScope: ((scope: InteractionScope) => boolean) | null
}

const live: Entry[] = []
let stopWatching: (() => void) | null = null

function readContext(): Context {
  const editor = useEditor.getState()
  const selection = useViewer.getState().selection
  return {
    phase: editor.phase,
    mode: editor.mode,
    tool: editor.tool ?? null,
    paintMode: usePaintRegionMode.getState().mode,
    levelId: selection.levelId ?? null,
    selection: selection.selectedIds.join('|'),
  }
}

/** Matches `claimed` by kind, node and handle, so `update()`s of its payload still match. */
export function scopeMatcher(claimed: ActiveInteractionScope) {
  const nodeId = 'nodeId' in claimed ? claimed.nodeId : undefined
  const handle = 'handle' in claimed ? claimed.handle : undefined
  return (scope: InteractionScope) =>
    scope.kind === claimed.kind &&
    ('nodeId' in scope ? scope.nodeId : undefined) === nodeId &&
    ('handle' in scope ? scope.handle : undefined) === handle
}

/** Why `entry` must end now, or null while its context holds. */
function cancelReason(entry: Entry): GestureCancelReason | null {
  const now = readContext()
  const was = entry.context
  if (
    now.phase !== was.phase ||
    now.mode !== was.mode ||
    now.tool !== was.tool ||
    (entry.spec.paintSubMode && now.paintMode !== was.paintMode)
  )
    return 'mode'
  if (now.levelId !== was.levelId) return 'level'
  if (!entry.spec.keepSelection && now.selection !== was.selection) return 'selection'
  if (entry.ownsScope && !entry.ownsScope(useInteractionScope.getState().scope)) return 'scope'
  if (entry.spec.stale?.()) return 'stale'
  return null
}

function check() {
  for (const entry of [...live]) {
    if (!entry.handle.active) continue
    const reason = cancelReason(entry)
    if (reason) entry.handle.cancel(reason)
  }
}

function watch() {
  if (stopWatching) return
  const stops = [
    useEditor.subscribe(check),
    usePaintRegionMode.subscribe(check),
    useViewer.subscribe(check),
    useScene.subscribe(check),
    useInteractionScope.subscribe(check),
  ]
  stopWatching = () => {
    for (const stop of stops) stop()
  }
}

function unwatchIfIdle() {
  if (live.length || !stopWatching) return
  stopWatching()
  stopWatching = null
}

/** Starts a gesture under the owner. Claims `spec.scope` when given. */
export function beginGesture(spec: GestureSpec): GestureHandle {
  const scopes = useInteractionScope.getState()
  const previous = scopes.scope
  if (spec.scope) scopes.begin(spec.scope)
  const ownsScope = spec.ownsScope ?? (spec.scope ? scopeMatcher(spec.scope) : null)

  let active = true
  const captures: { target: CaptureTarget; pointerId: number }[] = []
  const overrides = new Set<string>()

  const releasePointer = (pointerId?: number) => {
    for (let i = captures.length - 1; i >= 0; i--) {
      const capture = captures[i]!
      if (pointerId !== undefined && capture.pointerId !== pointerId) continue
      captures.splice(i, 1)
      try {
        if (capture.target.hasPointerCapture(capture.pointerId))
          capture.target.releasePointerCapture(capture.pointerId)
      } catch {
        // The pointer is already gone.
      }
    }
  }

  // Everything the gesture holds, released whatever happened before.
  const release = () => {
    releasePointer()
    if (overrides.size) {
      const store = useLiveNodeOverrides.getState()
      for (const id of overrides) store.clear(id)
      const scene = useScene.getState()
      for (const id of overrides) if (scene.nodes[id as AnyNodeId]) scene.markDirty(id as AnyNodeId)
      overrides.clear()
    }
    if (spec.scope && ownsScope) {
      const scope = useInteractionScope.getState()
      if (ownsScope(scope.scope)) {
        // A brush mode holds its scope for its whole lifetime; hand it back.
        if (
          (previous.kind === 'painting' || previous.kind === 'sculpting') &&
          isBrushMode(useEditor.getState().mode)
        )
          scope.begin(previous)
        else scope.end()
      }
    }
  }

  const leave = () => {
    const index = live.indexOf(entry)
    if (index >= 0) live.splice(index, 1)
    unwatchIfIdle()
  }

  const handle: GestureHandle = {
    kind: spec.kind,
    get active() {
      return active
    },
    capturePointer: (target, pointerId) => {
      if (!active) return
      try {
        target.setPointerCapture?.(pointerId)
      } catch {
        // A synthetic or already-released pointer cannot be captured; window listeners still end it.
      }
      captures.push({ target, pointerId })
    },
    releasePointer,
    trackOverride: (id) => {
      if (active) overrides.add(id)
    },
    finish: (commit) => {
      if (!active) return undefined
      active = false
      leave()
      try {
        return commit()
      } finally {
        release()
      }
    },
    end: () => {
      if (!active) return
      active = false
      leave()
      release()
    },
    cancel: (reason = 'cancel') => {
      if (!active) return
      active = false
      leave()
      try {
        spec.onCancel(reason)
      } finally {
        release()
      }
    },
  }
  const entry: Entry = { spec, handle, context: readContext(), ownsScope }
  live.push(entry)
  watch()
  return handle
}

/** Cancels every live gesture. Returns whether any was live. */
export function cancelGestures(reason: GestureCancelReason): boolean {
  if (!live.length) return false
  for (const entry of [...live]) entry.handle.cancel(reason)
  return true
}

export function hasLiveGestures(): boolean {
  return live.length > 0
}

/** The kinds of the live gestures, oldest first (tests, diagnostics). */
export function liveGestureKinds(): string[] {
  return live.map((entry) => entry.spec.kind)
}

/** Mounted once by the editor: its unmount cancels whatever is still live. */
export function useGestureLifecycleOwner() {
  useEffect(() => () => void cancelGestures('unmount'), [])
}
