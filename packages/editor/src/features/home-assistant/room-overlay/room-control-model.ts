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

export type GroupVisualSegment = {
  count: number
  itemKind: string
}

export type GroupIntensitySegment = {
  itemKind: string
  key: string
  members: RoomControlIntensityTile[]
  ratio: number
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

export const getGroupItemKind = (group: RoomControlGroup) => {
  const itemKinds = Array.from(new Set(group.members.map((member) => member.itemKind)))
  return itemKinds.length === 1 ? (itemKinds[0] ?? 'item') : 'group'
}

export const getMajorityItemKind = (members: Array<Pick<RoomControlTile, 'itemKind'>>) => {
  let majorityItemKind = 'item'
  let majorityCount = 0
  const counts = new Map<string, number>()

  for (const member of members) {
    const itemKind = member.itemKind || 'item'
    const count = (counts.get(itemKind) ?? 0) + 1
    counts.set(itemKind, count)

    if (count > majorityCount) {
      majorityItemKind = itemKind
      majorityCount = count
    }
  }

  return majorityItemKind
}

export const getGroupDisplayKinds = (group: RoomControlGroup) => {
  const itemKinds = Array.from(new Set(group.members.map((member) => member.itemKind)))
  return itemKinds.length <= 1 ? [itemKinds[0] ?? 'item'] : itemKinds
}

export const getGroupVisualSegments = (group: RoomControlGroup): GroupVisualSegment[] => {
  const counts = new Map<string, number>()
  for (const member of group.members) {
    counts.set(member.itemKind, (counts.get(member.itemKind) ?? 0) + 1)
  }

  return getGroupDisplayKinds(group).map((itemKind) => ({
    count: counts.get(itemKind) ?? 0,
    itemKind,
  }))
}

export const getControlLabel = (control: Control) => {
  if (control.kind === 'toggle') {
    return control.label?.trim() || 'Power'
  }
  return control.label?.trim() || (control.kind === 'temperature' ? 'Temperature' : 'Level')
}

export const getGroupTitle = (group: RoomControlGroup) => {
  if (group.displayName) {
    return group.displayName
  }
  if (group.members.length === 1) {
    return group.members[0]?.itemName ?? 'Item'
  }
  return `${group.members.length} items`
}

export const getGroupSubtitle = (group: RoomControlGroup) => {
  if (group.members.length === 1) {
    return getControlLabel(group.members[0]!.control)
  }

  const names = Array.from(new Set(group.members.map((member) => member.itemName)))
  if (names.length <= 2) {
    return names.join(', ')
  }
  return `${names.slice(0, 2).join(', ')} + ${names.length - 2} more`
}

export const getGroupTooltip = (group: RoomControlGroup) =>
  group.members.length === 1
    ? `${group.members[0]?.itemName ?? 'Item'}: ${getControlLabel(group.members[0]?.control ?? { kind: 'toggle' })}`
    : `${getGroupTitle(group)}: ${getGroupSubtitle(group)}`

export const getGroupAccessibleLabel = (group: RoomControlGroup) => {
  if (group.displayName) {
    return group.displayName
  }
  if (group.members.length === 1) {
    return group.members[0]?.itemName ?? 'item'
  }
  return `${group.members.length} grouped items`
}

export const hasIntensityControl = (
  member: RoomControlTile,
): member is RoomControlIntensityTile =>
  Boolean(member.intensityControl && member.intensityControlIndex !== null)

export const getGroupIntensityTiles = (group: RoomControlGroup) =>
  group.members.filter(hasIntensityControl)

const getNormalizedSliderValue = (
  control: Extract<Control, { kind: 'slider' }>,
  value: ControlValue | undefined,
) => {
  const min = control.min
  const max = control.max
  if (Math.abs(max - min) < 0.001) {
    return 1
  }
  const resolvedValue = Number(getResolvedControlValue(control, value))
  return Math.max(0, Math.min(1, (resolvedValue - min) / (max - min)))
}

export const getSliderValueAtRatio = (
  control: Extract<Control, { kind: 'slider' }>,
  ratio: number,
) => {
  const clampedRatio = Math.max(0, Math.min(1, ratio))
  const rawValue = control.min + (control.max - control.min) * clampedRatio
  const step = control.step && control.step > 0 ? control.step : 1
  const snappedValue = control.min + Math.round((rawValue - control.min) / step) * step
  return clampNumericControlValue(Number(snappedValue.toFixed(4)), control)
}

export const getGroupIntensitySegments = (
  group: RoomControlGroup,
  controlValues: Record<AnyNodeId, { controlValues: ControlValue[] }>,
): GroupIntensitySegment[] => {
  const intensityTiles = getGroupIntensityTiles(group)
  if (intensityTiles.length === 0) {
    return []
  }

  const kindOrder = Array.from(new Set(intensityTiles.map((member) => member.itemKind)))
  const groupedMembers =
    kindOrder.length <= 1
      ? [
          {
            itemKind: intensityTiles[0]?.itemKind ?? 'item',
            key: intensityTiles.map((member) => member.id).join('|'),
            members: intensityTiles,
          },
        ]
      : kindOrder.map((itemKind) => ({
          itemKind,
          key: itemKind,
          members: intensityTiles.filter((member) => member.itemKind === itemKind),
        }))

  return groupedMembers.map((segment) => ({
    ...segment,
    ratio:
      segment.members.reduce(
        (total, member) =>
          total +
          getNormalizedSliderValue(
            member.intensityControl,
            controlValues[member.itemId]?.controlValues?.[member.intensityControlIndex],
          ),
        0,
      ) / Math.max(segment.members.length, 1),
  }))
}

export const getControlStep = (control: Extract<Control, { kind: 'slider' | 'temperature' }>) => {
  if (control.kind === 'temperature') {
    return 1
  }
  return control.step || 1
}

export const clampNumericControlValue = (
  nextValue: number,
  control: Extract<Control, { kind: 'slider' | 'temperature' }>,
) => Math.max(control.min, Math.min(control.max, nextValue))

export const getResolvedControlValue = (
  control: Control,
  value: ControlValue | undefined,
): ControlValue => {
  if (value !== undefined) {
    return value
  }
  switch (control.kind) {
    case 'toggle':
      return control.default ?? false
    case 'slider':
      return control.default ?? control.min
    case 'temperature':
      return control.default ?? control.min
  }
}

export const formatControlValue = (
  control: Extract<Control, { kind: 'slider' | 'temperature' }>,
  value: number,
) => {
  const rounded =
    Math.abs(value - Math.round(value)) < 0.001 ? `${Math.round(value)}` : value.toFixed(1)
  const unit = control.unit ? ` ${control.unit}` : ''
  return `${rounded}${unit}`
}

export const applyNumericGroupDelta = (
  group: RoomControlGroup,
  controlValues: Record<AnyNodeId, { controlValues: ControlValue[] }>,
  onChange: (itemId: AnyNodeId, controlIndex: number, nextValue: ControlValue) => void,
  direction: -1 | 1,
) => {
  for (const member of group.members) {
    if (member.disabled || member.control.kind === 'toggle') {
      continue
    }
    const currentValue = Number(
      getResolvedControlValue(
        member.control,
        controlValues[member.itemId]?.controlValues?.[member.controlIndex],
      ),
    )
    onChange(
      member.itemId,
      member.controlIndex,
      clampNumericControlValue(
        currentValue + getControlStep(member.control) * direction,
        member.control,
      ),
    )
  }
}

export const getGroupNumericDisplayValue = (
  group: RoomControlGroup,
  controlValues: Record<AnyNodeId, { controlValues: ControlValue[] }>,
) => {
  const numericMembers = group.members.filter(
    (
      member,
    ): member is RoomControlTile & {
      control: Extract<Control, { kind: 'slider' | 'temperature' }>
    } => member.control.kind !== 'toggle',
  )

  if (numericMembers.length === 0) {
    return ''
  }

  const values = numericMembers.map((member) =>
    Number(
      getResolvedControlValue(
        member.control,
        controlValues[member.itemId]?.controlValues?.[member.controlIndex],
      ),
    ),
  )

  const firstValue = values[0] ?? 0
  const allSame = values.every((value) => Math.abs(value - firstValue) < 0.001)
  if (!allSame) {
    return 'Mixed'
  }

  return formatControlValue(numericMembers[0]!.control, firstValue)
}

export const getItemBadgeText = (itemKind: string) => {
  switch (itemKind) {
    case 'light':
      return 'LT'
    case 'fan':
      return 'FN'
    case 'switch':
      return 'SW'
    case 'outlet':
      return 'OT'
    case 'shade':
    case 'blind':
    case 'curtain':
      return 'SH'
    case 'door':
      return 'DR'
    case 'window':
      return 'WN'
    case 'fireplace':
      return 'FP'
    case 'speaker':
      return 'SP'
    case 'tv':
      return 'TV'
    case 'group':
      return 'GR'
    default:
      return 'IT'
  }
}

export const getAccentRgb = (itemKind: string) => {
  switch (itemKind) {
    case 'light':
      return '245, 158, 11'
    case 'fan':
      return '59, 130, 246'
    case 'switch':
      return '249, 115, 22'
    case 'outlet':
      return '168, 85, 247'
    case 'shade':
    case 'blind':
    case 'curtain':
      return '14, 165, 233'
    case 'door':
      return '34, 197, 94'
    case 'window':
      return '56, 189, 248'
    case 'fireplace':
      return '239, 68, 68'
    case 'speaker':
    case 'tv':
      return '217, 70, 239'
    case 'group':
      return '59, 130, 246'
    default:
      return '148, 163, 184'
  }
}

export const scaleRgb = (rgb: string, factor: number) =>
  rgb
    .split(',')
    .map((channel) => Math.max(0, Math.min(255, Math.round(Number(channel.trim()) * factor))))
    .join(', ')
