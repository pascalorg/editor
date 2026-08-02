import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { create } from 'zustand'
import { sfxEmitter } from '../lib/sfx-bus'
import {
  canCreateSessionGroup,
  createSessionGroup,
  expandSessionGroupMembers,
  pruneSessionGroups,
  removeMembersFromSessionGroups,
  selectionIntersectsSessionGroup,
  selectionMatchesSessionGroup,
  type SessionSelectionGroup,
  sessionGroupsEqual,
  ungroupSessionSelection,
} from '../lib/session-groups'

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

function commitGroups(next: SessionSelectionGroup[]): boolean {
  const prev = useSessionGroups.getState().groups
  if (sessionGroupsEqual(prev, next)) return false
  useSessionGroups.getState().setGroups(next)
  return true
}

export function pruneSessionGroupsToScene(): boolean {
  return commitGroups(pruneSessionGroups(useSessionGroups.getState().groups, liveNodeIdSet()))
}

export function removeDeletedIdsFromSessionGroups(removedIds: readonly string[]): boolean {
  if (removedIds.length === 0) return false
  return commitGroups(
    removeMembersFromSessionGroups(
      useSessionGroups.getState().groups,
      removedIds,
      liveNodeIdSet(),
    ),
  )
}

export function expandSessionSelectionForNode(nodeId: string): string[] | null {
  const liveIds = liveNodeIdSet()
  const pruned = pruneSessionGroups(useSessionGroups.getState().groups, liveIds)
  commitGroups(pruned)
  if (pruned.length === 0) return null
  return expandSessionGroupMembers(pruned, nodeId, liveIds)
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
