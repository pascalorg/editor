import {
  type AnyNode,
  type AnyNodeId,
  type Collection,
  type CollectionId,
  type Control,
  type ControlValue,
  getHomeAssistantBindingCapabilities,
  getHomeAssistantBindingDisplayLabel,
  type HomeAssistantActionRequest,
  type HomeAssistantCollectionBinding,
  type HomeAssistantCollectionBindingMap,
  type HomeAssistantCollectionCapability,
  type HomeAssistantResourceBinding,
  hasHomeAssistantBinding,
  type ItemNode,
  isHomeAssistantTriggerBinding,
  resolveLevelId,
} from '@pascal-app/core'
import {
  getLegacySmartHomeRoomControlTileId,
  getSmartHomeBindingControlResources,
  getSmartHomeRoomControlMode,
  getSmartHomeRoomControlTileGroups,
  getSmartHomeRoomControlTileId,
  isSmartHomeBindingPresentationHidden,
  isSmartHomeControllableEntityResource,
  isSmartHomeDeviceComponentResource,
  isSmartHomeGroupResource,
} from '../../../lib/smart-home-composition'
import type { SmartHomeOverlayVisibility } from '../../../store/use-editor'
import {
  buildRoomControlGroups,
  normalizeRoomControlGroupList,
  type RoomControlChangeSource,
  type RoomControlTile,
  type RoomOverlayNode,
  selectRoomControlGroupSource,
} from './room-control-model'

type RoomOverlayNodeBuildInput = {
  bindings: HomeAssistantCollectionBindingMap
  collections: Record<CollectionId, Collection>
  sceneNodes: Record<AnyNodeId, AnyNode>
  selectedLevelId: AnyNodeId | null
  visibility: SmartHomeOverlayVisibility
}

const createCollectionFallbackControl = (label: string): Control => ({
  kind: 'toggle',
  label,
})

const createSyntheticBrightnessControl = (): Extract<Control, { kind: 'slider' }> => ({
  default: 100,
  displayMode: 'slider',
  kind: 'slider',
  label: 'Brightness',
  max: 100,
  min: 0,
  step: 1,
  unit: '%',
})

const getResourceSyntheticIntensityControl = (
  resource: HomeAssistantResourceBinding | null | undefined,
): Extract<Control, { kind: 'slider' }> | null =>
  resource?.capabilities.includes('brightness') ? createSyntheticBrightnessControl() : null

const getHomeAssistantOverlaySection = (
  binding: HomeAssistantCollectionBinding | null | undefined,
): keyof SmartHomeOverlayVisibility | null => {
  if (!binding?.resources.length) {
    return null
  }

  if (binding.resources.some((resource) => resource.kind !== 'entity')) {
    return 'actions'
  }

  if (binding.resources.some((resource) => isSmartHomeGroupResource(resource))) {
    return 'groups'
  }

  return 'devices'
}

const isHomeAssistantOverlayBindingVisible = (
  binding: HomeAssistantCollectionBinding | null | undefined,
  visibility: SmartHomeOverlayVisibility,
) => {
  if (isSmartHomeBindingPresentationHidden(binding?.presentation)) {
    return false
  }

  const section = getHomeAssistantOverlaySection(binding)
  return section ? visibility[section] : true
}

export const bindingHasGroupResource = (
  binding: HomeAssistantCollectionBinding | null | undefined,
) => Boolean(binding?.resources.some((resource) => isSmartHomeGroupResource(resource)))

const getBindingDeviceComponentResources = (
  binding: HomeAssistantCollectionBinding | null | undefined,
) => binding?.resources.filter(isSmartHomeDeviceComponentResource) ?? []

export const getActionBindingForMember = (
  binding: HomeAssistantCollectionBinding,
  member: RoomControlTile,
): HomeAssistantCollectionBinding | null => {
  const memberResource = member.resourceId
    ? binding.resources.find((resource) => resource.id === member.resourceId)
    : null
  const resources = memberResource
    ? isSmartHomeControllableEntityResource(memberResource)
      ? [memberResource]
      : []
    : binding.resources.filter(isSmartHomeControllableEntityResource)

  if (resources.length === 0) {
    return null
  }

  return {
    aggregation: resources.length === 1 ? 'single' : 'all',
    collectionId: binding.collectionId,
    presentation: binding.presentation,
    primaryResourceId: resources[0]?.id ?? null,
    resources,
  }
}

const collectionHasBoundResources = (
  collection: Collection,
  bindings: HomeAssistantCollectionBindingMap,
) => {
  const binding = bindings[collection.id]
  return (
    hasHomeAssistantBinding(binding) &&
    (binding?.resources ?? []).some((resource) => resource.kind === 'entity')
  )
}

const isIconOnlyDeviceCollection = (
  collection: Collection,
  binding: HomeAssistantCollectionBinding | null | undefined,
) =>
  Boolean(
    binding &&
      !bindingHasGroupResource(binding) &&
      !binding.presentation?.rtsWorldPosition &&
      !binding.presentation?.rtsScreenPosition &&
      collection.nodeIds.length === 1 &&
      binding.resources.some((resource) => resource.kind === 'entity'),
  )

export const getCollectionDisplayName = (
  collection: Collection,
  bindings: HomeAssistantCollectionBindingMap,
) => getHomeAssistantBindingDisplayLabel(bindings[collection.id], collection.name)

const compareCollectionsForRoom = (
  left: Collection,
  right: Collection,
  bindings: HomeAssistantCollectionBindingMap,
) => {
  const leftOrder = bindings[left.id]?.presentation?.rtsOrder ?? Number.MAX_SAFE_INTEGER
  const rightOrder = bindings[right.id]?.presentation?.rtsOrder ?? Number.MAX_SAFE_INTEGER
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder
  }
  return getCollectionDisplayName(left, bindings).localeCompare(
    getCollectionDisplayName(right, bindings),
  )
}

const getCollectionItemNodes = (collection: Collection, sceneNodes: Record<AnyNodeId, AnyNode>) =>
  collection.nodeIds
    .map((nodeId) => sceneNodes[nodeId])
    .filter((node): node is ItemNode => node?.type === 'item')

const getCollectionAnchorItemNodes = (
  collection: Collection,
  sceneNodes: Record<AnyNodeId, AnyNode>,
) => {
  const candidateNodeIds = collection.controlNodeId
    ? [collection.controlNodeId, ...collection.nodeIds]
    : collection.nodeIds

  return Array.from(new Set(candidateNodeIds))
    .map((nodeId) => sceneNodes[nodeId])
    .filter((node): node is ItemNode => node?.type === 'item')
}

const isCollectionVisibleOnSelectedLevel = (
  collection: Collection,
  sceneNodes: Record<AnyNodeId, AnyNode>,
  selectedLevelId: AnyNodeId | null,
) => {
  if (!selectedLevelId) {
    return true
  }

  const candidateNodeIds = collection.controlNodeId
    ? [collection.controlNodeId, ...collection.nodeIds]
    : collection.nodeIds

  return candidateNodeIds.some((nodeId) => {
    const node = sceneNodes[nodeId]
    return node ? resolveLevelId(node, sceneNodes) === selectedLevelId : false
  })
}

const getCollectionAnchorNodeIds = (
  collection: Collection,
  controls: RoomControlTile[],
  sceneNodes: Record<AnyNodeId, AnyNode>,
) => {
  const controlItemIds = controls.map((control) => control.linkedItemId ?? control.itemId)
  const fallbackItemIds = getCollectionItemNodes(collection, sceneNodes).map((node) => node.id)
  const preferredIds = collection.controlNodeId
    ? [collection.controlNodeId, ...controlItemIds, ...fallbackItemIds]
    : [...controlItemIds, ...fallbackItemIds]

  return Array.from(new Set(preferredIds)).filter((nodeId) => sceneNodes[nodeId]?.type === 'item')
}

const getResourceIdentityKeys = (resource: HomeAssistantResourceBinding | null | undefined) =>
  Array.from(
    new Set(
      [resource?.entityId, resource?.id].filter(
        (value): value is string => typeof value === 'string' && value.trim().length > 0,
      ),
    ),
  )

const getBindingGroupMemberEntityIds = (
  binding: HomeAssistantCollectionBinding | null | undefined,
) =>
  new Set(
    (binding?.resources ?? [])
      .filter(isSmartHomeGroupResource)
      .flatMap((resource) => resource.memberEntityIds ?? []),
  )

const getRelatedGroupMemberItemNodes = (
  collectionId: CollectionId,
  memberEntityIds: Set<string>,
  collections: Record<CollectionId, Collection>,
  bindings: HomeAssistantCollectionBindingMap,
  sceneNodes: Record<AnyNodeId, AnyNode>,
) => {
  const nodesById = new Map<AnyNodeId, ItemNode>()

  for (const binding of Object.values(bindings)) {
    const collection = collections[binding.collectionId]
    if (!collection) {
      continue
    }

    const hasMatchingMemberResource = binding.resources.some(
      (resource) =>
        isSmartHomeDeviceComponentResource(resource) &&
        getResourceIdentityKeys(resource).some((key) => memberEntityIds.has(key)),
    )

    if (!hasMatchingMemberResource && binding.collectionId !== collectionId) {
      continue
    }

    for (const node of getCollectionAnchorItemNodes(collection, sceneNodes)) {
      nodesById.set(node.id, node)
    }
  }

  return Array.from(nodesById.values())
}

const getResourceLinkedItemNode = (
  resource: HomeAssistantResourceBinding,
  collectionId: CollectionId,
  collections: Record<CollectionId, Collection>,
  bindings: HomeAssistantCollectionBindingMap,
  sceneNodes: Record<AnyNodeId, AnyNode>,
) => {
  const identityKeys = new Set(getResourceIdentityKeys(resource))
  if (identityKeys.size === 0) {
    return null
  }

  for (const binding of Object.values(bindings)) {
    if (binding.collectionId === collectionId) {
      continue
    }

    const collection = collections[binding.collectionId]
    if (!collection) {
      continue
    }

    const hasMatchingResource = binding.resources.some(
      (candidate) =>
        isSmartHomeDeviceComponentResource(candidate) &&
        getResourceIdentityKeys(candidate).some((key) => identityKeys.has(key)),
    )
    if (!hasMatchingResource) {
      continue
    }

    const anchorNode = getCollectionAnchorItemNodes(collection, sceneNodes)[0]
    if (anchorNode) {
      return anchorNode
    }
  }

  return null
}

const getItemFootprintCenterWorldPosition = (items: ItemNode[]) => {
  if (items.length === 0) {
    return null
  }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY

  for (const item of items) {
    const [width, , depth] = item.asset.dimensions
    const [scaleX, , scaleZ] = item.scale
    const halfWidth = Math.abs(width * scaleX) / 2
    const halfDepth = Math.abs(depth * scaleZ) / 2
    minX = Math.min(minX, item.position[0] - halfWidth)
    maxX = Math.max(maxX, item.position[0] + halfWidth)
    minZ = Math.min(minZ, item.position[2] - halfDepth)
    maxZ = Math.max(maxZ, item.position[2] + halfDepth)
  }

  if (![minX, maxX, minZ, maxZ].every(Number.isFinite)) {
    return null
  }

  return {
    x: (minX + maxX) / 2,
    y: 0,
    z: (minZ + maxZ) / 2,
  }
}

const getCollectionRelatedGroupWorldPosition = (
  collection: Collection,
  binding: HomeAssistantCollectionBinding | null | undefined,
  collections: Record<CollectionId, Collection>,
  bindings: HomeAssistantCollectionBindingMap,
  sceneNodes: Record<AnyNodeId, AnyNode>,
) => {
  if (
    !bindingHasGroupResource(binding) ||
    binding?.presentation?.rtsWorldPosition ||
    binding?.presentation?.rtsScreenPosition
  ) {
    return null
  }

  const memberEntityIds = getBindingGroupMemberEntityIds(binding)
  if (memberEntityIds.size === 0) {
    return null
  }

  const relatedItemNodes = getRelatedGroupMemberItemNodes(
    collection.id,
    memberEntityIds,
    collections,
    bindings,
    sceneNodes,
  )

  return getItemFootprintCenterWorldPosition(relatedItemNodes)
}

const getResourceItemKind = (
  resource: HomeAssistantResourceBinding | null | undefined,
  fallbackLabel: string,
) => {
  const domain = resource?.entityId?.split('.')[0] ?? null

  if (domain === 'media_player') {
    return 'tv'
  }
  if (domain && domain !== 'group') {
    return domain
  }

  return fallbackLabel.toLowerCase().includes('fan')
    ? 'fan'
    : fallbackLabel.toLowerCase().includes('light')
      ? 'light'
      : 'item'
}

const isSliderControl = (control: Control): control is Extract<Control, { kind: 'slider' }> =>
  control.kind === 'slider'

const getPrimaryRoomControl = (controls: Control[]) => {
  if (controls.length === 0) {
    return null
  }

  const preferredIndex = controls.findIndex((control) => control.kind === 'toggle')
  const controlIndex = preferredIndex >= 0 ? preferredIndex : 0
  const control = controls[controlIndex]
  const intensityControlIndex = controls.findIndex(
    (candidate, index) =>
      isSliderControl(candidate) && (control?.kind === 'toggle' || index === controlIndex),
  )
  const intensityControl =
    intensityControlIndex >= 0
      ? (controls[intensityControlIndex] as Extract<Control, { kind: 'slider' }>)
      : null

  return control
    ? {
        control,
        controlIndex,
        intensityControl,
        intensityControlIndex: intensityControlIndex >= 0 ? intensityControlIndex : null,
      }
    : null
}

const getDirectActionMode = (
  binding: HomeAssistantCollectionBinding | null | undefined,
  control: Control,
  intensityControl: Extract<Control, { kind: 'slider' }> | null,
) => {
  const capabilities = getHomeAssistantBindingCapabilities(binding)
  if (isHomeAssistantTriggerBinding(binding)) {
    return 'trigger' as const
  }
  if (control.kind === 'toggle' && !intensityControl && !capabilities.has('brightness')) {
    return 'toggle' as const
  }
  return null
}

const buildCollectionRoomControlTiles = (
  collection: Collection,
  binding: HomeAssistantCollectionBinding | null | undefined,
  sceneNodes: Record<AnyNodeId, AnyNode>,
  collections: Record<CollectionId, Collection>,
  bindings: HomeAssistantCollectionBindingMap,
  hasPositionedPill = Boolean(
    binding?.presentation?.rtsWorldPosition || binding?.presentation?.rtsScreenPosition,
  ),
): RoomControlTile[] => {
  const collectionLabel = getHomeAssistantBindingDisplayLabel(binding, collection.name)
  const itemNodes = Array.from(
    new Map(
      getCollectionItemNodes(collection, sceneNodes).map((node) => [node.id, node] as const),
    ).values(),
  )
  const fallbackControlNode =
    collection.controlNodeId && sceneNodes[collection.controlNodeId]?.type === 'item'
      ? (sceneNodes[collection.controlNodeId] as ItemNode)
      : null
  const controlSourceNodes =
    itemNodes.length > 0 ? itemNodes : fallbackControlNode ? [fallbackControlNode] : []

  const controlResources = getSmartHomeBindingControlResources(binding?.resources ?? [])
  if (
    hasPositionedPill &&
    (controlSourceNodes.length === 0 ||
      (bindingHasGroupResource(binding) && controlResources.length > controlSourceNodes.length))
  ) {
    return controlResources.map((resource, index) => {
      const disabled = !isSmartHomeControllableEntityResource(resource)
      const syntheticIntensityControl = getResourceSyntheticIntensityControl(resource)
      const linkedItemNode = getResourceLinkedItemNode(
        resource,
        collection.id,
        collections,
        bindings,
        sceneNodes,
      )
      const control = isHomeAssistantTriggerBinding(binding)
        ? createCollectionFallbackControl('Run')
        : createCollectionFallbackControl('Toggle')
      const tileId = getSmartHomeRoomControlTileId(collection.id, resource.id)
      const legacyTileId = getLegacySmartHomeRoomControlTileId(collection.id, resource.id)

      return {
        canDetachFromRoom: bindingHasGroupResource(binding),
        collectionId: collection.id,
        collectionLabel,
        control,
        controlIndex: 0,
        directActionMode: getDirectActionMode(binding, control, syntheticIntensityControl),
        disabled,
        id: tileId,
        intensityControl: syntheticIntensityControl,
        intensityControlIndex: syntheticIntensityControl ? 1 : null,
        itemId: tileId as AnyNodeId,
        itemKind: getResourceItemKind(resource, collectionLabel),
        itemName: resource.label ?? linkedItemNode?.asset.name?.trim() ?? collectionLabel,
        legacyIds:
          legacyTileId === tileId
            ? [`${tileId}:${index}`]
            : [legacyTileId, `${legacyTileId}:${index}`],
        linkedItemId: linkedItemNode?.id,
        resourceId: resource.id,
      }
    })
  }

  const deviceResources = getBindingDeviceComponentResources(binding)
  const resourceByLinkedItemId = new Map<AnyNodeId, HomeAssistantResourceBinding>()

  for (const resource of deviceResources) {
    const linkedItemNode = getResourceLinkedItemNode(
      resource,
      collection.id,
      collections,
      bindings,
      sceneNodes,
    )
    if (linkedItemNode) {
      resourceByLinkedItemId.set(linkedItemNode.id, resource)
    }
  }

  const primaryResource = deviceResources[0] ?? null
  return controlSourceNodes.map((itemNode, index) => {
    const itemResource =
      resourceByLinkedItemId.get(itemNode.id) ??
      (deviceResources.length === controlSourceNodes.length ? deviceResources[index] : null) ??
      primaryResource
    const disabled = !isSmartHomeDeviceComponentResource(itemResource)
    const controls = itemNode.asset.interactive?.controls ?? []
    const selectedControl = getPrimaryRoomControl(controls)
    const syntheticIntensityControl =
      selectedControl?.intensityControl ?? getResourceSyntheticIntensityControl(itemResource)
    const control = isHomeAssistantTriggerBinding(binding)
      ? createCollectionFallbackControl('Run')
      : (selectedControl?.control ?? createCollectionFallbackControl('Toggle'))
    const controlIndex = selectedControl?.controlIndex ?? 0
    const resourceTileId = itemResource
      ? getSmartHomeRoomControlTileId(collection.id, itemResource.id)
      : null
    const legacyResourceTileId = itemResource
      ? getLegacySmartHomeRoomControlTileId(collection.id, itemResource.id)
      : null

    return {
      canDetachFromRoom: bindingHasGroupResource(binding),
      collectionId: collection.id,
      collectionLabel,
      control,
      controlIndex,
      directActionMode: getDirectActionMode(binding, control, syntheticIntensityControl),
      disabled,
      id: `${collection.id}:${itemNode.id}:${controlIndex}`,
      intensityControl: syntheticIntensityControl ?? null,
      intensityControlIndex:
        selectedControl?.intensityControlIndex ??
        (syntheticIntensityControl ? controls.length : null),
      itemId: itemNode.id,
      itemKind: getResourceItemKind(
        itemResource,
        itemNode.asset.name?.trim() || collectionLabel || 'item',
      ),
      itemName: itemResource?.label ?? itemNode.asset.name?.trim() ?? collectionLabel ?? 'Item',
      legacyIds: resourceTileId
        ? [
            resourceTileId,
            `${resourceTileId}:${index}`,
            ...(legacyResourceTileId && legacyResourceTileId !== resourceTileId
              ? [legacyResourceTileId, `${legacyResourceTileId}:${index}`]
              : []),
          ]
        : undefined,
      resourceId: itemResource?.id,
    }
  })
}

const getCollectionRangeCapability = (
  binding: HomeAssistantCollectionBinding | null | undefined,
  member: RoomControlTile,
): Extract<
  HomeAssistantCollectionCapability,
  'brightness' | 'speed' | 'temperature' | 'volume'
> | null => {
  if (member.control.kind === 'temperature') {
    return 'temperature'
  }

  const capabilities = getHomeAssistantBindingCapabilities(binding)
  if (capabilities.has('brightness') || member.itemKind === 'light') {
    return 'brightness'
  }
  if (capabilities.has('speed') || member.itemKind === 'fan') {
    return 'speed'
  }
  if (capabilities.has('volume') || member.itemKind === 'speaker' || member.itemKind === 'tv') {
    return 'volume'
  }
  return capabilities.has('temperature') ? 'temperature' : null
}

export const buildCollectionActionRequest = (
  binding: HomeAssistantCollectionBinding | null | undefined,
  member: RoomControlTile,
  nextValue: ControlValue,
  source: RoomControlChangeSource,
): HomeAssistantActionRequest | null => {
  if (!binding) {
    return null
  }

  if (isHomeAssistantTriggerBinding(binding)) {
    return { kind: 'trigger' }
  }

  if (source === 'intensity' && member.intensityControl) {
    const capability = getCollectionRangeCapability(binding, {
      ...member,
      control: member.intensityControl,
    })
    if (!capability) {
      return null
    }

    return {
      capability,
      kind: 'range',
      value: Number(nextValue),
    }
  }

  if (member.control.kind === 'toggle') {
    return {
      kind: 'toggle',
      value: Boolean(nextValue),
    }
  }

  const capability = getCollectionRangeCapability(binding, member)
  if (!capability) {
    return null
  }

  return {
    capability,
    kind: 'range',
    value: Number(nextValue),
  }
}

export function buildHomeAssistantRoomOverlayNodes({
  bindings,
  collections,
  sceneNodes,
  selectedLevelId,
  visibility,
}: RoomOverlayNodeBuildInput): RoomOverlayNode[] {
  return Object.values(collections)
    .filter((collection) => {
      const binding = bindings[collection.id]
      const derivedWorldPosition = getCollectionRelatedGroupWorldPosition(
        collection,
        binding,
        collections,
        bindings,
        sceneNodes,
      )
      return (
        collectionHasBoundResources(collection, bindings) &&
        isHomeAssistantOverlayBindingVisible(binding, visibility) &&
        (isCollectionVisibleOnSelectedLevel(collection, sceneNodes, selectedLevelId) ||
          Boolean(
            binding?.presentation?.rtsWorldPosition ||
              binding?.presentation?.rtsScreenPosition ||
              derivedWorldPosition,
          ))
      )
    })
    .sort((left, right) => compareCollectionsForRoom(left, right, bindings))
    .map((collection) => {
      const binding = bindings[collection.id]
      const iconOnly = isIconOnlyDeviceCollection(collection, binding)
      const derivedWorldPosition = getCollectionRelatedGroupWorldPosition(
        collection,
        binding,
        collections,
        bindings,
        sceneNodes,
      )
      const worldPosition =
        binding?.presentation?.rtsWorldPosition ??
        (binding?.presentation?.rtsScreenPosition
          ? undefined
          : (derivedWorldPosition ?? undefined))
      const roomControls = buildCollectionRoomControlTiles(
        collection,
        binding,
        sceneNodes,
        collections,
        bindings,
        Boolean(worldPosition || binding?.presentation?.rtsScreenPosition),
      )
      const defaultGroups = roomControls.length > 0 ? [roomControls.map((control) => control.id)] : []
      const presentationGroups = normalizeRoomControlGroupList(
        getSmartHomeRoomControlTileGroups({
          collectionId: collection.id,
          presentation: binding?.presentation,
        }),
      )
      const storedGroups = selectRoomControlGroupSource(
        roomControls,
        presentationGroups,
        defaultGroups,
      )
      const controlGroups =
        getSmartHomeRoomControlMode(binding?.presentation) === 'user-managed'
          ? presentationGroups
          : storedGroups
      return {
        anchorNodeIds: getCollectionAnchorNodeIds(collection, roomControls, sceneNodes),
        controlGroups: buildRoomControlGroups(roomControls, controlGroups),
        iconOnly,
        id: collection.id,
        roomName: getCollectionDisplayName(collection, bindings),
        screenPosition: binding?.presentation?.rtsScreenPosition,
        totalSlotCount: roomControls.length,
        worldPosition,
      }
    })
    .filter(
      (overlayNode) =>
        overlayNode.anchorNodeIds.length > 0 ||
        overlayNode.totalSlotCount > 0 ||
        Boolean(overlayNode.worldPosition || overlayNode.screenPosition),
    )
}
