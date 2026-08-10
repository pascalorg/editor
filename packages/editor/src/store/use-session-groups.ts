import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { create } from 'zustand'
import {
  canCreateSessionGroup,
  createSessionGroup,
  expandSessionGroupMembers,
  type SessionSelectionGroup,
  selectionIntersectsSessionGroup,
  selectionMatchesSessionGroup,
  ungroupSessionSelection,
} from '../lib/session-groups'
import { sfxEmitter } from '../lib/sfx-bus'

type SessionGroupsState = {
  groups: SessionSelectionGroup[]
  setGroups: (groups: SessionSelectionGroup[]) => void
  clearGroups: () => void
}

const useSessionGroups = create<SessionGroupsState>((set) => ({
  groups: [],
  setGroups: (groups) => set({ groups }),
  clearGroups: () => set({ groups: [] }),
}))

function liveNodeIdSet(): Set<string> {
  return new Set(Object.keys(useScene.getState().nodes))
}

/**
 * Membership is never rewritten when a member is deleted — every read filters
 * against the live scene instead. Deleting a member and undoing must restore it
 * to its group, and a destructive prune would have already dropped it (or the
 * whole group, once it fell under the two-member floor).
 */
export function expandSessionSelectionForNode(nodeId: string): string[] | null {
  const groups = useSessionGroups.getState().groups
  if (groups.length === 0) return null
  return expandSessionGroupMembers(groups, nodeId, liveNodeIdSet())
}

/** Ctrl/Cmd+G — create session group from multi-selection. */
export function groupCurrentSelection(): boolean {
  const selectedIds = useViewer.getState().selection.selectedIds as string[]
  if (selectedIds.length < 2) return false

  const liveIds = liveNodeIdSet()
  const { groups, created } = createSessionGroup(useSessionGroups.getState().groups, selectedIds, {
    liveIds,
  })
  useSessionGroups.getState().setGroups(groups)
  if (!created) return false

  useViewer.getState().setSelection({
    selectedIds: created.memberIds as AnyNodeId[],
  })
  sfxEmitter.emit('sfx:menu-click')
  return true
}

/** Ctrl/Cmd+Shift+G — dissolve session groups intersecting selection. */
export function ungroupCurrentSelection(): boolean {
  const selectedIds = useViewer.getState().selection.selectedIds as string[]
  if (selectedIds.length === 0) return false

  const liveIds = liveNodeIdSet()
  const { groups, dissolved } = ungroupSessionSelection(
    useSessionGroups.getState().groups,
    selectedIds,
    liveIds,
  )
  if (dissolved.length === 0) return false
  useSessionGroups.getState().setGroups(groups)
  sfxEmitter.emit('sfx:menu-click')
  return true
}

export function currentSelectionMatchesSessionGroup(): SessionSelectionGroup | null {
  return selectionMatchesSessionGroup(
    useSessionGroups.getState().groups,
    useViewer.getState().selection.selectedIds as string[],
    liveNodeIdSet(),
  )
}

export function currentSelectionIntersectsSessionGroup(): boolean {
  return selectionIntersectsSessionGroup(
    useSessionGroups.getState().groups,
    useViewer.getState().selection.selectedIds as string[],
    liveNodeIdSet(),
  )
}

export function currentSelectionCanCreateSessionGroup(): boolean {
  return canCreateSessionGroup(
    useSessionGroups.getState().groups,
    useViewer.getState().selection.selectedIds as string[],
    liveNodeIdSet(),
  )
}

export default useSessionGroups
