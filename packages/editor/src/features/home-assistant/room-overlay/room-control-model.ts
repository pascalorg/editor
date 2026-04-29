import {
  type AnyNodeId,
  type CollectionId,
  type Control,
  type ControlValue,
} from '@pascal-app/core'

export type RoomControlTile = {
  canDetachFromRoom?: boolean
  collectionId: CollectionId
  collectionLabel: string
  control: Control
  controlIndex: number
  directActionMode?: 'toggle' | 'trigger' | null
  disabled?: boolean
  id: string
  intensityControl: Extract<Control, { kind: 'slider' }> | null
  intensityControlIndex: number | null
  itemId: AnyNodeId
  itemKind: string
  itemName: string
  legacyIds?: string[]
  linkedItemId?: AnyNodeId
  resourceId?: string
}

export type RoomControlIntensityTile = RoomControlTile & {
  intensityControl: Extract<Control, { kind: 'slider' }>
  intensityControlIndex: number
}

export type RoomControlGroupKind = 'toggle' | 'numeric' | 'mixed'

export type RoomControlGroup = {
  collectionId?: CollectionId
  controlKind: RoomControlGroupKind
  displayName?: string
  id: string
  itemIds: AnyNodeId[]
  members: RoomControlTile[]
}

export type RoomOverlayNode = {
  anchorNodeIds: AnyNodeId[]
  controlGroups: RoomControlGroup[]
  id: string
  iconOnly?: boolean
  roomName: string
  screenPosition?: { x: number; y: number }
  totalSlotCount: number
  worldPosition?: { x: number; y: number; z: number }
}

export type RoomControlLookupEntry = {
  member: RoomControlTile
  source: 'primary' | 'intensity'
}

export type RoomControlChangeSource = RoomControlLookupEntry['source']

export type RoomControlChange = {
  member: RoomControlTile
  nextValue: ControlValue
  source: RoomControlChangeSource
}

export type RoomControlOverlayProps = {
  onApplyRoomGrouping?: (roomId: string, nextGroups: string[][]) => void
  onCopyRoomControlToRoom?: (
    sourceCollectionId: CollectionId,
    targetCollectionId: CollectionId,
  ) => void
  onRemoveRoomControlFromRoom?: (member: RoomControlTile) => void
  onRoomControlChange?: (payload: RoomControlChange) => void
  roomOverlayNodes?: RoomOverlayNode[]
}

export const normalizeRoomControlGroupList = (groups: unknown) =>
  Array.isArray(groups)
    ? groups
        .filter(Array.isArray)
        .map((group) =>
          group.filter((memberId): memberId is string => typeof memberId === 'string'),
        )
        .filter((group) => group.length > 0)
    : []

export const selectRoomControlGroupSource = (
  controls: RoomControlTile[],
  presentationGroups: string[][],
  defaultGroups: string[][],
) => {
  if (
    presentationGroups.length > 0 &&
    roomControlGroupsCoverControls(presentationGroups, controls)
  ) {
    return presentationGroups
  }

  return defaultGroups
}

const roomControlGroupsCoverControls = (groups: string[][], controls: RoomControlTile[]) => {
  if (controls.length === 0 || groups.length === 0) {
    return false
  }

  const groupIds = new Set(groups.flat())
  return controls.every(
    (control) =>
      groupIds.has(control.id) || (control.legacyIds ?? []).some((id) => groupIds.has(id)),
  )
}

export const buildRoomControlGroups = (
  controls: RoomControlTile[],
  storedGroups: string[][],
): RoomControlGroup[] => {
  const controlById = new Map<string, RoomControlTile>()
  for (const control of controls) {
    controlById.set(control.id, control)
    for (const legacyId of control.legacyIds ?? []) {
      controlById.set(legacyId, control)
    }
  }
  const assignedControlIds = new Set<string>()
  const groups: RoomControlGroup[] = []

  for (const storedGroup of storedGroups) {
    const members = storedGroup
      .map((controlId) => controlById.get(controlId))
      .filter((member): member is RoomControlTile => Boolean(member))
    const compatibleMemberGroups = splitRoomControlMembersByKind(members)

    for (const compatibleMembers of compatibleMemberGroups) {
      if (compatibleMembers.length === 0) {
        continue
      }
      for (const member of compatibleMembers) {
        assignedControlIds.add(member.id)
      }
      groups.push(createRoomControlGroup(compatibleMembers))
    }
  }

  for (const control of controls) {
    if (assignedControlIds.has(control.id)) {
      continue
    }
    groups.push(createRoomControlGroup([control]))
  }

  return groups
}

export const getRoomControlKind = (control: Control): RoomControlGroupKind =>
  control.kind === 'toggle' ? 'toggle' : 'numeric'

const getRoomControlGroupKind = (members: RoomControlTile[]): RoomControlGroupKind => {
  return getRoomControlKind(members[0]?.control ?? { kind: 'toggle' })
}

const splitRoomControlMembersByKind = (members: RoomControlTile[]) => {
  const toggleMembers: RoomControlTile[] = []
  const numericMembers: RoomControlTile[] = []

  for (const member of members) {
    if (getRoomControlKind(member.control) === 'toggle') {
      toggleMembers.push(member)
    } else {
      numericMembers.push(member)
    }
  }

  return [toggleMembers, numericMembers].filter((group) => group.length > 0)
}

const getRoomControlGroupId = (members: RoomControlTile[]) =>
  members.map((member) => member.id).join('|')

const createRoomControlGroup = (members: RoomControlTile[]): RoomControlGroup => {
  const collectionIds = Array.from(new Set(members.map((member) => member.collectionId)))
  const singleCollectionId = collectionIds.length === 1 ? collectionIds[0] : undefined
  const collectionLabel =
    singleCollectionId && members.length > 0 ? members[0]?.collectionLabel : undefined

  return {
    collectionId: singleCollectionId,
    controlKind: getRoomControlGroupKind(members),
    displayName: collectionLabel,
    id: getRoomControlGroupId(members),
    itemIds: Array.from(new Set(members.map((member) => member.linkedItemId ?? member.itemId))),
    members,
  }
}

export const canMergeControlGroups = (source: RoomControlGroup, target: RoomControlGroup) =>
  source.id !== target.id && source.controlKind === target.controlKind

export const canMergeControlMemberIntoGroup = (
  member: RoomControlTile,
  target: RoomControlGroup,
) => getRoomControlKind(member.control) === target.controlKind
