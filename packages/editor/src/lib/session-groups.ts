/**
 * Pure helpers for editor-only session selection groups.
 * Not scene-graph nodes; not saved with the project.
 * Ctrl/Cmd+G creates, Ctrl/Cmd+Shift+G dissolves; plain click expands.
 *
 * Stored membership is never rewritten to drop deleted nodes — `liveIds`
 * filtering happens on every read instead. A destructive prune would make
 * delete-then-undo lose the restored node's group, and would drop the group
 * outright once it fell under the two-member floor.
 */

export type SessionSelectionGroup = {
  id: string
  memberIds: readonly string[]
  label: string
}

export type SessionGroupIdFactory = () => string

let sessionGroupSerial = 0

export function nextSessionGroupId(): string {
  sessionGroupSerial += 1
  return `session-group-${sessionGroupSerial}`
}

export function nextSessionGroupLabel(): string {
  return `Group ${Math.max(1, sessionGroupSerial)}`
}

export function resetSessionGroupIdSerial(value = 0): void {
  sessionGroupSerial = value
}

function uniquePreserveOrder(ids: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function isLive(id: string, liveIds?: ReadonlySet<string> | null): boolean {
  if (!liveIds) return true
  return liveIds.has(id)
}

function withLabel(
  group: SessionSelectionGroup,
  memberIds: readonly string[],
): SessionSelectionGroup {
  return {
    id: group.id,
    label: group.label || 'Group',
    memberIds,
  }
}

function liveMembers(group: SessionSelectionGroup, liveIds?: ReadonlySet<string> | null): string[] {
  return uniquePreserveOrder(group.memberIds.filter((id) => isLive(id, liveIds)))
}

/**
 * Read-time view: groups narrowed to their live members, dropping any that fall
 * under two. A group below the floor is inert, not gone — deleting members never
 * touches storage, so undo brings it back.
 */
export function liveSessionGroups(
  groups: readonly SessionSelectionGroup[],
  liveIds?: ReadonlySet<string> | null,
): SessionSelectionGroup[] {
  const next: SessionSelectionGroup[] = []
  for (const group of groups) {
    const members = liveMembers(group, liveIds)
    if (members.length < 2) continue
    next.push(withLabel(group, members))
  }
  return next
}

export function createSessionGroup(
  groups: readonly SessionSelectionGroup[],
  memberIds: readonly string[],
  options?: {
    liveIds?: ReadonlySet<string> | null
    idFactory?: SessionGroupIdFactory
    labelFactory?: () => string
  },
): {
  groups: SessionSelectionGroup[]
  created: SessionSelectionGroup | null
  alreadyGrouped: boolean
} {
  const liveIds = options?.liveIds
  const members = uniquePreserveOrder(memberIds.filter((id) => isLive(id, liveIds)))
  if (members.length < 2) {
    return { groups: [...groups], created: null, alreadyGrouped: false }
  }

  const memberSet = new Set(members)
  const exact = liveSessionGroups(groups, liveIds).find(
    (group) =>
      group.memberIds.length === members.length && group.memberIds.every((id) => memberSet.has(id)),
  )
  if (exact) {
    return { groups: [...groups], created: exact, alreadyGrouped: true }
  }

  // Grouping a selection takes its members out of whatever group they were in,
  // dissolving that group whole rather than leaving a remnant.
  const kept = groups.filter((group) => !group.memberIds.some((id) => memberSet.has(id)))
  const id = (options?.idFactory ?? nextSessionGroupId)()
  const label =
    options?.labelFactory?.() ??
    (options?.idFactory ? `Group ${kept.length + 1}` : nextSessionGroupLabel())
  const created: SessionSelectionGroup = { id, label, memberIds: members }
  return { groups: [...kept, created], created, alreadyGrouped: false }
}

export function ungroupSessionSelection(
  groups: readonly SessionSelectionGroup[],
  selectedIds: readonly string[],
  liveIds?: ReadonlySet<string> | null,
): { groups: SessionSelectionGroup[]; dissolved: SessionSelectionGroup[] } {
  const selected = new Set(selectedIds)
  if (selected.size === 0) {
    return { groups: [...groups], dissolved: [] }
  }

  const kept: SessionSelectionGroup[] = []
  const dissolved: SessionSelectionGroup[] = []
  for (const group of groups) {
    // Only a live-viable group is visible to the user, so only that can be
    // dissolved. An inert one (members deleted) is left alone for undo.
    const live = liveMembers(group, liveIds)
    if (live.length >= 2 && live.some((id) => selected.has(id))) {
      dissolved.push(withLabel(group, live))
    } else {
      kept.push(group)
    }
  }
  return { groups: kept, dissolved }
}

export function expandSessionGroupMembers(
  groups: readonly SessionSelectionGroup[],
  nodeId: string,
  liveIds?: ReadonlySet<string> | null,
): string[] | null {
  if (!nodeId) return null
  for (const group of groups) {
    if (!group.memberIds.includes(nodeId)) continue
    const members = liveMembers(group, liveIds)
    if (members.length < 2) return null
    if (members[0] === nodeId) return members
    return [nodeId, ...members.filter((id) => id !== nodeId)]
  }
  return null
}

export function selectionMatchesSessionGroup(
  groups: readonly SessionSelectionGroup[],
  selectedIds: readonly string[],
  liveIds?: ReadonlySet<string> | null,
): SessionSelectionGroup | null {
  if (selectedIds.length < 2) return null
  const selected = uniquePreserveOrder(selectedIds.filter((id) => isLive(id, liveIds)))
  if (selected.length < 2) return null
  const selectedSet = new Set(selected)
  for (const group of liveSessionGroups(groups, liveIds)) {
    if (group.memberIds.length !== selected.length) continue
    if (group.memberIds.every((id) => selectedSet.has(id))) return group
  }
  return null
}

export function selectionIntersectsSessionGroup(
  groups: readonly SessionSelectionGroup[],
  selectedIds: readonly string[],
  liveIds?: ReadonlySet<string> | null,
): boolean {
  if (selectedIds.length === 0) return false
  const selected = new Set(selectedIds)
  for (const group of liveSessionGroups(groups, liveIds)) {
    if (group.memberIds.some((id) => selected.has(id))) return true
  }
  return false
}

export function canCreateSessionGroup(
  groups: readonly SessionSelectionGroup[],
  selectedIds: readonly string[],
  liveIds?: ReadonlySet<string> | null,
): boolean {
  const live = uniquePreserveOrder(selectedIds.filter((id) => isLive(id, liveIds)))
  if (live.length < 2) return false
  return selectionMatchesSessionGroup(groups, live, liveIds) === null
}
