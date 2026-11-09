import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { create } from 'zustand'
import { hasLiveGestures } from '../lib/gesture-lifecycle'
import { removeWallRegion } from '../lib/paint-regions'
import { sfxEmitter } from '../lib/sfx-bus'
import { isTypingTarget } from '../lib/typing-target'
import useDeleteConfirmation from './use-delete-confirmation'
import useInteractionScope from './use-interaction-scope'

// The paint region the user last picked on the selected wall (a handle, an
// outline or a panel row). While it is set, Delete removes that region instead
// of the wall. Cleared whenever the wall selection changes.
//
// `stale` remembers an active region that vanished under the user (undo, another
// edit) while its wall stayed selected: the next Delete is swallowed rather than
// deleting the wall the user was not aiming at.

export type ActiveWallRegion = { wallId: string; regionId: string }

type WallRegionSelectionState = {
  active: ActiveWallRegion | null
  stale: ActiveWallRegion | null
  setActive: (active: ActiveWallRegion | null) => void
  setStale: (stale: ActiveWallRegion | null) => void
}

export const useWallRegionSelection = create<WallRegionSelectionState>((set) => ({
  active: null,
  stale: null,
  setActive: (active) =>
    set((state) =>
      state.active?.wallId === active?.wallId && state.active?.regionId === active?.regionId
        ? state
        : active
          ? { active, stale: null }
          : { active },
    ),
  setStale: (stale) => set((state) => (state.stale === stale ? state : { stale })),
}))

function isSoleSelection(wallId: string, selectedIds: readonly string[]) {
  return selectedIds.length === 1 && selectedIds[0] === wallId
}

function regionExists(wallId: string, regionId: string) {
  const wall = useScene.getState().nodes[wallId as AnyNodeId]
  if (wall?.type !== 'wall') return false
  return wall.faceRegions?.some((region) => region.id === regionId) ?? false
}

/** The active region, only while its wall is the sole selection and the region still exists. */
export function resolveActiveWallRegion(): ActiveWallRegion | null {
  const active = useWallRegionSelection.getState().active
  if (!active) return null
  if (!isSoleSelection(active.wallId, useViewer.getState().selection.selectedIds)) return null
  return regionExists(active.wallId, active.regionId) ? active : null
}

function resolveStaleWallRegion(): ActiveWallRegion | null {
  const stale = useWallRegionSelection.getState().stale
  if (!stale) return null
  return isSoleSelection(stale.wallId, useViewer.getState().selection.selectedIds) ? stale : null
}

/** Clears the active (and stale) region unless the selection is still exactly its wall. */
export function syncWallRegionSelection(selectedIds: readonly string[]) {
  const { active, stale, setActive, setStale } = useWallRegionSelection.getState()
  if (active && !isSoleSelection(active.wallId, selectedIds)) setActive(null)
  if (stale && !isSoleSelection(stale.wallId, selectedIds)) setStale(null)
}

/** Drops the active region once it no longer exists in the scene. */
export function syncWallRegionWithScene() {
  const { active, setActive, setStale } = useWallRegionSelection.getState()
  if (!active || regionExists(active.wallId, active.regionId)) return
  setActive(null)
  const wallStillThere = useScene.getState().nodes[active.wallId as AnyNodeId]?.type === 'wall'
  const selectedIds = useViewer.getState().selection.selectedIds
  if (wallStillThere && isSoleSelection(active.wallId, selectedIds)) setStale(active)
}

/** Keeps the active region in step with scene edits (undo, remote edits). Returns the unsubscribe. */
export function installWallRegionSceneSync() {
  return useScene.subscribe((state, previous) => {
    if (state.nodes !== previous.nodes) syncWallRegionWithScene()
  })
}

// Delete belongs to the region only when focus is on the scene or the wall's
// region list; a focused toolbar button or panel control keeps its own key.
function isSceneOrRegionListTarget(target: EventTarget | null) {
  if (!target) return true
  if (
    typeof document !== 'undefined' &&
    (target === document || target === document.body || target === document.documentElement)
  ) {
    return true
  }
  const element = target as { tagName?: string; closest?: (selector: string) => unknown }
  if (element.tagName?.toUpperCase() === 'CANVAS') return true
  return !!element.closest?.('[data-wall-region-list]')
}

function consume(event: KeyEventLike) {
  event.preventDefault()
  event.stopPropagation()
}

type KeyEventLike = Pick<KeyboardEvent, 'key' | 'target' | 'preventDefault' | 'stopPropagation'>

/**
 * Delete / Backspace with an active region removes that region (one undo step)
 * and consumes the key so the global delete never sees it. Mid-gesture, or
 * right after the active region vanished, the key is swallowed so it cannot
 * fall through to deleting the wall. Returns whether the key was consumed.
 */
export function handleWallRegionDeleteKey(event: KeyEventLike): boolean {
  if (event.key !== 'Delete' && event.key !== 'Backspace') return false
  if (isTypingTarget(event.target)) return false
  if (!isSceneOrRegionListTarget(event.target)) return false
  if (useDeleteConfirmation.getState().request) return false
  const active = resolveActiveWallRegion()
  const stale = active ? null : resolveStaleWallRegion()
  if (!(active || stale)) return false

  consume(event)
  const busy = useInteractionScope.getState().scope.kind !== 'idle' || hasLiveGestures()
  if (busy) return true
  if (stale) {
    useWallRegionSelection.getState().setStale(null)
    return true
  }
  if (!active) return true
  // Cleared first so the scene sync does not mistake this removal for a vanished region.
  useWallRegionSelection.getState().setActive(null)
  if (removeWallRegion(active.wallId, active.regionId)) sfxEmitter.emit('sfx:structure-delete')
  return true
}
