/**
 * Pure helpers for editor-only session selection groups.
 * Not scene-graph nodes; not saved with the project.
 * Ctrl/Cmd+G creates, Ctrl/Cmd+Shift+G dissolves; plain click expands.
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

export function sessionGroupsEqual(
  a: readonly SessionSelectionGroup[],
  b: readonly SessionSelectionGroup[],
): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const left = a[i]!
    const right = b[i]!
    if (left.id !== right.id || left.label !== right.label) return false
    if (left.memberIds.length !== right.memberIds.length) return false
    for (let j = 0; j < left.memberIds.length; j++) {
      if (left.memberIds[j] !== right.memberIds[j]) return false
    }
  }
  return true
}

export function pruneSessionGroups(
  groups: readonly SessionSelectionGroup[],
  liveIds?: ReadonlySet<string> | null,
): SessionSelectionGroup[] {
  const next: SessionSelectionGroup[] = []
  for (const group of groups) {
    const members = uniquePreserveOrder(group.memberIds.filter((id) => isLive(id, liveIds)))
    if (members.length < 2) continue
    next.push(withLabel(group, members))
  }
  return next
}

export function removeMembersFromSessionGroups(
  groups: readonly SessionSelectionGroup[],
  removedIds: readonly string[],
  liveIds?: ReadonlySet<string> | null,
): SessionSelectionGroup[] {
  if (removedIds.length === 0) return pruneSessionGroups(groups, liveIds)
  const removed = new Set(removedIds)
  const stripped = groups.map((group) =>
    withLabel(
      group,
      group.memberIds.filter((id) => !removed.has(id)),
    ),
  )
  return pruneSessionGroups(stripped, liveIds)
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
    return { groups: pruneSessionGroups(groups, liveIds), created: null, alreadyGrouped: false }
  }

  const pruned = pruneSessionGroups(groups, liveIds)
  const memberSet = new Set(members)
  const exact = pruned.find(
    (group) =>
      group.memberIds.length === members.length && group.memberIds.every((id) => memberSet.has(id)),
  )
  if (exact) {
    return { groups: pruned, created: exact, alreadyGrouped: true }
  }

  const kept = pruned.filter((group) => !group.memberIds.some((id) => memberSet.has(id)))
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
    return { groups: pruneSessionGroups(groups, liveIds), dissolved: [] }
  }

  const pruned = pruneSessionGroups(groups, liveIds)
  const kept: SessionSelectionGroup[] = []
  const dissolved: SessionSelectionGroup[] = []
  for (const group of pruned) {
    if (group.memberIds.some((id) => selected.has(id))) {
      dissolved.push(group)
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
    const members = uniquePreserveOrder(group.memberIds.filter((id) => isLive(id, liveIds)))
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
  for (const group of pruneSessionGroups(groups, liveIds)) {
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
  for (const group of pruneSessionGroups(groups, liveIds)) {
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
