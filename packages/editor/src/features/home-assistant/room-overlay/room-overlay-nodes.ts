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
  selectedLevelId: AnyNodeId | null = null,
) =>
  Boolean(
    binding &&
      !bindingHasGroupResource(binding) &&
      (selectedLevelId ||
        (!binding.presentation?.rtsWorldPosition && !binding.presentation?.rtsScreenPosition)) &&
      collection.nodeIds.length === 1 &&
      getBindingDeviceComponentResources(binding).length === 1,
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

const getCollectionLinkedItemNodes = (
  collection: Collection,
  sceneNodes: Record<AnyNodeId, AnyNode>,
) => getCollectionItemNodes(collection, sceneNodes)

const itemIsOnSelectedLevel = (
  item: ItemNode,
  sceneNodes: Record<AnyNodeId, AnyNode>,
  selectedLevelId: AnyNodeId | null,
) => !selectedLevelId || resolveLevelId(item, sceneNodes) === selectedLevelId

const isCollectionVisibleOnSelectedLevel = (
  collection: Collection,
  binding: HomeAssistantCollectionBinding | null | undefined,
  sceneNodes: Record<AnyNodeId, AnyNode>,
  selectedLevelId: AnyNodeId | null,
) => {
  if (!selectedLevelId) {
    return true
  }

  if (getBindingDeviceComponentResources(binding).length > 0) {
    return getCollectionItemNodes(collection, sceneNodes).some((item) =>
      itemIsOnSelectedLevel(item, sceneNodes, selectedLevelId),
    )
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
  selectedLevelId: AnyNodeId | null = null,
) => {
  const controlItemIds = controls.map((control) => control.linkedItemId ?? control.itemId)
  const fallbackItemIds = getCollectionItemNodes(collection, sceneNodes)
    .filter((item) => itemIsOnSelectedLevel(item, sceneNodes, selectedLevelId))
    .map((node) => node.id)
  const preferredIds = [...controlItemIds, ...fallbackItemIds]

  return Array.from(new Set(preferredIds)).filter((nodeId) => {
    const node = sceneNodes[nodeId]
    return node?.type === 'item' && itemIsOnSelectedLevel(node, sceneNodes, selectedLevelId)
  })
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

const getBindingRelatedResourceIdentityKeys = (
  binding: HomeAssistantCollectionBinding | null | undefined,
) => {
  const identityKeys = getBindingGroupMemberEntityIds(binding)
  for (const resource of binding?.resources ?? []) {
    if (!isSmartHomeDeviceComponentResource(resource)) {
      continue
    }
    for (const key of getResourceIdentityKeys(resource)) {
      identityKeys.add(key)
    }
  }
  return identityKeys
}

const getRelatedGroupMemberItemNodes = (
  collectionId: CollectionId,
  memberEntityIds: Set<string>,
  collections: Record<CollectionId, Collection>,
  bindings: HomeAssistantCollectionBindingMap,
  sceneNodes: Record<AnyNodeId, AnyNode>,
  selectedLevelId: AnyNodeId | null = null,
) => {
  const nodesById = new Map<AnyNodeId, ItemNode>()

  for (const binding of Object.values(bindings)) {
    if (binding.collectionId === collectionId) {
      continue
    }

    const collection = collections[binding.collectionId]
    if (!collection) {
      continue
    }

    const hasMatchingMemberResource = binding.resources.some(
      (resource) =>
        isSmartHomeDeviceComponentResource(resource) &&
        getResourceIdentityKeys(resource).some((key) => memberEntityIds.has(key)),
    )

    if (!hasMatchingMemberResource) {
      continue
    }

    for (const node of getCollectionLinkedItemNodes(collection, sceneNodes).filter((item) =>
      itemIsOnSelectedLevel(item, sceneNodes, selectedLevelId),
    )) {
      nodesById.set(node.id, node)
    }
  }

  return Array.from(nodesById.values())
}

const getResourceLinkedItemNodes = (
  resource: HomeAssistantResourceBinding,
  collectionId: CollectionId,
  collections: Record<CollectionId, Collection>,
  bindings: HomeAssistantCollectionBindingMap,
  sceneNodes: Record<AnyNodeId, AnyNode>,
  selectedLevelId: AnyNodeId | null = null,
) => {
  const identityKeys = new Set(getResourceIdentityKeys(resource))
  if (identityKeys.size === 0) {
    return []
  }

  const linkedItemNodes: ItemNode[] = []
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

    for (const anchorNode of getCollectionLinkedItemNodes(collection, sceneNodes).filter((item) =>
      itemIsOnSelectedLevel(item, sceneNodes, selectedLevelId),
    )) {
      linkedItemNodes.push(anchorNode)
    }
  }

  return linkedItemNodes
}

const getResourceLinkedItemNode = (
  resource: HomeAssistantResourceBinding,
  collectionId: CollectionId,
  collections: Record<CollectionId, Collection>,
  bindings: HomeAssistantCollectionBindingMap,
  sceneNodes: Record<AnyNodeId, AnyNode>,
  selectedLevelId: AnyNodeId | null = null,
) =>
  getResourceLinkedItemNodes(
    resource,
    collectionId,
    collections,
    bindings,
    sceneNodes,
    selectedLevelId,
  )[0] ?? null

const resourceHasLevelLocalLinkedItem = (
  resource: HomeAssistantResourceBinding,
  collectionId: CollectionId,
  collections: Record<CollectionId, Collection>,
  bindings: HomeAssistantCollectionBindingMap,
  sceneNodes: Record<AnyNodeId, AnyNode>,
  selectedLevelId: AnyNodeId | null,
) => {
  if (!selectedLevelId) {
    return true
  }

  if (isSmartHomeGroupResource(resource)) {
    const memberEntityIds = new Set(resource.memberEntityIds ?? [])
    return (
      memberEntityIds.size > 0 &&
      getRelatedGroupMemberItemNodes(
        collectionId,
        memberEntityIds,
        collections,
        bindings,
        sceneNodes,
        selectedLevelId,
      ).length > 0
    )
  }

  return (
    getResourceLinkedItemNodes(
      resource,
      collectionId,
      collections,
      bindings,
      sceneNodes,
      selectedLevelId,
    ).length > 0
  )
}

const getItemCenterWorldPosition = (items: ItemNode[]) => {
  if (items.length === 0) {
    return null
  }

  let totalX = 0
  let totalZ = 0
  let count = 0

  for (const item of items) {
    const [x, , z] = item.position
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      continue
    }
    totalX += x
    totalZ += z
    count += 1
  }

  if (count === 0) {
    return null
  }

  return {
    x: totalX / count,
    y: 0,
    z: totalZ / count,
  }
}

const getCollectionRelatedGroupWorldPosition = (
  collection: Collection,
  binding: HomeAssistantCollectionBinding | null | undefined,
  collections: Record<CollectionId, Collection>,
  bindings: HomeAssistantCollectionBindingMap,
  sceneNodes: Record<AnyNodeId, AnyNode>,
  selectedLevelId: AnyNodeId | null = null,
) => {
  if (
    !binding?.resources.length ||
    (!selectedLevelId &&
      (binding?.presentation?.rtsWorldPosition || binding?.presentation?.rtsScreenPosition))
  ) {
    return null
  }

  const memberEntityIds = getBindingRelatedResourceIdentityKeys(binding)
  if (memberEntityIds.size === 0) {
    return null
  }

  const relatedItemNodes = getRelatedGroupMemberItemNodes(
    collection.id,
    memberEntityIds,
    collections,
    bindings,
    sceneNodes,
    selectedLevelId,
  )

  return getItemCenterWorldPosition(relatedItemNodes)
}

const getCollectionSelectedLevelWorldPosition = (
  collection: Collection,
  binding: HomeAssistantCollectionBinding | null | undefined,
  collections: Record<CollectionId, Collection>,
  bindings: HomeAssistantCollectionBindingMap,
  sceneNodes: Record<AnyNodeId, AnyNode>,
  selectedLevelId: AnyNodeId | null,
) => {
  if (!selectedLevelId) {
    return null
  }

  if (bindingHasGroupResource(binding) || (binding?.resources.length ?? 0) > 1) {
    return getCollectionRelatedGroupWorldPosition(
      collection,
      binding,
      collections,
      bindings,
      sceneNodes,
      selectedLevelId,
    )
  }

  const directItemNodes = getCollectionItemNodes(collection, sceneNodes).filter((item) =>
    itemIsOnSelectedLevel(item, sceneNodes, selectedLevelId),
  )
  return getItemCenterWorldPosition(directItemNodes)
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
  selectedLevelId: AnyNodeId | null = null,
): RoomControlTile[] => {
  const collectionLabel = getHomeAssistantBindingDisplayLabel(binding, collection.name)
  const itemNodes = Array.from(
    new Map(
      getCollectionItemNodes(collection, sceneNodes)
        .filter((item) => itemIsOnSelectedLevel(item, sceneNodes, selectedLevelId))
        .map((node) => [node.id, node] as const),
    ).values(),
  )
  const fallbackControlNode =
    collection.controlNodeId &&
    sceneNodes[collection.controlNodeId]?.type === 'item' &&
    itemIsOnSelectedLevel(
      sceneNodes[collection.controlNodeId] as ItemNode,
      sceneNodes,
      selectedLevelId,
    )
      ? (sceneNodes[collection.controlNodeId] as ItemNode)
      : null
  const controlSourceNodes =
    itemNodes.length > 0 ? itemNodes : fallbackControlNode ? [fallbackControlNode] : []

  const controlResources = getSmartHomeBindingControlResources(binding?.resources ?? [])
  if (
    hasPositionedPill &&
    (controlSourceNodes.length === 0 ||
      ((bindingHasGroupResource(binding) || controlResources.length > 1) &&
        controlResources.length > controlSourceNodes.length))
  ) {
    return controlResources
      .filter((resource) =>
        resourceHasLevelLocalLinkedItem(
          resource,
          collection.id,
          collections,
          bindings,
          sceneNodes,
          selectedLevelId,
        ),
      )
      .map((resource, index) => {
        const disabled = !isSmartHomeControllableEntityResource(resource)
        const syntheticIntensityControl = getResourceSyntheticIntensityControl(resource)
        const linkedItemNode = getResourceLinkedItemNode(
          resource,
          collection.id,
          collections,
          bindings,
          sceneNodes,
          selectedLevelId,
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
      selectedLevelId,
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
      const derivedWorldPosition = selectedLevelId
        ? getCollectionSelectedLevelWorldPosition(
            collection,
            binding,
            collections,
            bindings,
            sceneNodes,
            selectedLevelId,
          )
        : getCollectionRelatedGroupWorldPosition(
            collection,
            binding,
            collections,
            bindings,
            sceneNodes,
          )
      return (
        collectionHasBoundResources(collection, bindings) &&
        isHomeAssistantOverlayBindingVisible(binding, visibility) &&
        (selectedLevelId
          ? isCollectionVisibleOnSelectedLevel(collection, binding, sceneNodes, selectedLevelId) ||
            Boolean(derivedWorldPosition)
          : isCollectionVisibleOnSelectedLevel(collection, binding, sceneNodes, selectedLevelId) ||
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
      const iconOnly = isIconOnlyDeviceCollection(collection, binding, selectedLevelId)
      const derivedWorldPosition = selectedLevelId
        ? getCollectionSelectedLevelWorldPosition(
            collection,
            binding,
            collections,
            bindings,
            sceneNodes,
            selectedLevelId,
          )
        : getCollectionRelatedGroupWorldPosition(
            collection,
            binding,
            collections,
            bindings,
            sceneNodes,
          )
      const worldPosition =
        iconOnly && selectedLevelId
          ? undefined
          : ((selectedLevelId ? derivedWorldPosition : null) ??
            (!selectedLevelId ? binding?.presentation?.rtsWorldPosition : undefined) ??
            (binding?.presentation?.rtsScreenPosition
              ? undefined
              : (derivedWorldPosition ?? undefined)))
      const roomControls = buildCollectionRoomControlTiles(
        collection,
        binding,
        sceneNodes,
        collections,
        bindings,
        Boolean(worldPosition || binding?.presentation?.rtsScreenPosition),
        selectedLevelId,
      )
      const defaultGroups =
        roomControls.length > 0 ? [roomControls.map((control) => control.id)] : []
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
        anchorNodeIds: getCollectionAnchorNodeIds(
          collection,
          roomControls,
          sceneNodes,
          selectedLevelId,
        ),
        controlGroups: buildRoomControlGroups(roomControls, controlGroups),
        iconOnly,
        id: collection.id,
        roomName: getCollectionDisplayName(collection, bindings),
        screenPosition: selectedLevelId ? undefined : binding?.presentation?.rtsScreenPosition,
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
