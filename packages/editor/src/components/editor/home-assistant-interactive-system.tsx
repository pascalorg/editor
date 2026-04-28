'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type Collection,
  type CollectionId,
  type Control,
  type ControlValue,
  getHomeAssistantBindingCapabilities,
  getHomeAssistantBindingDisplayLabel,
  getHomeAssistantBindingNodeMap,
  type HomeAssistantActionRequest,
  type HomeAssistantCollectionBinding,
  type HomeAssistantCollectionBindingMap,
  type HomeAssistantCollectionCapability,
  type HomeAssistantResourceBinding,
  hasHomeAssistantBinding,
  type ItemNode,
  isHomeAssistantTriggerBinding,
  normalizeHomeAssistantCollectionBinding,
  resolveLevelId,
  useInteractive,
  useScene,
} from '@pascal-app/core'
import {
  buildRoomControlGroups,
  InteractiveSystem,
  normalizeRoomControlGroupList,
  type RoomControlChange,
  type RoomControlChangeSource,
  type RoomControlTile,
  type RoomOverlayNode,
  selectRoomControlGroupSource,
  useViewer,
} from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  buildSmartHomeRoomControlCompositionFromTileGroups,
  cloneSmartHomeResourceBinding,
  getLegacySmartHomeRoomControlTileId,
  getSmartHomeBindingControlResources,
  getSmartHomeExcludedResourceIds,
  getSmartHomeRoomControlTileGroups,
  getSmartHomeRoomControlTileId,
  isSmartHomeBindingPresentationHidden,
  isSmartHomeControllableEntityResource,
  isSmartHomeDeviceComponentResource,
  isSmartHomeGroupResource,
} from '../../lib/smart-home-composition'
import useEditor, { type SmartHomeOverlayVisibility } from '../../store/use-editor'

const SCENE_IMMEDIATE_SAVE_EVENT = 'pascal:scene-immediate-save'

export type HomeAssistantDeviceActionDispatch = {
  binding: HomeAssistantCollectionBinding
  collectionName: string
  request: HomeAssistantActionRequest
}

type HomeAssistantInteractiveSystemProps = {
  onHomeAssistantDeviceAction?: (payload: HomeAssistantDeviceActionDispatch) => void | Promise<void>
}

function requestSceneImmediateSave() {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new Event(SCENE_IMMEDIATE_SAVE_EVENT))
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

const bindingHasGroupResource = (binding: HomeAssistantCollectionBinding | null | undefined) =>
  Boolean(binding?.resources.some((resource) => isSmartHomeGroupResource(resource)))

const getBindingDeviceComponentResources = (
  binding: HomeAssistantCollectionBinding | null | undefined,
) => binding?.resources.filter(isSmartHomeDeviceComponentResource) ?? []

const getActionBindingForMember = (
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

const getCollectionDisplayName = (
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

const buildCollectionActionRequest = (
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

export function HomeAssistantInteractiveSystem({
  onHomeAssistantDeviceAction,
}: HomeAssistantInteractiveSystemProps = {}) {
  const selectedLevelId = useViewer((state) => state.selection.levelId)
  const sceneNodes = useScene((state) => state.nodes)
  const sceneCollections = useScene((state) => state.collections ?? {})
  const updateNode = useScene((state) => state.updateNode)
  const setControlValue = useInteractive((state) => state.setControlValue)
  const smartHomeOverlayVisibility = useEditor((state) => state.smartHomeOverlayVisibility)
  const pendingCollectionActionTimeoutsRef = useRef<Record<string, number>>({})

  const homeAssistantBindings = useMemo(
    () => getHomeAssistantBindingNodeMap(sceneNodes),
    [sceneNodes],
  )

  const roomOverlayNodes = useMemo<RoomOverlayNode[]>(
    () =>
      Object.values(sceneCollections)
        .filter((collection) => {
          const binding = homeAssistantBindings[collection.id]
          const derivedWorldPosition = getCollectionRelatedGroupWorldPosition(
            collection,
            binding,
            sceneCollections,
            homeAssistantBindings,
            sceneNodes,
          )
          return (
            collectionHasBoundResources(collection, homeAssistantBindings) &&
            isHomeAssistantOverlayBindingVisible(binding, smartHomeOverlayVisibility) &&
            (isCollectionVisibleOnSelectedLevel(collection, sceneNodes, selectedLevelId) ||
              Boolean(
                binding?.presentation?.rtsWorldPosition ||
                  binding?.presentation?.rtsScreenPosition ||
                  derivedWorldPosition,
              ))
          )
        })
        .sort((left, right) => compareCollectionsForRoom(left, right, homeAssistantBindings))
        .map((collection) => {
          const binding = homeAssistantBindings[collection.id]
          const iconOnly = isIconOnlyDeviceCollection(collection, binding)
          const derivedWorldPosition = getCollectionRelatedGroupWorldPosition(
            collection,
            binding,
            sceneCollections,
            homeAssistantBindings,
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
            sceneCollections,
            homeAssistantBindings,
            Boolean(worldPosition || binding?.presentation?.rtsScreenPosition),
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
          return {
            anchorNodeIds: getCollectionAnchorNodeIds(collection, roomControls, sceneNodes),
            controlGroups: buildRoomControlGroups(roomControls, storedGroups),
            iconOnly,
            id: collection.id,
            roomName: getCollectionDisplayName(collection, homeAssistantBindings),
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
        ),
    [
      homeAssistantBindings,
      sceneCollections,
      sceneNodes,
      selectedLevelId,
      smartHomeOverlayVisibility,
    ],
  )

  useEffect(
    () => () => {
      if (typeof window === 'undefined') {
        return
      }
      for (const timeoutId of Object.values(pendingCollectionActionTimeoutsRef.current)) {
        window.clearTimeout(timeoutId)
      }
      pendingCollectionActionTimeoutsRef.current = {}
    },
    [],
  )

  const applyRoomGroupingToCollection = useCallback(
    (collectionId: string, nextGroups: string[][]) => {
      const normalizedGroups = normalizeRoomControlGroupList(nextGroups)
      const bindingNode = homeAssistantBindings[collectionId as CollectionId]
      if (!bindingNode) {
        return
      }

      updateNode(bindingNode.id, {
        presentation: {
          ...(bindingNode.presentation ?? {}),
          rtsRoomControls: buildSmartHomeRoomControlCompositionFromTileGroups({
            collectionId,
            excludedResourceIds: getSmartHomeExcludedResourceIds(bindingNode.presentation),
            groups: normalizedGroups,
            resources: bindingNode.resources,
          }),
          rtsExcludedResourceIds: undefined,
          rtsGroups: undefined,
        },
      } as Partial<AnyNode>)
      requestSceneImmediateSave()
    },
    [homeAssistantBindings, updateNode],
  )

  const copyDeviceResourceToGroup = useCallback(
    (sourceCollectionId: CollectionId, targetCollectionId: CollectionId) => {
      if (sourceCollectionId === targetCollectionId) {
        return
      }

      const sourceBinding = homeAssistantBindings[sourceCollectionId]
      const targetBindingNode = homeAssistantBindings[targetCollectionId]
      if (!(sourceBinding && targetBindingNode && bindingHasGroupResource(targetBindingNode))) {
        return
      }

      const sourceResource = sourceBinding.resources.find(isSmartHomeDeviceComponentResource)
      if (!sourceResource) {
        return
      }

      if (targetBindingNode.resources.some((resource) => resource.id === sourceResource.id)) {
        return
      }

      const existingGroups = normalizeRoomControlGroupList(
        getSmartHomeRoomControlTileGroups({
          collectionId: targetCollectionId,
          presentation: targetBindingNode.presentation,
        }),
      )
      const targetDeviceResources = targetBindingNode.resources.filter(
        isSmartHomeDeviceComponentResource,
      )
      const existingCombinedGroup =
        targetDeviceResources.length > 0
          ? targetDeviceResources.map((resource) =>
              getSmartHomeRoomControlTileId(targetCollectionId, resource.id),
            )
          : []
      const baseGroups =
        existingGroups.length > 0
          ? existingGroups
          : existingCombinedGroup.length > 0
            ? [existingCombinedGroup]
            : []
      const copiedMemberId = getSmartHomeRoomControlTileId(targetCollectionId, sourceResource.id)
      const nextRtsGroups = [
        ...baseGroups
          .map((group) => group.filter((memberId) => memberId !== copiedMemberId))
          .filter((group) => group.length > 0),
        [copiedMemberId],
      ]
      const currentPrimaryResource = targetBindingNode.resources.find(
        (resource) => resource.id === targetBindingNode.primaryResourceId,
      )
      const nextBinding = normalizeHomeAssistantCollectionBinding({
        aggregation: 'all',
        collectionId: targetBindingNode.collectionId,
        presentation: {
          ...(targetBindingNode.presentation ?? {}),
          rtsRoomControls: buildSmartHomeRoomControlCompositionFromTileGroups({
            collectionId: targetCollectionId,
            excludedResourceIds: getSmartHomeExcludedResourceIds(
              targetBindingNode.presentation,
            ).filter((resourceId) => resourceId !== sourceResource.id),
            groups: nextRtsGroups,
            resources: [...targetBindingNode.resources, sourceResource],
          }),
          rtsExcludedResourceIds: undefined,
          rtsGroups: undefined,
        },
        primaryResourceId: isSmartHomeDeviceComponentResource(currentPrimaryResource)
          ? (currentPrimaryResource?.id ?? sourceResource.id)
          : sourceResource.id,
        resources: [...targetBindingNode.resources, cloneSmartHomeResourceBinding(sourceResource)],
      })

      if (!nextBinding) {
        return
      }

      updateNode(targetBindingNode.id, nextBinding as Partial<AnyNode>)
      requestSceneImmediateSave()
    },
    [homeAssistantBindings, updateNode],
  )

  const removeDeviceResourceFromGroup = useCallback(
    (member: RoomControlTile) => {
      if (!member.resourceId) {
        return
      }

      const currentBindings = getHomeAssistantBindingNodeMap(useScene.getState().nodes)
      const bindingNode = currentBindings[member.collectionId]
      if (!(bindingNode && bindingHasGroupResource(bindingNode))) {
        return
      }

      const removedResource = bindingNode.resources.find(
        (resource) => resource.id === member.resourceId,
      )
      if (!removedResource || !isSmartHomeDeviceComponentResource(removedResource)) {
        return
      }

      const nextResources = bindingNode.resources.filter(
        (resource) => resource.id !== removedResource.id,
      )
      const nextDeviceResources = nextResources.filter(isSmartHomeDeviceComponentResource)
      const nextPrimaryResourceId =
        bindingNode.primaryResourceId === removedResource.id
          ? (nextDeviceResources[0]?.id ?? nextResources[0]?.id ?? null)
          : (bindingNode.primaryResourceId ??
            nextDeviceResources[0]?.id ??
            nextResources[0]?.id ??
            null)
      const nextExcludedResourceIds = Array.from(
        new Set([...getSmartHomeExcludedResourceIds(bindingNode.presentation), removedResource.id]),
      )
      const nextBinding = normalizeHomeAssistantCollectionBinding({
        aggregation: nextResources.some((resource) => resource.kind !== 'entity')
          ? 'trigger_only'
          : nextDeviceResources.length > 1
            ? 'all'
            : 'single',
        collectionId: bindingNode.collectionId,
        presentation: {
          ...(bindingNode.presentation ?? {}),
          rtsRoomControls: buildSmartHomeRoomControlCompositionFromTileGroups({
            collectionId: bindingNode.collectionId,
            excludedResourceIds: nextExcludedResourceIds,
            groups: getSmartHomeRoomControlTileGroups({
              collectionId: bindingNode.collectionId,
              presentation: bindingNode.presentation,
            }).map((group) =>
              group.filter(
                (memberId) =>
                  memberId !==
                  getSmartHomeRoomControlTileId(bindingNode.collectionId, removedResource.id),
              ),
            ),
            resources: nextResources,
          }),
          rtsExcludedResourceIds: undefined,
          rtsGroups: undefined,
        },
        primaryResourceId: nextPrimaryResourceId,
        resources: nextResources,
      })

      if (!nextBinding) {
        return
      }

      updateNode(bindingNode.id, nextBinding as Partial<AnyNode>)
      requestSceneImmediateSave()
    },
    [updateNode],
  )

  const handleRoomControlChange = useCallback(
    ({ member, nextValue, source }: RoomControlChange) => {
      if (member.disabled) {
        return
      }

      const collection = sceneCollections[member.collectionId]
      const binding = homeAssistantBindings[member.collectionId]
      if (!(collection && binding) || typeof window === 'undefined') {
        return
      }

      const actionBinding = getActionBindingForMember(binding, member)
      if (!actionBinding) {
        return
      }

      const request = buildCollectionActionRequest(actionBinding, member, nextValue, source)
      if (!request) {
        return
      }

      const visualItemId = member.linkedItemId ?? member.itemId
      if (
        source === 'primary' &&
        member.itemKind === 'tv' &&
        sceneNodes[visualItemId]?.type === 'item'
      ) {
        const viewer = useViewer.getState()
        if (request.kind === 'toggle') {
          if (request.value) {
            viewer.triggerItemEffect(visualItemId)
          } else {
            viewer.clearItemEffect(visualItemId)
          }
        } else if (request.kind === 'trigger') {
          viewer.triggerItemEffect(visualItemId)
        }
      }

      const existingTimeoutId = pendingCollectionActionTimeoutsRef.current[member.collectionId]
      if (existingTimeoutId) {
        window.clearTimeout(existingTimeoutId)
      }

      const delayMs = request.kind === 'range' ? 120 : 0
      pendingCollectionActionTimeoutsRef.current[member.collectionId] = window.setTimeout(() => {
        if (onHomeAssistantDeviceAction) {
          void Promise.resolve(
            onHomeAssistantDeviceAction({
              binding: actionBinding,
              collectionName: getCollectionDisplayName(collection, homeAssistantBindings),
              request,
            }),
          ).catch(() => {})
        }
        if (request.kind === 'trigger' && member.control.kind === 'toggle') {
          window.setTimeout(() => {
            setControlValue(member.itemId, member.controlIndex, false)
            if (member.linkedItemId && member.linkedItemId !== member.itemId) {
              setControlValue(member.linkedItemId, member.controlIndex, false)
            }
          }, 220)
        }
        delete pendingCollectionActionTimeoutsRef.current[member.collectionId]
      }, delayMs)
    },
    [
      homeAssistantBindings,
      onHomeAssistantDeviceAction,
      sceneCollections,
      sceneNodes,
      setControlValue,
    ],
  )

  return (
    <InteractiveSystem
      onApplyRoomGrouping={applyRoomGroupingToCollection}
      onCopyRoomControlToRoom={copyDeviceResourceToGroup}
      onRemoveRoomControlFromRoom={removeDeviceResourceFromGroup}
      onRoomControlChange={handleRoomControlChange}
      roomOverlayNodes={roomOverlayNodes}
    />
  )
}
