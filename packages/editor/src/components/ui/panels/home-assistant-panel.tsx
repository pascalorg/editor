'use client'

import { emitter } from '@pascal-app/core'
import type { AnyNode, AnyNodeId, Collection, CollectionId, ItemNode } from '@pascal-app/core'
import { normalizeCollection, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import {
  createHomeAssistantBindingNode,
  getHomeAssistantBindingNodeMap,
  normalizeHomeAssistantCollectionBinding,
  type HomeAssistantCollectionBinding,
  type HomeAssistantResourceBinding,
} from '@pascal-app/core/schema'
import {
  Lightbulb,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  Eye,
  EyeOff,
  Fan,
  Layers,
  Link2,
  LoaderCircle,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Tv,
  Unlink,
  Wifi,
  X,
} from 'lucide-react'
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import useEditor from '../../../store/use-editor'
import type { HomeAssistantImportedResource } from '../../../lib/home-assistant-collections'
import {
  bindResourceToCollectionBinding,
  buildCollectionBindingFromResource,
  isHiddenHomeAssistantGroupResourceId,
} from '../../../lib/home-assistant-collections'
import {
  cloneSmartHomeResourceBinding as cloneResourceBinding,
  buildSmartHomeRoomControlCompositionFromTileGroups,
  getSmartHomeExcludedResourceIds,
  getSmartHomeBindingControlResources as getBindingControlResources,
  getSmartHomeRoomControlTileGroups,
  getSmartHomeRoomGroupMemberResourceId as getRoomGroupMemberResourceId,
  hasSmartHomeGroupResource as bindingHasGroupResource,
  isSmartHomeBindingPresentationHidden,
  isSmartHomeDeviceComponentResource as isBindingDeviceResource,
  isSmartHomeGroupResource as isBindingGroupResource,
  mergeSmartHomeIncomingResourcesWithLocalDevices as mergeIncomingBindingResourcesWithLocalDevices,
  normalizeSmartHomeStringGroups,
  smartHomeRoomGroupMemberReferencesResource as roomGroupMemberReferencesResource,
} from '../../../lib/smart-home-composition'
import {
  getPresentationAfterResourceInclusion,
  getPresentationAfterResourceRemoval,
  homeAssistantBindingsAreEqual,
  homeAssistantNodePatchMatches,
  mergeHomeAssistantPresentation,
} from '../../../lib/home-assistant-binding-presentation'
import {
  resolveHomeAssistantGroundPoint,
  resolveHomeAssistantPlacementPreview,
  type HomeAssistantGroundPoint,
  type HomeAssistantPlacementPreview,
} from '../../../lib/home-assistant-placement-ground'
import { cn } from '../../../lib/utils'

type ProviderId = 'home-assistant'

type ActivePanel =
  | { kind: 'chooser' }
  | { kind: 'connect'; providerId: ProviderId }
  | { kind: 'config'; providerId: ProviderId }
  | null

type ImportSectionKey = 'actions' | 'devices' | 'groups'
type DeviceCategoryKey = 'fan' | 'light' | 'media_player' | 'other'

type ScreenPoint = {
  x: number
  y: number
}

const SCENE_IMMEDIATE_SAVE_EVENT = 'pascal:scene-immediate-save'

type PlacementAnchor = {
  screenPosition?: ScreenPoint
  worldPosition?: HomeAssistantGroundPoint
}

type SmartHomePanelSize = {
  height: number
  width: number
}

type SmartHomePanelResizeStart = SmartHomePanelSize & {
  startX: number
  startY: number
}

type DeviceGroupColor = {
  background: string
  border: string
  dot: string
}

type DeviceGroupMembershipDot = {
  color: string
  id: string
  label: string
}

const PASCAL_GROUP_RESOURCE_PREFIX = 'pascal-group'
const PLACEMENT_PILL_CLOSED_MIN_WIDTH = 56
const PLACEMENT_PILL_CLOSED_MAX_WIDTH = 240
const PLACEMENT_PILL_CLOSED_CHAR_WIDTH = 7.2
const PLACEMENT_PILL_HEIGHT = 32
const PLACEMENT_PILL_GAP = 16
const PLACEMENT_LINE_GAP = 4
const UNGROUPED_DEVICE_GROUP_KEY = '__ungrouped'
const DEVICE_GROUP_CHIP_WIDTH = 112
const DEVICE_GROUP_CHIP_HEIGHT = 34
const DEVICE_GROUP_CELL_WIDTH = 140
const DEVICE_GROUP_CELL_HEIGHT = 48
const DEVICE_GRID_MIN_COLUMNS = 3
const DEVICE_GRID_MAX_COLUMNS = 5
const DEVICE_SECTION_SCROLL_BOTTOM_SAFE_AREA = 28
const SMART_HOME_PANEL_DEFAULT_WIDTH = 400
const SMART_HOME_PANEL_COLLAPSED_MIN_HEIGHT = 196
const SMART_HOME_PANEL_EXPANDED_MIN_HEIGHT = 340
const SMART_HOME_PANEL_DEFAULT_HEIGHT = SMART_HOME_PANEL_COLLAPSED_MIN_HEIGHT
const SMART_HOME_PANEL_MIN_WIDTH = 320
const SMART_HOME_PANEL_VIEWPORT_MARGIN_X = 32
const SMART_HOME_PANEL_TOP_OFFSET = 64
const SMART_HOME_PANEL_BOTTOM_MARGIN_MIN = 16
const SMART_HOME_PANEL_BOTTOM_MARGIN_RATIO = 0.15
const DEVICE_GROUP_COLORS: DeviceGroupColor[] = [
  { background: '#efd98d', border: '#d09b23', dot: '#efd98d' },
  { background: '#bee9f2', border: '#46a9bd', dot: '#bee9f2' },
  { background: '#bfe7d7', border: '#55ad8d', dot: '#bfe7d7' },
  { background: '#cddff8', border: '#6f98dc', dot: '#cddff8' },
  { background: '#f0cfe4', border: '#d675aa', dot: '#f0cfe4' },
  { background: '#dbd0f1', border: '#9b79d5', dot: '#dbd0f1' },
  { background: '#efcece', border: '#d16f6f', dot: '#efcece' },
  { background: '#c8e8e1', border: '#62aaa0', dot: '#c8e8e1' },
]

const DEVICE_CATEGORY_ORDER: DeviceCategoryKey[] = ['light', 'fan', 'media_player', 'other']
const DEVICE_CATEGORY_LABELS: Record<DeviceCategoryKey, string> = {
  fan: 'Fans',
  light: 'Lights',
  media_player: 'TVs',
  other: 'Other',
}

type IconProps = {
  className?: string
}

type HomeAssistantConnectionResponse = {
  entityCount: number
  instanceUrl: string | null
  linked: boolean
  message: string
  mode?: 'linked-session' | 'local-env' | 'unlinked'
  success: boolean
}

type HomeAssistantDiscoveredInstance = {
  id: string
  instanceUrl: string
  label: string
  source: 'loopback' | 'zeroconf'
}

type ProviderDefinition = {
  accentClassName: string
  connectable: boolean
  icon: (props: IconProps) => ReactNode
  id: ProviderId
  name: string
}

function HomeAssistantMark({ className }: IconProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24">
      <path
        d="M12 4.1 5.2 8v8.2L12 20.1l6.8-3.9V8z"
        fill="currentColor"
        opacity="0.16"
      />
      <path
        d="M12 4.1 5.2 8v8.2L12 20.1l6.8-3.9V8z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <circle cx="12" cy="8.1" fill="currentColor" r="1.4" />
      <circle cx="8.4" cy="13.7" fill="currentColor" r="1.25" />
      <circle cx="15.6" cy="13.7" fill="currentColor" r="1.25" />
      <path
        d="M12 9.6v5.1M12 9.7l-2.45 3.1M12 9.7l2.45 3.1"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  )
}

const PROVIDERS: ProviderDefinition[] = [
  {
    accentClassName: 'text-cyan-200',
    connectable: true,
    icon: HomeAssistantMark,
    id: 'home-assistant',
    name: 'Home Assistant',
  },
]

function isItemNode(value: unknown): value is ItemNode {
  return Boolean(value && typeof value === 'object' && 'type' in value && value.type === 'item')
}

function getSelectedItems(nodes: Record<AnyNodeId, AnyNode>, selectedIds: string[]) {
  return selectedIds
    .map((selectedId) => nodes[selectedId as AnyNodeId])
    .filter((node): node is ItemNode => isItemNode(node))
}

function resolveExactCollectionForItems(
  collections: Record<CollectionId, Collection>,
  items: ItemNode[],
) {
  const itemIds = items.map((item) => item.id)
  if (itemIds.length === 0) {
    return null
  }

  return (
    Object.values(collections).find(
      (collection) =>
        collection.nodeIds.length === itemIds.length &&
        itemIds.every((itemId) => collection.nodeIds.includes(itemId)),
    ) ?? null
  )
}

function getCollectionNameFromItems(items: ItemNode[]) {
  if (items.length === 0) {
    return 'Home control'
  }

  if (items.length === 1) {
    return items[0]?.name?.trim() || items[0]?.asset.name?.trim() || 'Home control'
  }

  const firstName = items[0]?.name?.trim() || items[0]?.asset.name?.trim() || 'Control group'
  return `${firstName} group`
}

function toCollectionBinding(bindingNode: ReturnType<typeof getHomeAssistantBindingNodeMap>[CollectionId]) {
  return {
    aggregation: bindingNode.aggregation,
    collectionId: bindingNode.collectionId,
    presentation: bindingNode.presentation,
    primaryResourceId: bindingNode.primaryResourceId ?? null,
    resources: bindingNode.resources,
  } satisfies HomeAssistantCollectionBinding
}

function requestSceneImmediateSave() {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new Event(SCENE_IMMEDIATE_SAVE_EVENT))
}

function getStableHomeAssistantCollectionId(resourceId: string): CollectionId {
  const normalizedResourceId =
    resourceId
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'resource'
  return `collection_ha_${normalizedResourceId}` as CollectionId
}

function ensureHomeAssistantResourceCollection(
  resource: HomeAssistantImportedResource,
): Collection | null {
  const collectionId = getStableHomeAssistantCollectionId(resource.id)
  const existingCollection = useScene.getState().collections[collectionId]
  if (existingCollection) {
    return existingCollection
  }

  const collection = normalizeCollection({
    id: collectionId,
    name: resource.label,
    nodeIds: [],
  })
  useScene.setState((state) => ({
    collections: {
      ...state.collections,
      [collectionId]: collection,
    },
  }))
  return useScene.getState().collections[collectionId] ?? collection
}

function isGroupResource(resource: HomeAssistantImportedResource) {
  return (
    resource.kind === 'entity' &&
    (resource.isGroup === true || (resource.memberEntityIds?.length ?? 0) > 0)
  )
}

function getBindingResourceEntityId(resource: HomeAssistantResourceBinding) {
  return resource.entityId ?? resource.id
}

function getEntityObjectId(entityId: string | null | undefined, fallbackId: string) {
  const value = entityId?.trim() || fallbackId
  const dotIndex = value.indexOf('.')
  const objectId = dotIndex >= 0 ? value.slice(dotIndex + 1) : value

  return objectId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function getRoomGroupStemFromIdentity(entityId: string | null | undefined, fallbackId: string) {
  let stem = getEntityObjectId(entityId, fallbackId)
  const suffixPatterns = [
    /_all_lights_group$/,
    /_lights_all_group$/,
    /_lights_group$/,
    /_light_group$/,
    /_all_lights$/,
    /_lights_all$/,
    /_group$/,
    /_lights$/,
    /_light$/,
  ]

  for (const pattern of suffixPatterns) {
    stem = stem.replace(pattern, '')
  }

  return stem.length >= 4 ? stem : null
}

function getRoomGroupStem(resource: HomeAssistantImportedResource) {
  return getRoomGroupStemFromIdentity(resource.entityId, resource.id)
}

function getBindingRoomGroupStem(resource: HomeAssistantResourceBinding) {
  return getRoomGroupStemFromIdentity(resource.entityId, resource.id)
}

function bindingResourceMatchesGroup(
  resource: HomeAssistantResourceBinding,
  memberEntityIds: Set<string>,
  groupStem: string | null,
) {
  if (memberEntityIds.has(getBindingResourceEntityId(resource))) {
    return true
  }

  if (!groupStem) {
    return false
  }

  const domain = resource.entityId?.split('.')[0] ?? null
  if (domain !== 'fan') {
    return false
  }

  const objectId = getEntityObjectId(resource.entityId, resource.id)
  return objectId === groupStem || objectId.startsWith(`${groupStem}_`)
}

function bindingResourceIsExplicitGroupMember(
  resource: HomeAssistantResourceBinding,
  memberEntityIds: Set<string>,
) {
  return memberEntityIds.has(resource.id) || memberEntityIds.has(getBindingResourceEntityId(resource))
}

function excludedResourceIdIsExplicitGroupMember(
  binding: HomeAssistantCollectionBinding,
  resourceId: string,
  memberEntityIds: Set<string>,
) {
  if (memberEntityIds.has(resourceId)) {
    return true
  }

  const resource = binding.resources.find((entry) => entry.id === resourceId)
  return resource ? bindingResourceIsExplicitGroupMember(resource, memberEntityIds) : false
}

function bindingHasGroupResourceForDevice(
  binding: HomeAssistantCollectionBinding,
  resource: HomeAssistantResourceBinding,
) {
  return binding.resources.some(
    (groupResource) =>
      isBindingGroupResource(groupResource) &&
      bindingResourceMatchesGroup(
        resource,
        new Set(groupResource.memberEntityIds ?? []),
        getBindingRoomGroupStem(groupResource),
      ),
  )
}

function toResourceBinding(resource: HomeAssistantImportedResource): HomeAssistantResourceBinding {
  const memberEntityIds = resource.memberEntityIds ?? []
  const isGroup = resource.isGroup === true || memberEntityIds.length > 0

  return {
    actions: resource.actions,
    capabilities: resource.capabilities,
    defaultActionKey: resource.defaultActionKey,
    entityId: resource.entityId,
    id: resource.id,
    ...(isGroup
      ? {
          isGroup: true,
          memberEntityIds,
        }
      : {}),
    kind: resource.kind,
    label: resource.label,
  }
}

function bindingHasUserManagedGroupComposition({
  binding,
  collectionId,
  groupResourceId,
  groupStem,
  memberEntityIds,
}: {
  binding: HomeAssistantCollectionBinding | null | undefined
  collectionId: CollectionId
  groupResourceId: string
  groupStem: string | null
  memberEntityIds: Set<string>
}) {
  if (!binding) {
    return false
  }

  const excludedResourceIds = getSmartHomeExcludedResourceIds(binding.presentation)
  if (excludedResourceIds.length > 0 && binding.resources.some(isBindingDeviceResource)) {
    const hasUserManagedExclusion = excludedResourceIds.some(
      (resourceId) => !excludedResourceIdIsExplicitGroupMember(binding, resourceId, memberEntityIds),
    )
    if (hasUserManagedExclusion) {
      return true
    }
  }

  const groupedMemberIds = getSmartHomeRoomControlTileGroups({
    collectionId,
    presentation: binding.presentation,
  }).flat()
  if (
    groupedMemberIds.some((memberId) => {
      if (roomGroupMemberReferencesResource(collectionId, memberId, groupResourceId)) {
        return false
      }

      const resourceId = getRoomGroupMemberResourceId(collectionId, memberId)
      if (!resourceId) {
        return true
      }

      const resource = binding.resources.find((entry) => entry.id === resourceId)
      return (
        !resource ||
        !isBindingDeviceResource(resource) ||
        !bindingResourceMatchesGroup(resource, memberEntityIds, groupStem)
      )
    })
  ) {
    return true
  }

  return binding.resources.some(
    (resource) =>
      isBindingDeviceResource(resource) &&
      !bindingResourceMatchesGroup(resource, memberEntityIds, groupStem),
  )
}

function getResourceTypeIcon(resource: HomeAssistantImportedResource) {
  const domain = resource.domain ?? resource.entityId?.split('.')[0] ?? resource.kind

  if (isGroupResource(resource)) {
    return <Layers className="h-4 w-4" />
  }

  if (domain === 'fan') {
    return <Fan className="h-4 w-4" />
  }

  if (domain === 'media_player') {
    return <Tv className="h-4 w-4" />
  }

  if (domain === 'light') {
    return <Lightbulb className="h-4 w-4" />
  }

  if (resource.kind === 'scene' || resource.kind === 'script' || resource.kind === 'automation') {
    return <Sparkles className="h-4 w-4" />
  }

  return <Link2 className="h-4 w-4" />
}

function getDeviceCategoryKey(resource: HomeAssistantImportedResource): DeviceCategoryKey {
  const domain = resource.domain ?? resource.entityId?.split('.')[0] ?? resource.kind
  if (domain === 'light' || domain === 'fan' || domain === 'media_player') {
    return domain
  }

  return 'other'
}

function getDeviceCategoryIcon(category: DeviceCategoryKey) {
  if (category === 'light') {
    return <Lightbulb className="h-4 w-4" />
  }

  if (category === 'fan') {
    return <Fan className="h-4 w-4" />
  }

  if (category === 'media_player') {
    return <Tv className="h-4 w-4" />
  }

  return <Link2 className="h-4 w-4" />
}

function getDeviceCategoryTone(category: DeviceCategoryKey) {
  if (category === 'light') {
    return 'bg-amber-100/80 text-amber-700'
  }

  if (category === 'fan') {
    return 'bg-sky-100/80 text-sky-700'
  }

  if (category === 'media_player') {
    return 'bg-violet-100/80 text-violet-700'
  }

  return 'bg-cyan-100/80 text-cyan-700'
}

function getResourceAccentClasses(resource: HomeAssistantImportedResource) {
  const domain = resource.domain ?? resource.entityId?.split('.')[0] ?? resource.kind

  if (isGroupResource(resource)) {
    return 'text-cyan-700'
  }

  if (domain === 'fan') {
    return 'text-sky-300'
  }

  if (domain === 'media_player') {
    return 'text-violet-300'
  }

  if (domain === 'light') {
    return 'text-amber-300'
  }

  if (resource.kind === 'scene' || resource.kind === 'script' || resource.kind === 'automation') {
    return 'text-fuchsia-300'
  }

  return 'text-cyan-300'
}

function isDeviceResource(resource: HomeAssistantImportedResource) {
  return resource.kind === 'entity' && !isGroupResource(resource)
}

function getDeviceGroupColor(index: number) {
  return DEVICE_GROUP_COLORS[index % DEVICE_GROUP_COLORS.length]!
}

function getResourceEntityId(resource: HomeAssistantImportedResource) {
  return resource.entityId ?? resource.id
}

function getGroupSpecificity(resource: HomeAssistantImportedResource) {
  return resource.memberEntityIds?.length ?? Number.MAX_SAFE_INTEGER
}

function compareGroupsBySpecificity(
  left: HomeAssistantImportedResource,
  right: HomeAssistantImportedResource,
) {
  const specificityDelta = getGroupSpecificity(left) - getGroupSpecificity(right)
  if (specificityDelta !== 0) {
    return specificityDelta
  }

  return left.label.localeCompare(right.label)
}

function getSnakeGridCoordinate(index: number, columns: number) {
  const y = Math.floor(index / columns)
  const offset = index % columns
  const x = y % 2 === 0 ? offset : columns - 1 - offset

  return { x, y }
}

function getDeviceGridColumns(totalCells: number, availableColumns: number) {
  const cappedAvailableColumns = Math.max(
    DEVICE_GRID_MIN_COLUMNS,
    Math.min(DEVICE_GRID_MAX_COLUMNS, availableColumns),
  )
  const candidates = Array.from(
    { length: cappedAvailableColumns - DEVICE_GRID_MIN_COLUMNS + 1 },
    (_, index) => DEVICE_GRID_MIN_COLUMNS + index,
  )
  const exactCandidates = candidates.filter((columns) => totalCells % columns === 0)

  if (exactCandidates.length > 0) {
    return exactCandidates[exactCandidates.length - 1]!
  }

  return candidates.reduce((bestColumns, columns) => {
    const bestWaste = (bestColumns - (totalCells % bestColumns)) % bestColumns
    const waste = (columns - (totalCells % columns)) % columns
    if (waste !== bestWaste) {
      return waste < bestWaste ? columns : bestColumns
    }

    return columns > bestColumns ? columns : bestColumns
  }, candidates[0]!)
}

function getDeviceGroupBorderPath(coordinates: Array<{ x: number; y: number }>) {
  const occupiedCells = new Set(coordinates.map((coordinate) => `${coordinate.x}:${coordinate.y}`))
  const borderSegments = coordinates.flatMap((coordinate) => {
    const x = coordinate.x * DEVICE_GROUP_CELL_WIDTH
    const y = coordinate.y * DEVICE_GROUP_CELL_HEIGHT
    const right = x + DEVICE_GROUP_CELL_WIDTH
    const bottom = y + DEVICE_GROUP_CELL_HEIGHT
    const segments: string[] = []

    if (!occupiedCells.has(`${coordinate.x}:${coordinate.y - 1}`)) {
      segments.push(`M${x} ${y}L${right} ${y}`)
    }
    if (!occupiedCells.has(`${coordinate.x + 1}:${coordinate.y}`)) {
      segments.push(`M${right} ${y}L${right} ${bottom}`)
    }
    if (!occupiedCells.has(`${coordinate.x}:${coordinate.y + 1}`)) {
      segments.push(`M${right} ${bottom}L${x} ${bottom}`)
    }
    if (!occupiedCells.has(`${coordinate.x - 1}:${coordinate.y}`)) {
      segments.push(`M${x} ${bottom}L${x} ${y}`)
    }

    return segments
  })

  return borderSegments.join('')
}

function getGroupMemberEntityIds(group: HomeAssistantImportedResource | null | undefined) {
  return new Set(group?.memberEntityIds ?? [])
}

function countSharedGroupMembers(
  left: HomeAssistantImportedResource | null | undefined,
  right: HomeAssistantImportedResource | null | undefined,
) {
  if (!(left && right)) {
    return 0
  }

  const leftMembers = getGroupMemberEntityIds(left)
  let sharedCount = 0
  for (const memberEntityId of right.memberEntityIds ?? []) {
    if (leftMembers.has(memberEntityId)) {
      sharedCount += 1
    }
  }

  return sharedCount
}

function groupContainsResource(
  group: HomeAssistantImportedResource | null | undefined,
  resource: HomeAssistantImportedResource,
) {
  if (!group) {
    return false
  }

  return getGroupMemberEntityIds(group).has(getResourceEntityId(resource))
}

function orderDeviceGroupsBySharedMembers<
  T extends {
    group: HomeAssistantImportedResource | null
    resources: HomeAssistantImportedResource[]
  },
>(groups: T[]) {
  const explicitGroups = groups
    .filter((deviceGroup) => Boolean(deviceGroup.group))
    .sort((left, right) => {
      const specificityDelta =
        getGroupSpecificity(left.group!) - getGroupSpecificity(right.group!)
      if (specificityDelta !== 0) {
        return specificityDelta
      }

      return left.group!.label.localeCompare(right.group!.label)
    })
  const ungroupedGroups = groups.filter((deviceGroup) => !deviceGroup.group)

  if (explicitGroups.length <= 1) {
    return [...explicitGroups, ...ungroupedGroups]
  }

  const orderedGroups: T[] = []
  const remainingGroups = [...explicitGroups]
  orderedGroups.push(remainingGroups.shift()!)

  while (remainingGroups.length > 0) {
    const currentGroup = orderedGroups[orderedGroups.length - 1]!
    let bestIndex = 0
    let bestScore = -1

    remainingGroups.forEach((candidateGroup, index) => {
      const score = countSharedGroupMembers(currentGroup.group, candidateGroup.group)
      if (score > bestScore) {
        bestScore = score
        bestIndex = index
        return
      }

      if (score === bestScore) {
        const candidateSpecificity = getGroupSpecificity(candidateGroup.group!)
        const bestSpecificity = getGroupSpecificity(remainingGroups[bestIndex]!.group!)
        if (candidateSpecificity < bestSpecificity) {
          bestIndex = index
        }
      }
    })

    orderedGroups.push(remainingGroups.splice(bestIndex, 1)[0]!)
  }

  return [...orderedGroups, ...ungroupedGroups]
}

function orderResourcesForNeighborGroups(
  resources: HomeAssistantImportedResource[],
  previousGroup: HomeAssistantImportedResource | null | undefined,
  nextGroup: HomeAssistantImportedResource | null | undefined,
) {
  return [...resources].sort((left, right) => {
    const getBoundaryScore = (resource: HomeAssistantImportedResource) => {
      const touchesPreviousGroup = groupContainsResource(previousGroup, resource)
      const touchesNextGroup = groupContainsResource(nextGroup, resource)

      if (touchesPreviousGroup && !touchesNextGroup) {
        return -1
      }
      if (touchesNextGroup && !touchesPreviousGroup) {
        return 1
      }

      return 0
    }

    const boundaryDelta = getBoundaryScore(left) - getBoundaryScore(right)
    if (boundaryDelta !== 0) {
      return boundaryDelta
    }

    return left.label.localeCompare(right.label)
  })
}

function toImportedResourceFromBindingResource(
  resource: HomeAssistantResourceBinding,
  displayLabel?: string,
): HomeAssistantImportedResource {
  return {
    ...resource,
    description: 'RTS pill in Pascal',
    domain: resource.entityId?.split('.')[0] ?? resource.actions[0]?.domain ?? null,
    label: displayLabel?.trim() || resource.label,
    state: null,
  }
}

function getScenePillResource(
  binding: HomeAssistantCollectionBinding,
  collection: Collection | null | undefined,
) {
  const primaryResource =
    binding.resources.find((resource) => resource.id === binding.primaryResourceId) ??
    binding.resources[0]

  if (!primaryResource) {
    return null
  }

  return toImportedResourceFromBindingResource(
    primaryResource,
    binding.presentation?.label?.trim() || collection?.name?.trim() || primaryResource.label,
  )
}

function createPascalGroupResource(label: string): HomeAssistantImportedResource {
  const idSuffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

  return {
    actions: [],
    capabilities: ['power'],
    defaultActionKey: null,
    description: 'Pascal RTS group',
    domain: 'group',
    entityId: null,
    id: `${PASCAL_GROUP_RESOURCE_PREFIX}:${idSuffix}`,
    isGroup: true,
    kind: 'entity',
    label,
    memberEntityIds: [],
    state: null,
  }
}

function getNextPascalGroupLabel(resources: HomeAssistantImportedResource[]) {
  const baseLabel = 'Pascal group'
  const existingLabels = new Set(resources.map((resource) => resource.label.trim()))

  if (!existingLabels.has(baseLabel)) {
    return baseLabel
  }

  for (let index = 2; index < 1000; index += 1) {
    const label = `${baseLabel} ${index}`
    if (!existingLabels.has(label)) {
      return label
    }
  }

  return `${baseLabel} ${Date.now().toString(36)}`
}

function getPlacementPillWidth(label: string) {
  const normalizedLabel = label.trim() || 'Group'
  const estimatedWidth = 24 + normalizedLabel.length * PLACEMENT_PILL_CLOSED_CHAR_WIDTH
  return Math.max(
    PLACEMENT_PILL_CLOSED_MIN_WIDTH,
    Math.min(PLACEMENT_PILL_CLOSED_MAX_WIDTH, estimatedWidth),
  )
}

function clampSmartHomePanelSize(
  size: SmartHomePanelSize,
  minHeight = SMART_HOME_PANEL_EXPANDED_MIN_HEIGHT,
): SmartHomePanelSize {
  const bottomMargin =
    typeof window === 'undefined'
      ? SMART_HOME_PANEL_BOTTOM_MARGIN_MIN
      : Math.max(
          SMART_HOME_PANEL_BOTTOM_MARGIN_MIN,
          Math.ceil(window.innerHeight * SMART_HOME_PANEL_BOTTOM_MARGIN_RATIO),
        )
  const maxWidth =
    typeof window === 'undefined'
      ? 960
      : Math.max(SMART_HOME_PANEL_MIN_WIDTH, window.innerWidth - SMART_HOME_PANEL_VIEWPORT_MARGIN_X)
  const maxHeight =
    typeof window === 'undefined'
      ? 760
      : Math.max(
          minHeight,
          window.innerHeight - SMART_HOME_PANEL_TOP_OFFSET - bottomMargin,
        )

  return {
    height: Math.min(maxHeight, Math.max(minHeight, size.height)),
    width: Math.min(maxWidth, Math.max(SMART_HOME_PANEL_MIN_WIDTH, size.width)),
  }
}

function getSmartHomeSectionOverflow(sectionBody: HTMLElement) {
  const sectionRect = sectionBody.getBoundingClientRect()
  const scrollOverflow = Math.max(0, sectionBody.scrollHeight - sectionBody.clientHeight)
  const nestedScrollOverflow = Array.from(
    sectionBody.querySelectorAll<HTMLElement>('[data-smart-home-scroll-body]'),
  ).reduce(
    (totalOverflow, element) =>
      totalOverflow + Math.max(0, element.scrollHeight - element.clientHeight),
    0,
  )
  const contentBottom = Array.from(sectionBody.querySelectorAll<HTMLElement>('*')).reduce(
    (bottom, element) => {
      const rect = element.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) {
        return bottom
      }

      return Math.max(bottom, rect.bottom)
    },
    sectionRect.bottom,
  )

  return Math.max(
    scrollOverflow,
    nestedScrollOverflow,
    Math.max(0, contentBottom - sectionRect.bottom),
  )
}

export function HomeAssistantPanel() {
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null)
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const theme = useViewer((state) => state.theme)
  const setHoveredId = useViewer((state) => state.setHoveredId)
  const setHoveredIds = useViewer((state) => state.setHoveredIds)
  const smartHomeOverlayVisibility = useEditor((state) => state.smartHomeOverlayVisibility)
  const setSmartHomeOverlaySectionVisible = useEditor(
    (state) => state.setSmartHomeOverlaySectionVisible,
  )
  const nodes = useScene((state) => state.nodes)
  const collections = useScene((state) => state.collections)
  const createCollection = useScene((state) => state.createCollection)
  const deleteCollection = useScene((state) => state.deleteCollection)
  const updateCollection = useScene((state) => state.updateCollection)
  const createNode = useScene((state) => state.createNode)
  const updateNode = useScene((state) => state.updateNode)
  const deleteNode = useScene((state) => state.deleteNode)

  const pairingResourceId = useEditor((state) => state.homeAssistantPairingResourceId)
  const pairingTargetItemId = useEditor((state) => state.homeAssistantPairingTargetItemId)
  const setPairingResourceId = useEditor((state) => state.setHomeAssistantPairingResourceId)
  const setPairingTargetItemId = useEditor((state) => state.setHomeAssistantPairingTargetItemId)
  const isSmartHomePanelOpen = useEditor((state) => state.isSmartHomePanelOpen)
  const setSmartHomePanelOpen = useEditor((state) => state.setSmartHomePanelOpen)

  const [activePanel, setActivePanel] = useState<ActivePanel>(null)
  const [connectionState, setConnectionState] = useState<HomeAssistantConnectionResponse | null>(null)
  const [imports, setImports] = useState<HomeAssistantImportedResource[]>([])
  const [discoveredInstances, setDiscoveredInstances] = useState<HomeAssistantDiscoveredInstance[]>([])
  const [instanceUrlInput, setInstanceUrlInput] = useState('http://localhost:8123')
  const [externalUrlInput, setExternalUrlInput] = useState('')
  const [isRefreshingConnection, setIsRefreshingConnection] = useState(false)
  const [isRefreshingImports, setIsRefreshingImports] = useState(false)
  const [isDiscoveringInstances, setIsDiscoveringInstances] = useState(false)
  const [isStartingOauth, setIsStartingOauth] = useState(false)
  const [panelError, setPanelError] = useState('')
  const [renamingResourceId, setRenamingResourceId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [openGroupMenuResourceId, setOpenGroupMenuResourceId] = useState<string | null>(null)
  const [openSections, setOpenSections] = useState<Record<ImportSectionKey, boolean>>({
    actions: false,
    devices: false,
    groups: false,
  })
  const [openDeviceCategories, setOpenDeviceCategories] = useState<
    Record<DeviceCategoryKey, boolean>
  >({
    fan: false,
    light: true,
    media_player: false,
    other: false,
  })
  const [panelSize, setPanelSize] = useState<SmartHomePanelSize>({
    height: SMART_HOME_PANEL_DEFAULT_HEIGHT,
    width: SMART_HOME_PANEL_DEFAULT_WIDTH,
  })
  const [positioningResource, setPositioningResource] =
    useState<HomeAssistantImportedResource | null>(null)
  const [positioningPointer, setPositioningPointer] = useState<ScreenPoint>({ x: 0, y: 0 })
  const [positioningPreview, setPositioningPreview] =
    useState<HomeAssistantPlacementPreview | null>(null)
  const [deviceSectionWidth, setDeviceSectionWidth] = useState(0)
  const hasOpenImportSection = openSections.devices || openSections.groups
  const smartHomePanelMinHeight = hasOpenImportSection
    ? SMART_HOME_PANEL_EXPANDED_MIN_HEIGHT
    : SMART_HOME_PANEL_COLLAPSED_MIN_HEIGHT
  const smartHomePanelRef = useRef<HTMLElement | null>(null)
  const configContentRef = useRef<HTMLDivElement | null>(null)
  const deviceSectionRef = useRef<HTMLDivElement | null>(null)
  const positioningResourceRef = useRef<HomeAssistantImportedResource | null>(null)
  const placementSuppressionTimeoutRef = useRef<number | null>(null)
  const panelResizeStartRef = useRef<SmartHomePanelResizeStart | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setPortalRoot(document.body)
  }, [])

  useEffect(() => {
    const handleWindowResize = () => {
      setPanelSize((currentValue) =>
        clampSmartHomePanelSize(currentValue, smartHomePanelMinHeight),
      )
    }

    handleWindowResize()
    window.addEventListener('resize', handleWindowResize)
    return () => window.removeEventListener('resize', handleWindowResize)
  }, [smartHomePanelMinHeight])

  useEffect(() => {
    if (isSmartHomePanelOpen && !activePanel) {
      setActivePanel({ kind: 'chooser' })
    }
  }, [activePanel, isSmartHomePanelOpen])

  const sceneNodes = nodes as Record<AnyNodeId, AnyNode>
  const homeAssistantBindings = useMemo(
    () => getHomeAssistantBindingNodeMap(sceneNodes),
    [sceneNodes],
  )
  const hiddenGroupResourceIds = useMemo(() => {
    const resourceIds = new Set<string>()

    for (const bindingNode of Object.values(homeAssistantBindings)) {
      if (!isSmartHomeBindingPresentationHidden(bindingNode.presentation)) {
        continue
      }

      for (const resource of bindingNode.resources) {
        if (isBindingGroupResource(resource)) {
          resourceIds.add(resource.id)
        }
      }
    }

    return resourceIds
  }, [homeAssistantBindings])

  const selectedItems = useMemo(
    () => getSelectedItems(sceneNodes, selectedIds),
    [sceneNodes, selectedIds],
  )

  const selectedCollection = useMemo(
    () => resolveExactCollectionForItems(collections, selectedItems),
    [collections, selectedItems],
  )

  const resourceOwners = useMemo(() => {
    const owners = new Map<string, { collectionId: CollectionId; collectionName: string }>()

    for (const bindingNode of Object.values(homeAssistantBindings)) {
      if (isSmartHomeBindingPresentationHidden(bindingNode.presentation)) {
        continue
      }

      const collection = collections[bindingNode.collectionId]
      for (const resource of bindingNode.resources) {
        owners.set(resource.id, {
          collectionId: bindingNode.collectionId,
          collectionName:
            bindingNode.presentation?.label?.trim() ||
            collection?.name?.trim() ||
            bindingNode.name?.trim() ||
            'Collection',
        })
      }
    }

    return owners
  }, [collections, homeAssistantBindings])

  const deviceImports = useMemo(
    () => imports.filter((resource) => isDeviceResource(resource)),
    [imports],
  )
  const deviceCategoryGroups = useMemo(() => {
    const groupedResources = new Map<DeviceCategoryKey, HomeAssistantImportedResource[]>()

    for (const resource of deviceImports) {
      const category = getDeviceCategoryKey(resource)
      const categoryResources = groupedResources.get(category) ?? []
      categoryResources.push(resource)
      groupedResources.set(category, categoryResources)
    }

    return DEVICE_CATEGORY_ORDER.map((category) => ({
      category,
      resources: groupedResources.get(category) ?? [],
    })).filter((group) => group.resources.length > 0)
  }, [deviceImports])
  const groupImports = useMemo(() => {
    const resourcesById = new Map<string, HomeAssistantImportedResource>()

    for (const resource of imports.filter((entry) => isGroupResource(entry))) {
      if (hiddenGroupResourceIds.has(resource.id)) {
        continue
      }

      resourcesById.set(resource.id, resource)
    }

    for (const bindingNode of Object.values(homeAssistantBindings)) {
      if (
        !bindingHasGroupResource(bindingNode) ||
        isSmartHomeBindingPresentationHidden(bindingNode.presentation)
      ) {
        continue
      }

      const collection = collections[bindingNode.collectionId]
      const hasScenePill =
        Boolean(
          bindingNode.presentation?.rtsWorldPosition ||
            bindingNode.presentation?.rtsScreenPosition,
        ) || Boolean(collection?.nodeIds.length)

      if (!hasScenePill) {
        continue
      }

      const scenePillResource = getScenePillResource(bindingNode, collection)
      if (scenePillResource && !hiddenGroupResourceIds.has(scenePillResource.id)) {
        resourcesById.set(scenePillResource.id, scenePillResource)
      }
    }

    return Array.from(resourcesById.values())
  }, [collections, hiddenGroupResourceIds, homeAssistantBindings, imports])
  const groupColorById = useMemo(() => {
    const colorById = new Map<string, DeviceGroupColor>()
    const sortedGroups = [...groupImports].sort((left, right) =>
      left.label.localeCompare(right.label),
    )

    sortedGroups.forEach((group, index) => {
      colorById.set(group.id, getDeviceGroupColor(index))
    })

    return colorById
  }, [groupImports])

  const deviceGroupMemberships = useMemo(() => {
    const devicesByEntityId = new Map<string, HomeAssistantImportedResource>()
    const membershipsByDeviceId = new Map<string, HomeAssistantImportedResource[]>()

    for (const device of deviceImports) {
      const entityId = getResourceEntityId(device)
      devicesByEntityId.set(entityId, device)
      membershipsByDeviceId.set(device.id, [])
    }

    for (const group of groupImports) {
      for (const memberEntityId of group.memberEntityIds ?? []) {
        const device = devicesByEntityId.get(memberEntityId)
        if (!device) {
          continue
        }

        membershipsByDeviceId.get(device.id)?.push(group)
      }
    }

    for (const memberships of membershipsByDeviceId.values()) {
      memberships.sort(compareGroupsBySpecificity)
    }

    return membershipsByDeviceId
  }, [deviceImports, groupImports])

  const groupedDeviceImports = useMemo(() => {
    const groupBuckets = new Map<
      string,
      {
        color: DeviceGroupColor
        group: HomeAssistantImportedResource | null
        resources: HomeAssistantImportedResource[]
      }
    >()

    for (const group of groupImports) {
      if ((group.memberEntityIds?.length ?? 0) === 0) {
        continue
      }

      groupBuckets.set(group.id, {
        color: groupColorById.get(group.id) ?? getDeviceGroupColor(groupBuckets.size),
        group,
        resources: [],
      })
    }

    for (const resource of deviceImports) {
      const memberships = deviceGroupMemberships.get(resource.id) ?? []
      const primaryGroup = memberships[0] ?? null
      const bucketKey = primaryGroup?.id ?? UNGROUPED_DEVICE_GROUP_KEY
      const color =
        (primaryGroup ? groupColorById.get(primaryGroup.id) : null) ??
        ({ background: 'rgba(244,244,245,0.55)', border: 'rgba(24,24,27,0.12)', dot: '#71717a' } satisfies DeviceGroupColor)

      if (!groupBuckets.has(bucketKey)) {
        groupBuckets.set(bucketKey, {
          color,
          group: primaryGroup,
          resources: [],
        })
      }

      groupBuckets.get(bucketKey)?.resources.push(resource)
    }

    const orderedGroups = orderDeviceGroupsBySharedMembers(Array.from(groupBuckets.values()))

    return orderedGroups.map((deviceGroup, index, groups) => ({
      ...deviceGroup,
      resources: orderResourcesForNeighborGroups(
        deviceGroup.resources,
        groups[index - 1]?.group,
        groups[index + 1]?.group,
      ),
    }))
  }, [deviceGroupMemberships, deviceImports, groupColorById, groupImports])

  const maxAvailableDeviceGridColumns = Math.max(
    DEVICE_GRID_MIN_COLUMNS,
    Math.floor(
      Math.max(
        deviceSectionWidth > 0 ? deviceSectionWidth - 16 : 700,
        DEVICE_GRID_MIN_COLUMNS * DEVICE_GROUP_CELL_WIDTH,
      ) / DEVICE_GROUP_CELL_WIDTH,
    ),
  )
  const packedDeviceLayout = useMemo(() => {
    const totalCells = groupedDeviceImports.reduce(
      (cellCount, deviceGroup) => cellCount + deviceGroup.resources.length + 1,
      0,
    )
    const columns = getDeviceGridColumns(totalCells, maxAvailableDeviceGridColumns)
    let cursor = 0

    const groups = groupedDeviceImports.map((deviceGroup) => {
      const cellCount = deviceGroup.resources.length + 1
      const coordinates = Array.from({ length: cellCount }, (_, index) =>
        getSnakeGridCoordinate(cursor + index, columns),
      )
      cursor += cellCount

      return {
        ...deviceGroup,
        borderPath: getDeviceGroupBorderPath(coordinates),
        coordinates,
      }
    })
    const rows = Math.ceil(totalCells / columns)

    return {
      groups,
      contentHeight: rows * DEVICE_GROUP_CELL_HEIGHT,
      height: rows * DEVICE_GROUP_CELL_HEIGHT + DEVICE_SECTION_SCROLL_BOTTOM_SAFE_AREA,
      rows,
      width: columns * DEVICE_GROUP_CELL_WIDTH,
    }
  }, [groupedDeviceImports, maxAvailableDeviceGridColumns])

  const connectedProviderIds = useMemo(() => {
    return connectionState?.linked ? (['home-assistant'] satisfies ProviderId[]) : ([] as ProviderId[])
  }, [connectionState?.linked])
  const activePanelProviderId =
    activePanel?.kind === 'connect' || activePanel?.kind === 'config'
      ? activePanel.providerId
      : null

  useLayoutEffect(() => {
    if (
      !isSmartHomePanelOpen ||
      activePanel?.kind !== 'config' ||
      activePanelProviderId !== 'home-assistant' ||
      typeof window === 'undefined'
    ) {
      return
    }

    const animationFrame = window.requestAnimationFrame(() => {
      if (!hasOpenImportSection) {
        setPanelSize((currentValue) => {
          const nextValue = clampSmartHomePanelSize(
            {
              height: SMART_HOME_PANEL_COLLAPSED_MIN_HEIGHT,
              width: currentValue.width,
            },
            SMART_HOME_PANEL_COLLAPSED_MIN_HEIGHT,
          )

          return Math.abs(nextValue.height - currentValue.height) > 1
            ? nextValue
            : currentValue
        })
        return
      }

      const panelElement = smartHomePanelRef.current
      const configContent = configContentRef.current
      const sectionBodies = Array.from(
        configContent?.querySelectorAll<HTMLElement>('[data-smart-home-section-body]') ?? [],
      )

      if (!panelElement || !configContent || sectionBodies.length === 0) {
        return
      }

      const sectionOverflows = sectionBodies.map(getSmartHomeSectionOverflow)
      const neededGrowth = sectionOverflows.reduce(
        (totalGrowth, overflow) => totalGrowth + overflow,
        0,
      )

      if (neededGrowth <= 1) {
        return
      }

      const panelHeight = panelElement.getBoundingClientRect().height
      const requiredPanelHeight = panelHeight + Math.ceil(neededGrowth)

      setPanelSize((currentValue) => {
        const nextValue = clampSmartHomePanelSize(
          {
            height: Math.max(currentValue.height, requiredPanelHeight),
            width: currentValue.width,
          },
          SMART_HOME_PANEL_EXPANDED_MIN_HEIGHT,
        )

        return Math.abs(nextValue.height - currentValue.height) > 1
          ? nextValue
          : currentValue
      })
    })

    return () => window.cancelAnimationFrame(animationFrame)
  }, [
    activePanel?.kind,
    activePanelProviderId,
    deviceCategoryGroups.length,
    deviceImports.length,
    groupImports.length,
    hasOpenImportSection,
    isSmartHomePanelOpen,
    openDeviceCategories.fan,
    openDeviceCategories.light,
    openDeviceCategories.media_player,
    openDeviceCategories.other,
    openSections.devices,
    openSections.groups,
  ])

  useEffect(() => {
    const element = deviceSectionRef.current
    if (!element || typeof window === 'undefined' || !('ResizeObserver' in window)) {
      return
    }

    const updateWidth = () => {
      setDeviceSectionWidth(element.clientWidth)
    }
    const resizeObserver = new window.ResizeObserver(updateWidth)

    updateWidth()
    resizeObserver.observe(element)

    return () => {
      resizeObserver.disconnect()
    }
  }, [activePanel, openSections.devices])

  async function refreshConnectionStatus(options?: { silent?: boolean }) {
    setIsRefreshingConnection(true)
    if (!options?.silent) {
      setPanelError('')
    }

    try {
      const response = await fetch('/api/home-assistant/connection-status', { cache: 'no-store' })
      const payload = (await response.json()) as HomeAssistantConnectionResponse & { error?: string }

      setConnectionState(payload)
      if (payload.instanceUrl) {
        setInstanceUrlInput(payload.instanceUrl)
      }

      if (!response.ok) {
        throw new Error(payload.error || payload.message || 'Failed to connect to Home Assistant.')
      }

      return payload
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to connect to Home Assistant.'
      setPanelError(message)
      return null
    } finally {
      setIsRefreshingConnection(false)
    }
  }

  async function refreshImports(options?: { silent?: boolean }) {
    setIsRefreshingImports(true)
    if (!options?.silent) {
      setPanelError('')
    }

    try {
      const response = await fetch('/api/home-assistant/import-resources', {
        cache: 'no-store',
      })
      const payload = (await response.json()) as {
        error?: string
        resources?: HomeAssistantImportedResource[]
      }

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to import Home Assistant resources.')
      }

      const resources = Array.isArray(payload.resources)
        ? payload.resources.filter(
            (resource) => !isHiddenHomeAssistantGroupResourceId(resource.id),
          )
        : []
      setImports(resources)
      return resources
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to import Home Assistant resources.'
      setPanelError(message)
      return []
    } finally {
      setIsRefreshingImports(false)
    }
  }

  async function refreshDiscoveredInstances() {
    setIsDiscoveringInstances(true)
    setPanelError('')

    try {
      const response = await fetch('/api/home-assistant/discover-instances', {
        cache: 'no-store',
      })
      const payload = (await response.json()) as {
        error?: string
        instances?: HomeAssistantDiscoveredInstance[]
      }

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to discover Home Assistant instances.')
      }

      const nextInstances = Array.isArray(payload.instances) ? payload.instances : []
      setDiscoveredInstances(nextInstances)
      return nextInstances
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to discover Home Assistant instances.'
      setPanelError(message)
      return []
    } finally {
      setIsDiscoveringInstances(false)
    }
  }

  async function startHomeAssistantOauth(instanceUrlOverride?: string) {
    setIsStartingOauth(true)
    setPanelError('')

    try {
      const response = await fetch('/api/home-assistant/oauth/start', {
        body: JSON.stringify({
          externalUrl: externalUrlInput.trim() || undefined,
          instanceUrl: instanceUrlOverride ?? (instanceUrlInput.trim() || undefined),
        }),
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
      })
      const payload = (await response.json()) as { authorizeUrl?: string; error?: string }

      if (!response.ok || !payload.authorizeUrl) {
        throw new Error(payload.error || 'Failed to start Home Assistant sign-in.')
      }

      window.location.assign(payload.authorizeUrl)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to start Home Assistant sign-in.'
      setPanelError(message)
      setIsStartingOauth(false)
    }
  }

  const ensureCollectionForItems = (items: ItemNode[]) => {
    const existingCollection = resolveExactCollectionForItems(
      useScene.getState().collections,
      items,
    )

    if (existingCollection) {
      return existingCollection
    }

    if (items.length === 0) {
      return null
    }

    const collectionId = createCollection(
      getCollectionNameFromItems(items),
      items.map((item) => item.id),
    )
    updateCollection(collectionId, {
      controlNodeId: items[0]?.id,
    })

    return useScene.getState().collections[collectionId] ?? null
  }

  const upsertBindingNode = (collection: Collection, binding: HomeAssistantCollectionBinding) => {
    const existingBindingNode = getHomeAssistantBindingNodeMap(
      useScene.getState().nodes as Record<AnyNodeId, AnyNode>,
    )[collection.id]
    const nextNode = createHomeAssistantBindingNode({
      binding,
      id: existingBindingNode?.id,
      name: collection.name,
    })

    if (!nextNode) {
      return
    }

    if (existingBindingNode) {
      const excludedResourceIdsForMerge = nextNode.presentation
        ? getSmartHomeExcludedResourceIds(nextNode.presentation)
        : getSmartHomeExcludedResourceIds(existingBindingNode.presentation)
      const mergedResources = mergeIncomingBindingResourcesWithLocalDevices(
        nextNode.resources,
        existingBindingNode.resources,
        excludedResourceIdsForMerge,
      )
      const nextPresentation = nextNode.presentation
      const nextPrimaryResourceId =
        existingBindingNode.primaryResourceId &&
        mergedResources.some((resource) => resource.id === existingBindingNode.primaryResourceId)
          ? existingBindingNode.primaryResourceId
          : (nextNode.primaryResourceId ?? null)
      const existingBinding = toCollectionBinding(existingBindingNode)
      const mergedPresentation = mergeHomeAssistantPresentation(
        existingBindingNode.presentation,
        nextPresentation,
      )
      const nextBinding = {
        aggregation: nextNode.aggregation,
        collectionId: nextNode.collectionId,
        presentation: mergedPresentation,
        primaryResourceId: nextPrimaryResourceId,
        resources: mergedResources,
      } satisfies HomeAssistantCollectionBinding

      if (
        existingBindingNode.name === collection.name &&
        homeAssistantBindingsAreEqual(existingBinding, nextBinding)
      ) {
        return
      }

      const nodePatch = {
        aggregation: nextNode.aggregation,
        collectionId: nextNode.collectionId,
        name: nextNode.name,
        presentation: mergedPresentation,
        primaryResourceId: nextPrimaryResourceId,
        resources: mergedResources,
      } as Partial<AnyNode>

      if (homeAssistantNodePatchMatches(existingBindingNode, nodePatch)) {
        return
      }

      updateNode(existingBindingNode.id, nodePatch)
      return
    }

    createNode({
      ...nextNode,
    })
  }

  const removeResourceFromOtherCollections = (
    resource: HomeAssistantImportedResource,
    targetCollectionId: CollectionId,
  ) => {
    const resourceBinding = toResourceBinding(resource)
    const state = useScene.getState()
    const currentBindings = getHomeAssistantBindingNodeMap(
      state.nodes as Record<AnyNodeId, AnyNode>,
    )

    for (const bindingNode of Object.values(currentBindings)) {
      if (bindingNode.collectionId === targetCollectionId) {
        continue
      }

      const binding = toCollectionBinding(bindingNode)
      if (bindingHasGroupResourceForDevice(binding, resourceBinding)) {
        const nextPresentation = getPresentationAfterResourceInclusion(
          bindingNode.presentation,
          bindingNode.collectionId,
          resource.id,
          bindingNode.resources,
        )
        if (nextPresentation !== bindingNode.presentation) {
          updateNode(bindingNode.id, {
            presentation: nextPresentation,
          } as Partial<AnyNode>)
          requestSceneImmediateSave()
        }
        continue
      }

      if (!bindingNode.resources.some((entry) => entry.id === resource.id)) {
        continue
      }

      const collection = state.collections[bindingNode.collectionId]
      const nextResources = bindingNode.resources.filter((entry) => entry.id !== resource.id)
      const nextPresentation = getPresentationAfterResourceRemoval(
        bindingNode.presentation,
        bindingNode.collectionId,
        resource.id,
        nextResources,
      )

      if (!collection || nextResources.length === 0) {
        deleteNode(bindingNode.id)
        requestSceneImmediateSave()
        continue
      }

      const nextBinding = normalizeHomeAssistantCollectionBinding({
        ...toCollectionBinding(bindingNode),
        aggregation:
          nextResources.some((entry) => entry.kind !== 'entity')
            ? 'trigger_only'
            : nextResources.length > 1 || collection.nodeIds.length > 1
              ? 'all'
              : 'single',
        primaryResourceId:
          bindingNode.primaryResourceId === resource.id
            ? nextResources[0]?.id ?? null
            : bindingNode.primaryResourceId ?? nextResources[0]?.id ?? null,
        presentation: nextPresentation,
        resources: nextResources,
      })

      if (!nextBinding) {
        deleteNode(bindingNode.id)
        requestSceneImmediateSave()
        continue
      }
      updateNode(bindingNode.id, nextBinding as Partial<AnyNode>)
      requestSceneImmediateSave()
    }
  }

  const bindResourceToItems = (resource: HomeAssistantImportedResource, items: ItemNode[]) => {
    if (!isDeviceResource(resource)) {
      return
    }

    const collection = ensureCollectionForItems(items)
    if (!collection) {
      return
    }

    removeResourceFromOtherCollections(resource, collection.id)

    const currentBindings = getHomeAssistantBindingNodeMap(
      useScene.getState().nodes as Record<AnyNodeId, AnyNode>,
    )
    const existingBindingNode = currentBindings[collection.id]
    const nextBinding = existingBindingNode
      ? bindResourceToCollectionBinding({
          collection,
          existingBinding: toCollectionBinding(existingBindingNode),
          presentation: existingBindingNode.presentation,
          resource,
        })
      : buildCollectionBindingFromResource({
          collectionId: collection.id,
          presentation: {
            label: collection.name,
          },
          resource,
        })

    upsertBindingNode(collection, nextBinding)
  }

  const unbindResourceFromCollection = (collection: Collection, resourceId: string) => {
    const existingBindingNode =
      getHomeAssistantBindingNodeMap(
        useScene.getState().nodes as Record<AnyNodeId, AnyNode>,
      )[collection.id] ?? homeAssistantBindings[collection.id]
    if (!existingBindingNode) {
      return
    }

    const nextResources = existingBindingNode.resources.filter((resource) => resource.id !== resourceId)
    const nextPresentation = getPresentationAfterResourceRemoval(
      existingBindingNode.presentation,
      existingBindingNode.collectionId,
      resourceId,
      nextResources,
    )
    if (nextResources.length === 0) {
      deleteNode(existingBindingNode.id)
      requestSceneImmediateSave()
      return
    }

    const nextBinding = normalizeHomeAssistantCollectionBinding({
      aggregation:
        nextResources.some((resource) => resource.kind !== 'entity')
          ? 'trigger_only'
          : nextResources.length > 1 || collection.nodeIds.length > 1
            ? 'all'
            : 'single',
      collectionId: existingBindingNode.collectionId,
      primaryResourceId:
        existingBindingNode.primaryResourceId === resourceId
          ? nextResources[0]?.id ?? null
          : existingBindingNode.primaryResourceId ?? nextResources[0]?.id ?? null,
      presentation: nextPresentation,
      resources: nextResources,
    })

    if (!nextBinding) {
      deleteNode(existingBindingNode.id)
      requestSceneImmediateSave()
      return
    }

    updateNode(existingBindingNode.id, nextBinding as Partial<AnyNode>)
    requestSceneImmediateSave()
  }

  const deleteGroupResource = (resource: HomeAssistantImportedResource) => {
    const state = useScene.getState()
    const currentNodes = state.nodes as Record<AnyNodeId, AnyNode>
    const currentBindings = getHomeAssistantBindingNodeMap(currentNodes)
    const existingBindingNode = Object.values(currentBindings).find((bindingNode) =>
      bindingNode.resources.some((entry) => entry.id === resource.id),
    )

    if (!existingBindingNode) {
      return
    }

    const hiddenBinding = normalizeHomeAssistantCollectionBinding({
      aggregation: 'single',
      collectionId: existingBindingNode.collectionId,
      presentation: {
        ...(existingBindingNode.presentation ?? {}),
        label: resource.label,
        rtsHidden: true,
        rtsRoomControls: undefined,
        rtsScreenPosition: undefined,
        rtsWorldPosition: undefined,
      },
      primaryResourceId: resource.id,
      resources: [toResourceBinding(resource)],
    })

    if (!hiddenBinding) {
      return
    }

    updateNode(existingBindingNode.id, hiddenBinding as Partial<AnyNode>)
    requestSceneImmediateSave()
  }

  const getLocalGroupRenameTarget = (resource: HomeAssistantImportedResource) => {
    const state = useScene.getState()
    const currentNodes = state.nodes as Record<AnyNodeId, AnyNode>
    const currentBindings = getHomeAssistantBindingNodeMap(currentNodes)
    const existingBindingNode = Object.values(currentBindings).find((bindingNode) =>
      bindingNode.resources.some((entry) => entry.id === resource.id),
    )

    if (!existingBindingNode) {
      return null
    }

    const collection = state.collections[existingBindingNode.collectionId]
    if (!collection) {
      return null
    }

    const currentLabel =
      existingBindingNode.presentation?.label?.trim() ||
      collection.name.trim() ||
      resource.label.trim() ||
      'Pascal group'

    return { collection, currentLabel, existingBindingNode }
  }

  const startGroupRename = (resource: HomeAssistantImportedResource) => {
    const target = getLocalGroupRenameTarget(resource)
    if (!target) {
      return
    }

    setOpenGroupMenuResourceId(null)
    setRenamingResourceId(resource.id)
    setRenameDraft(target.currentLabel)
  }

  const cancelGroupRename = () => {
    setRenamingResourceId(null)
    setRenameDraft('')
  }

  const applyGroupRename = (resource: HomeAssistantImportedResource) => {
    const target = getLocalGroupRenameTarget(resource)
    const nextLabel = renameDraft.trim()

    if (!(target && nextLabel) || nextLabel === target.currentLabel) {
      cancelGroupRename()
      return
    }

    const nextBinding = normalizeHomeAssistantCollectionBinding({
      ...toCollectionBinding(target.existingBindingNode),
      presentation: {
        ...(target.existingBindingNode.presentation ?? {}),
        label: nextLabel,
      },
      resources: target.existingBindingNode.resources.map((entry) =>
        entry.id === resource.id ? { ...entry, label: nextLabel } : entry,
      ),
    })

    if (!nextBinding) {
      return
    }

    updateCollection(target.collection.id, { name: nextLabel })
    upsertBindingNode({ ...target.collection, name: nextLabel }, nextBinding)
    cancelGroupRename()
  }

  const startPairing = (resourceId: string) => {
    const resource = imports.find((entry) => entry.id === resourceId)
    if (!(resource && isDeviceResource(resource))) {
      return
    }

    useViewer.getState().setSelection({ selectedIds: [], zoneId: null })
    setPairingTargetItemId(null)
    setPairingResourceId(resourceId)
  }

  const placeGroupResource = (
    resource: HomeAssistantImportedResource,
    anchor: PlacementAnchor,
  ) => {
    if (!(anchor.worldPosition || anchor.screenPosition)) {
      return
    }

    const state = useScene.getState()
    const currentNodes = state.nodes as Record<AnyNodeId, AnyNode>
    const currentBindings = getHomeAssistantBindingNodeMap(currentNodes)
    const existingBindingNode = Object.values(currentBindings).find((bindingNode) =>
      bindingNode.resources.some((entry) => entry.id === resource.id),
    )

    if (!(isGroupResource(resource) || existingBindingNode)) {
      return
    }

    let collection = existingBindingNode
      ? state.collections[existingBindingNode.collectionId]
      : null

    if (!collection) {
      collection = ensureHomeAssistantResourceCollection(resource)
    }

    if (!collection) {
      return
    }

    const presentation = {
      ...(existingBindingNode?.presentation ?? {}),
      label: resource.label,
      rtsScreenPosition: anchor.worldPosition ? undefined : anchor.screenPosition,
      rtsWorldPosition: anchor.worldPosition,
    }
    const nextBinding = existingBindingNode
      ? normalizeHomeAssistantCollectionBinding({
          ...toCollectionBinding(existingBindingNode),
          presentation,
        })
      : buildCollectionBindingFromResource({
          collectionId: collection.id,
          presentation,
          resource,
        })

    if (!nextBinding) {
      return
    }

    upsertBindingNode(collection, nextBinding)
  }

  const startGroupPositioning = (resource: HomeAssistantImportedResource) => {
    const hasExistingScenePill = Object.values(homeAssistantBindings).some((bindingNode) =>
      bindingNode.resources.some((entry) => entry.id === resource.id),
    )

    if (!(isGroupResource(resource) || hasExistingScenePill)) {
      return
    }

    const centerPoint =
      typeof window === 'undefined'
        ? { x: 0, y: 0 }
        : { x: window.innerWidth / 2, y: window.innerHeight / 2 }

    positioningResourceRef.current = resource
    if (placementSuppressionTimeoutRef.current !== null) {
      window.clearTimeout(placementSuppressionTimeoutRef.current)
      placementSuppressionTimeoutRef.current = null
    }
    useViewer.getState().setRoomControlOverlayActive(true)
    setPositioningPointer(centerPoint)
    setPositioningPreview(resolveHomeAssistantPlacementPreview(centerPoint.x, centerPoint.y))
    setPositioningResource(resource)
    setPairingTargetItemId(null)
    setPairingResourceId(null)
    setSmartHomePanelOpen(false)
    setActivePanel(null)
  }

  const createNewPascalGroup = () => {
    const resource = createPascalGroupResource(getNextPascalGroupLabel(groupImports))
    setOpenSections((current) => ({ ...current, groups: true }))
    startGroupPositioning(resource)
  }

  const stopGroupPositioning = () => {
    positioningResourceRef.current = null
    setPositioningPreview(null)
    setPositioningResource(null)
  }

  useEffect(() => {
    positioningResourceRef.current = positioningResource
  }, [positioningResource])

  useEffect(() => {
    let changed = false

    for (const bindingNode of Object.values(homeAssistantBindings)) {
      const hasHiddenGroupResource = bindingNode.resources.some((resource) =>
        isHiddenHomeAssistantGroupResourceId(resource.id),
      )
      if (!hasHiddenGroupResource) {
        continue
      }

      deleteNode(bindingNode.id)
      if (useScene.getState().collections[bindingNode.collectionId]) {
        deleteCollection(bindingNode.collectionId)
      }
      changed = true
    }

    if (changed) {
      requestSceneImmediateSave()
    }
  }, [deleteCollection, deleteNode, homeAssistantBindings])

  useEffect(() => {
    if (!renamingResourceId) {
      return
    }

    const animationFrame = window.requestAnimationFrame(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    })

    return () => window.cancelAnimationFrame(animationFrame)
  }, [renamingResourceId])

  useEffect(() => {
    const deviceResourceIds = new Set(deviceImports.map((resource) => resource.id))
    if (deviceResourceIds.size === 0) {
      return
    }

    for (const bindingNode of Object.values(homeAssistantBindings)) {
      const nextResources = bindingNode.resources.filter(
        (resource) =>
          resource.kind !== 'entity' ||
          isBindingGroupResource(resource) ||
          deviceResourceIds.has(resource.id),
      )

      if (nextResources.length === bindingNode.resources.length) {
        continue
      }

      if (nextResources.length === 0) {
        deleteNode(bindingNode.id)
        continue
      }

      const nextBinding = normalizeHomeAssistantCollectionBinding({
        ...toCollectionBinding(bindingNode),
        aggregation:
          nextResources.some((resource) => resource.kind !== 'entity')
            ? 'trigger_only'
            : nextResources.length > 1
              ? 'all'
              : 'single',
        primaryResourceId: nextResources.some(
          (resource) => resource.id === bindingNode.primaryResourceId,
        )
          ? bindingNode.primaryResourceId
          : nextResources.find((resource) => !isBindingGroupResource(resource))?.id ??
            nextResources[0]?.id ??
            null,
        resources: nextResources,
      })

      if (!nextBinding) {
        continue
      }

      updateNode(bindingNode.id, nextBinding as Partial<AnyNode>)
    }
  }, [deviceImports, homeAssistantBindings, updateNode])

  useEffect(() => {
    const bindableGroups = imports.filter(
      (resource) => isGroupResource(resource) && (resource.memberEntityIds?.length ?? 0) > 0,
    )
    if (bindableGroups.length === 0) {
      return
    }

    const state = useScene.getState()
    const currentNodes = state.nodes as Record<AnyNodeId, AnyNode>
    const currentBindings = getHomeAssistantBindingNodeMap(currentNodes)
    const currentCollections = state.collections

    for (const groupResource of bindableGroups) {
      if (hiddenGroupResourceIds.has(groupResource.id)) {
        continue
      }

      const memberEntityIds = getGroupMemberEntityIds(groupResource)
      const groupStem = getRoomGroupStem(groupResource)
      const boundMemberItemIds = new Set<AnyNodeId>()
      const boundMemberResources = new Map<string, HomeAssistantResourceBinding>()

      for (const bindingNode of Object.values(currentBindings)) {
        const collection = currentCollections[bindingNode.collectionId]
        if (!collection) {
          continue
        }

        const matchingMemberResources = bindingNode.resources.filter(
          (resource): resource is HomeAssistantResourceBinding =>
            isBindingDeviceResource(resource) &&
            bindingResourceMatchesGroup(resource, memberEntityIds, groupStem),
        )
        if (matchingMemberResources.length === 0) {
          continue
        }

        for (const resource of matchingMemberResources) {
          boundMemberResources.set(resource.id, cloneResourceBinding(resource))
        }

        const candidateNodeIds = collection.controlNodeId
          ? [collection.controlNodeId, ...collection.nodeIds]
          : collection.nodeIds
        for (const nodeId of candidateNodeIds) {
          if (currentNodes[nodeId]?.type === 'item') {
            boundMemberItemIds.add(nodeId)
          }
        }
      }

      if (boundMemberItemIds.size === 0) {
        continue
      }

      const existingBindingNode = Object.values(currentBindings).find((bindingNode) =>
        bindingNode.resources.some((entry) => entry.id === groupResource.id),
      )
      let collection = existingBindingNode
        ? currentCollections[existingBindingNode.collectionId]
        : null

      if (!collection) {
        collection = ensureHomeAssistantResourceCollection(groupResource)
      }

      if (!collection) {
        continue
      }

      const existingBinding = existingBindingNode
        ? toCollectionBinding(existingBindingNode)
        : null
      const detachedResourceIds = new Set(
        getSmartHomeExcludedResourceIds(existingBinding?.presentation),
      )
      const groupBindingResource = toResourceBinding(groupResource)
      const hasUserManagedComposition = bindingHasUserManagedGroupComposition({
        binding: existingBinding,
        collectionId: collection.id,
        groupResourceId: groupResource.id,
        memberEntityIds,
        groupStem,
      })
      const memberResources = hasUserManagedComposition
        ? []
        : Array.from(boundMemberResources.values()).filter(
            (resource) => !detachedResourceIds.has(resource.id),
          )
      const excludedResourceIds = new Set(
        getSmartHomeExcludedResourceIds(existingBinding?.presentation),
      )
      if (!hasUserManagedComposition) {
        for (const resource of boundMemberResources.values()) {
          if (
            bindingResourceIsExplicitGroupMember(resource, memberEntityIds) &&
            !detachedResourceIds.has(resource.id)
          ) {
            excludedResourceIds.delete(resource.id)
          }
        }
      }
      const nextPresentation: NonNullable<HomeAssistantCollectionBinding['presentation']> = {
        ...(existingBinding?.presentation ?? {}),
        label: existingBinding?.presentation?.label ?? groupResource.label,
      }
      if (!hasUserManagedComposition) {
        nextPresentation.rtsRoomControls = buildSmartHomeRoomControlCompositionFromTileGroups({
          collectionId: collection.id,
          excludedResourceIds: Array.from(excludedResourceIds),
          groups: getSmartHomeRoomControlTileGroups({
            collectionId: collection.id,
            presentation: existingBinding?.presentation,
          }),
          resources: existingBinding?.resources ?? [],
        })
        delete nextPresentation.rtsExcludedResourceIds
        delete nextPresentation.rtsGroups
      }
      const existingResources = existingBinding?.resources ?? []
      const nextResourceMap = new Map<string, HomeAssistantResourceBinding>([
        [groupBindingResource.id, groupBindingResource],
      ])

      for (const resource of memberResources) {
        if (excludedResourceIds.has(resource.id)) {
          continue
        }
        nextResourceMap.set(resource.id, cloneResourceBinding(resource))
      }

      for (const resource of existingResources) {
        if (resource.id === groupResource.id) {
          continue
        }
        if (excludedResourceIds.has(resource.id)) {
          continue
        }
        if (
          !hasUserManagedComposition &&
          isBindingDeviceResource(resource) &&
          bindingResourceMatchesGroup(resource, memberEntityIds, groupStem)
        ) {
          continue
        }
        if (!nextResourceMap.has(resource.id)) {
          nextResourceMap.set(resource.id, cloneResourceBinding(resource))
        }
      }

      const nextResources = Array.from(nextResourceMap.values())
      const deviceResourceCount = nextResources.filter(isBindingDeviceResource).length
      const existingPrimaryResourceId =
        existingBinding?.primaryResourceId &&
        nextResources.some((resource) => resource.id === existingBinding.primaryResourceId)
          ? existingBinding.primaryResourceId
          : null
      const primaryResourceId =
        existingPrimaryResourceId && existingPrimaryResourceId !== groupResource.id
          ? existingPrimaryResourceId
          : memberResources[0]?.id ?? existingPrimaryResourceId ?? groupResource.id
      const nextBinding = normalizeHomeAssistantCollectionBinding({
        aggregation: nextResources.some((resource) => resource.kind !== 'entity')
          ? 'trigger_only'
          : deviceResourceCount > 1
            ? 'all'
            : 'single',
        collectionId: collection.id,
        presentation: nextPresentation,
        primaryResourceId,
        resources: nextResources,
      })

    if (!nextBinding || homeAssistantBindingsAreEqual(existingBinding, nextBinding)) {
        continue
      }

      upsertBindingNode(collection, nextBinding)
      requestSceneImmediateSave()
    }
  }, [createCollection, hiddenGroupResourceIds, imports, homeAssistantBindings])

  useEffect(() => {
    if (!(positioningResource && typeof window !== 'undefined')) {
      return
    }

    const previousCursor = document.body.style.cursor
    document.body.style.cursor = 'crosshair'

    const handlePointerMove = (event: PointerEvent) => {
      setPositioningPointer({ x: event.clientX, y: event.clientY })
      setPositioningPreview(resolveHomeAssistantPlacementPreview(event.clientX, event.clientY))
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return
      }

      const resource = positioningResourceRef.current
      if (!resource) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      const preview = resolveHomeAssistantPlacementPreview(event.clientX, event.clientY)
      setPositioningPreview(preview)
      const worldPosition = preview?.groundPosition ?? resolveHomeAssistantGroundPoint(event.clientX, event.clientY)
      if (!worldPosition) {
        return
      }
      placeGroupResource(resource, {
        worldPosition,
      })
      placementSuppressionTimeoutRef.current = window.setTimeout(() => {
        useViewer.getState().setRoomControlOverlayActive(false)
        placementSuppressionTimeoutRef.current = null
      }, 220)
      stopGroupPositioning()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        useViewer.getState().setRoomControlOverlayActive(false)
        stopGroupPositioning()
      }
    }

    window.addEventListener('pointermove', handlePointerMove, true)
    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.body.style.cursor = previousCursor
      window.removeEventListener('pointermove', handlePointerMove, true)
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown, true)
      if (placementSuppressionTimeoutRef.current === null) {
        useViewer.getState().setRoomControlOverlayActive(false)
      }
    }
  }, [positioningResource])

  useEffect(() => {
    void refreshConnectionStatus({ silent: true }).then((payload) => {
      if (payload?.linked) {
        void refreshImports({ silent: true })
      }
    })
  }, [])

  useEffect(() => {
    if (activePanel?.kind !== 'connect' || activePanel.providerId !== 'home-assistant') {
      return
    }

    void refreshConnectionStatus({ silent: true }).then((payload) => {
      if (payload?.linked) {
        setActivePanel({ kind: 'config', providerId: 'home-assistant' })
        void refreshImports({ silent: true })
        return
      }

      void refreshDiscoveredInstances()
    })
  }, [activePanel])

  useEffect(() => {
    if (activePanel?.kind !== 'config' || activePanel.providerId !== 'home-assistant') {
      return
    }

    void refreshConnectionStatus({ silent: true }).then((payload) => {
      if (payload?.linked) {
        void refreshImports({ silent: true })
      } else {
        setActivePanel({ kind: 'connect', providerId: 'home-assistant' })
      }
    })
  }, [activePanel])

  useEffect(() => {
    if (!pairingResourceId || !pairingTargetItemId) {
      return
    }

    const pairingTargetNode = sceneNodes[pairingTargetItemId]
    const pairingResource = imports.find((resource) => resource.id === pairingResourceId)

    if (!(pairingResource && isDeviceResource(pairingResource) && isItemNode(pairingTargetNode))) {
      setPairingTargetItemId(null)
      setPairingResourceId(null)
      return
    }

    bindResourceToItems(pairingResource, [pairingTargetNode])
    setPairingTargetItemId(null)
    setPairingResourceId(null)
    setSmartHomePanelOpen(true)
    setActivePanel({ kind: 'config', providerId: 'home-assistant' })
  }, [
    imports,
    pairingResourceId,
    pairingTargetItemId,
    sceneNodes,
    setPairingResourceId,
    setPairingTargetItemId,
    setSmartHomePanelOpen,
  ])

  const handleProviderChoice = (providerId: ProviderId) => {
    if (providerId !== 'home-assistant') {
      return
    }

    if (connectionState?.linked) {
      setActivePanel({ kind: 'config', providerId: 'home-assistant' })
      return
    }

    setActivePanel({ kind: 'connect', providerId: 'home-assistant' })
  }

  const toggleSection = (section: ImportSectionKey) => {
    setOpenSections((currentValue) => ({
      ...currentValue,
      [section]: !currentValue[section],
    }))
  }

  const toggleDeviceCategory = (category: DeviceCategoryKey) => {
    setOpenDeviceCategories((currentValue) => ({
      ...currentValue,
      [category]: !currentValue[category],
    }))
  }

  const previewCollection = (collection: Collection | null | undefined) => {
    if (!collection) {
      return
    }

    const targetNodeIds = collection.nodeIds.filter((nodeId) => Boolean(sceneNodes[nodeId as AnyNodeId]))
    if (targetNodeIds.length === 0) {
      return
    }

    const focusNodeId = (collection.controlNodeId ?? targetNodeIds[0]) as AnyNodeId | undefined
    if (!focusNodeId) {
      return
    }

    setHoveredId(focusNodeId)
    setHoveredIds(targetNodeIds as AnyNodeId[])
    emitter.emit('camera-controls:focus', { nodeId: focusNodeId })
  }

  const clearPreviewedCollection = () => {
    setHoveredId(null)
    setHoveredIds([])
  }

  const handlePanelResizePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()

    const startSize = clampSmartHomePanelSize(panelSize, smartHomePanelMinHeight)
    panelResizeStartRef.current = {
      ...startSize,
      startX: event.clientX,
      startY: event.clientY,
    }
    document.body.style.cursor = 'nesw-resize'
    document.body.style.userSelect = 'none'

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const start = panelResizeStartRef.current
      if (!start) {
        return
      }

      setPanelSize(
        clampSmartHomePanelSize(
          {
            height: start.height + moveEvent.clientY - start.startY,
            width: start.width + start.startX - moveEvent.clientX,
          },
          smartHomePanelMinHeight,
        ),
      )
    }

    const stopResize = () => {
      panelResizeStartRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)
  }

  const selectedPanelProvider =
    activePanel?.kind === 'connect' || activePanel?.kind === 'config'
      ? (PROVIDERS.find((provider) => provider.id === activePanel.providerId) ?? null)
      : null
  const SelectedPanelProviderIcon = selectedPanelProvider?.icon ?? null
  const clampedPanelSize = clampSmartHomePanelSize(panelSize, smartHomePanelMinHeight)
  const panelWidthStyle = `min(${clampedPanelSize.width}px, calc(100vw - 2rem))`
  const panelHeightStyle = `min(${clampedPanelSize.height}px, calc(100vh - 5rem))`
  const placementPillWidth = positioningResource
    ? getPlacementPillWidth(positioningResource.label)
    : PLACEMENT_PILL_CLOSED_MIN_WIDTH
  const placementPillPoint = positioningPreview?.visible
    ? positioningPreview.pillScreenPosition
    : positioningPointer
  const placementGroundPoint = positioningPreview?.visible
    ? positioningPreview.groundScreenPosition
    : null
  const placementPillTop =
    placementPillPoint.y - PLACEMENT_PILL_HEIGHT - PLACEMENT_PILL_GAP
  const placementLineTop = placementPillTop + PLACEMENT_PILL_HEIGHT + PLACEMENT_LINE_GAP
  const placementLineHeight = placementGroundPoint
    ? Math.max(placementGroundPoint.y - placementLineTop, 0)
    : 0
  const placementGuideClassName =
    theme === 'dark'
      ? 'bg-[rgba(232,235,240,0.86)] shadow-[0_0_8px_rgba(232,235,240,0.32)]'
      : 'bg-[rgba(70,74,82,0.92)]'

  const renderResourceRow = (
    sectionKey: ImportSectionKey,
    resource: HomeAssistantImportedResource,
    membershipDots: DeviceGroupMembershipDot[] = [],
  ) => {
    const owner = resourceOwners.get(resource.id)
    const isBoundToCurrent =
      Boolean(owner) && owner?.collectionId === selectedCollection?.id
    const isBoundElsewhere =
      Boolean(owner) && owner?.collectionId !== selectedCollection?.id
    const isPairing = pairingResourceId === resource.id
    const canBind = sectionKey === 'devices'
    const canPosition = sectionKey === 'groups'
    const ownerCollection = owner ? collections[owner.collectionId] : null
    const canPreview = Boolean(ownerCollection) && canBind
    const isClickable = canPreview || (canBind && !isBoundElsewhere && !isBoundToCurrent)
    const rowIsActive = isBoundToCurrent || (canPosition && Boolean(owner))
    const isRenaming = renamingResourceId === resource.id
    const deviceBindingSurfaceClassName = owner
      ? 'bg-rose-100/78 hover:bg-rose-100'
      : 'bg-emerald-100/78 hover:bg-emerald-100'

    return (
      <div
        className={cn(
          'relative flex items-center gap-2 transition',
          sectionKey === 'devices'
            ? cn('h-8 rounded-lg px-2 text-zinc-950', deviceBindingSurfaceClassName)
            : 'w-full rounded-lg bg-white/68 px-2 text-zinc-950 hover:bg-white',
          isPairing ? 'ring-2 ring-amber-300/70' : '',
        )}
        key={resource.id}
        style={
          sectionKey === 'devices'
            ? { height: DEVICE_GROUP_CHIP_HEIGHT, width: DEVICE_GROUP_CHIP_WIDTH }
            : { height: DEVICE_GROUP_CHIP_HEIGHT }
        }
      >
        {isRenaming ? (
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className={cn('shrink-0', getResourceAccentClasses(resource))}>
              {getResourceTypeIcon(resource)}
            </div>
            <input
              aria-label={`New name for ${resource.label}`}
              className="min-w-0 flex-1 rounded-lg border border-cyan-700/24 bg-white/78 px-2 py-1.5 text-sm font-medium text-zinc-950 outline-none transition focus:border-cyan-700/45"
              onChange={(event) => setRenameDraft(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  applyGroupRename(resource)
                  return
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  cancelGroupRename()
                }
              }}
              ref={renameInputRef}
              value={renameDraft}
            />
          </div>
        ) : (
          <button
            className={cn(
              'flex min-w-0 flex-1 items-center justify-between gap-3 text-left outline-none transition focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
              sectionKey === 'devices' ? 'gap-1.5' : '',
              isClickable ? 'cursor-pointer hover:opacity-100' : 'cursor-default opacity-90',
            )}
            disabled={!isClickable}
            onMouseEnter={() => {
              if (ownerCollection && canBind) {
                const targetNodeIds = ownerCollection.nodeIds.filter((nodeId) =>
                  Boolean(sceneNodes[nodeId as AnyNodeId]),
                )
                if (targetNodeIds.length > 0) {
                  const focusNodeId = ownerCollection.controlNodeId ?? targetNodeIds[0]
                  setHoveredId((focusNodeId as AnyNodeId | undefined) ?? null)
                  setHoveredIds(targetNodeIds as AnyNodeId[])
                }
              }
            }}
            onMouseLeave={clearPreviewedCollection}
            onClick={() => {
              if (ownerCollection && canBind) {
                previewCollection(ownerCollection)
                return
              }
              if (!canBind) {
                return
              }
              if (selectedItems.length > 0) {
                bindResourceToItems(resource, selectedItems)
                return
              }

              startPairing(resource.id)
            }}
            type="button"
          >
            <div
              className={cn(
                'flex min-w-0 items-center',
                sectionKey === 'devices' ? 'gap-0' : 'gap-3',
              )}
            >
              {sectionKey !== 'devices' && (
                <div className={cn('shrink-0', getResourceAccentClasses(resource))}>
                  {getResourceTypeIcon(resource)}
                </div>
              )}
              <span
                className={cn(
                  'truncate font-medium text-zinc-950',
                  sectionKey === 'devices' ? 'text-xs' : 'text-sm',
                )}
              >
                {resource.label}
              </span>
            </div>
            {isPairing && <Sparkles className="h-4 w-4 shrink-0 text-amber-200" />}
          </button>
        )}

        {owner && ownerCollection && canBind && (
          <button
            aria-label={`Unbind ${resource.label} from ${owner.collectionName}`}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/42 text-rose-900 outline-none transition hover:bg-white/70 focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
            onClick={() => {
              unbindResourceFromCollection(ownerCollection, resource.id)
            }}
            type="button"
          >
            <Unlink className="h-3 w-3" />
          </button>
        )}

        {!owner && !isPairing && canBind && (
          <button
            aria-label={`Bind ${resource.label}`}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/42 text-emerald-900 outline-none transition hover:bg-white/70 focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
            onClick={() => {
              if (selectedItems.length > 0) {
                bindResourceToItems(resource, selectedItems)
                return
              }

              startPairing(resource.id)
            }}
            type="button"
          >
            <Link2 className="h-3 w-3" />
          </button>
        )}

        {canPosition && (
          <div className="flex shrink-0 items-center gap-1">
            {isRenaming ? (
              <>
                <button
                  aria-label={`Save ${resource.label} name`}
                  className="flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-lg bg-emerald-500/16 text-emerald-900 outline-none transition hover:bg-emerald-500/24 focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
                  onClick={() => applyGroupRename(resource)}
                  type="button"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  aria-label={`Cancel renaming ${resource.label}`}
                  className="flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-lg bg-zinc-950/8 text-zinc-800 outline-none transition hover:bg-zinc-950/14 focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
                  onClick={cancelGroupRename}
                  type="button"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </>
            ) : (
              <>
                <button
                  aria-label={`Show actions for ${resource.label}`}
                  className="flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-lg bg-zinc-950/8 text-zinc-800 outline-none transition hover:bg-zinc-950/14 focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
                  onClick={() =>
                    setOpenGroupMenuResourceId((currentValue) =>
                      currentValue === resource.id ? null : resource.id,
                    )
                  }
                  type="button"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
                {openGroupMenuResourceId === resource.id && (
                  <>
                    <button
                      aria-label={`${owner ? 'Reposition' : 'Position'} ${resource.label}`}
                      className="flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-lg bg-cyan-600/14 text-cyan-950 outline-none transition hover:bg-cyan-600/24 focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
                      onClick={() => {
                        setOpenGroupMenuResourceId(null)
                        startGroupPositioning(resource)
                      }}
                      type="button"
                    >
                      <MapPin className="h-3.5 w-3.5" />
                    </button>
                    <button
                      aria-label={`Rename ${resource.label}`}
                      className={cn(
                        'flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-lg bg-zinc-950/8 text-zinc-800 outline-none transition focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
                        owner ? 'hover:bg-zinc-950/14' : 'cursor-not-allowed opacity-35',
                      )}
                      disabled={!owner}
                      onClick={() => startGroupRename(resource)}
                      type="button"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      aria-label={`Delete ${resource.label}`}
                      className={cn(
                        'flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-lg bg-rose-500/14 text-rose-900 outline-none transition focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
                        owner ? 'hover:bg-rose-500/24' : 'cursor-not-allowed opacity-35',
                      )}
                      disabled={!owner}
                      onClick={() => {
                        setOpenGroupMenuResourceId(null)
                        deleteGroupResource(resource)
                      }}
                      type="button"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  const panelContent = (
    <>
      {positioningResource && (
        <div className="pointer-events-none fixed inset-0 z-50">
          {placementGroundPoint && placementLineHeight > 0 && (
            <div
              className={cn(
                'absolute top-0 left-0 w-0.5 rounded-full',
                placementGuideClassName,
              )}
              style={{
                height: placementLineHeight,
                left: placementPillPoint.x,
                top: placementLineTop,
                transform: 'translateX(-50%)',
                transformOrigin: 'top center',
              }}
            />
          )}
          {placementGroundPoint && (
            <div
              className={cn(
                'absolute h-1.5 w-1.5 rounded-full',
                theme === 'dark'
                  ? 'bg-[rgba(232,235,240,0.86)] shadow-[0_0_8px_rgba(232,235,240,0.32)]'
                  : 'bg-[rgba(70,74,82,0.92)]',
              )}
              style={{
                left: placementPillPoint.x,
                top: placementGroundPoint.y,
                transform: 'translate(-50%, -50%)',
              }}
            />
          )}
          <div
            className="absolute flex h-8 items-center justify-center overflow-hidden rounded-[18px] border border-[rgba(92,98,108,1)] bg-[linear-gradient(180deg,rgba(237,239,243,1)_0%,rgba(216,220,226,1)_100%)] px-3 text-center text-xs font-bold tracking-[0.02em] text-[rgba(18,20,24,0.96)] shadow-[inset_-4px_0_0_rgba(92,98,108,1),0_12px_24px_rgba(0,0,0,0.24)]"
            style={{
              left: placementPillPoint.x,
              top: placementPillTop,
              transform: 'translateX(-50%)',
              width: placementPillWidth,
            }}
          >
            <span className="w-full truncate leading-none">{positioningResource.label}</span>
          </div>
        </div>
      )}

      <div className="pointer-events-none fixed top-16 right-4 z-[320] flex items-start">
      {isSmartHomePanelOpen && activePanel && (
        <section
          className="pointer-events-auto relative flex max-h-[calc(100vh-5rem)] min-h-0 flex-col overflow-hidden rounded-2xl border border-black/8 bg-[rgba(226,228,232,0.97)] p-3 text-zinc-900 shadow-[0_18px_50px_rgba(0,0,0,0.16)] backdrop-blur-xl"
          ref={smartHomePanelRef}
          style={{
            height: activePanel.kind === 'config' ? panelHeightStyle : undefined,
            width: panelWidthStyle,
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {selectedPanelProvider && SelectedPanelProviderIcon ? (
                <button
                  aria-label="Back to smart home providers"
                  className="flex min-w-0 items-center gap-1.5 rounded-xl border border-black/10 bg-white/62 px-2 py-1.5 text-zinc-950 shadow-[0_6px_14px_rgba(0,0,0,0.08)] transition hover:bg-white/82"
                  onClick={() => setActivePanel({ kind: 'chooser' })}
                  type="button"
                >
                  <ChevronLeft className="h-3.5 w-3.5 shrink-0 text-zinc-700" />
                  <span className="truncate text-[0.72rem] font-bold uppercase tracking-[0.14em]">
                    SMART HOME
                  </span>
                  <SelectedPanelProviderIcon
                    className={cn(
                      'h-5 w-5 shrink-0',
                      selectedPanelProvider.id === 'home-assistant'
                        ? 'text-[#18BCF2]'
                        : selectedPanelProvider.accentClassName,
                    )}
                  />
                </button>
              ) : (
                <p className="truncate text-[0.72rem] font-bold uppercase tracking-[0.14em] text-zinc-950">
                  SMART HOME
                </p>
              )}
              {activePanel.kind === 'config' && (
                <button
                  aria-label="Refresh imported devices"
                  className="flex h-7.5 w-7.5 items-center justify-center rounded-xl border border-black/8 bg-white/55 text-zinc-700 transition hover:bg-white/80 hover:text-zinc-950"
                  onClick={() => void refreshImports()}
                  type="button"
                >
                  {isRefreshingImports ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
            </div>
            <button
              aria-label="Close smart home panel"
              className="flex h-8 w-8 items-center justify-center rounded-xl border border-black/8 bg-white/55 text-zinc-700 transition hover:bg-white/80 hover:text-zinc-950"
              onClick={() => setSmartHomePanelOpen(false)}
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {activePanel.kind === 'chooser' && (
            <div className="mt-3 grid gap-1.5">
              {PROVIDERS.map((provider) => {
                const ProviderIcon = provider.icon
                const isConnected = connectedProviderIds.includes(provider.id)

                return (
                  <button
                    className={cn(
                      'flex items-center justify-between rounded-xl border px-3 py-2.5 text-left transition',
                      provider.connectable
                        ? 'border-black/8 bg-[rgba(244,245,247,0.9)] text-zinc-950 hover:bg-white'
                        : 'cursor-default border-black/6 bg-[rgba(236,238,241,0.74)] text-zinc-500',
                    )}
                    disabled={!provider.connectable}
                    key={provider.id}
                    onClick={() => handleProviderChoice(provider.id)}
                    type="button"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-zinc-950/8"
                      >
                        <ProviderIcon className={cn('h-6.5 w-6.5', provider.accentClassName)} />
                      </div>
                      <span className="truncate text-sm font-medium">{provider.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                       {isConnected && <Check className="h-4 w-4 text-cyan-700" />}
                       {provider.connectable && !isConnected && (
                         <Wifi className="h-4 w-4 text-zinc-600" />
                       )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {activePanel.kind === 'connect' && activePanel.providerId === 'home-assistant' && (
            <div className="mt-3 grid gap-2.5">
              <div className="rounded-xl border border-black/8 bg-white/45 p-3">
                <div className="mb-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-zinc-800">
                    <Wifi className="h-4 w-4 text-cyan-700" />
                    <span>Nearby</span>
                  </div>
                  <button
                    aria-label="Rescan Home Assistant instances"
                    className="flex h-8 w-8 items-center justify-center rounded-xl border border-black/8 bg-white/55 text-zinc-700 transition hover:bg-white/80 hover:text-zinc-950"
                    onClick={() => void refreshDiscoveredInstances()}
                    type="button"
                  >
                  {isDiscoveringInstances ? (
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>

                <div className="grid gap-1.5">
                  {discoveredInstances.map((instance) => (
                    <button
                      className="flex w-full items-center justify-between rounded-xl border border-black/8 bg-white/62 px-3 py-2.5 text-left transition hover:bg-white"
                      key={instance.id}
                      onClick={() => void startHomeAssistantOauth(instance.instanceUrl)}
                      type="button"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-zinc-950">{instance.label}</p>
                        <p className="truncate text-xs text-zinc-600">{instance.instanceUrl}</p>
                      </div>
                      <Wifi className="h-4 w-4 shrink-0 text-cyan-700" />
                    </button>
                  ))}

                  {!isDiscoveringInstances && discoveredInstances.length === 0 && (
                    <div className="rounded-xl border border-dashed border-black/8 bg-white/42 px-3 py-3.5 text-center text-xs text-zinc-500">
                      No Home Assistant instance discovered yet
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-black/8 bg-white/45 p-3">
                <div className="grid gap-1.5">
                  <input
                    className="rounded-xl border border-black/8 bg-white/62 px-3 py-2.5 text-sm text-zinc-950 outline-none transition placeholder:text-zinc-500 focus:border-cyan-600/45"
                    onChange={(event) => setInstanceUrlInput(event.target.value)}
                    placeholder="http://raspberrypi.local:8123"
                    value={instanceUrlInput}
                  />
                  <input
                    className="rounded-xl border border-black/8 bg-white/62 px-3 py-2.5 text-sm text-zinc-950 outline-none transition placeholder:text-zinc-500 focus:border-cyan-600/45"
                    onChange={(event) => setExternalUrlInput(event.target.value)}
                    placeholder="https://your-ha.example.com"
                    value={externalUrlInput}
                  />
                  <button
                    className="flex items-center justify-center gap-2 rounded-xl border border-cyan-700/20 bg-cyan-600/12 px-3 py-2.5 text-sm font-medium text-cyan-950 transition hover:bg-cyan-600/18"
                    disabled={isStartingOauth}
                    onClick={() => void startHomeAssistantOauth()}
                    type="button"
                  >
                    {isStartingOauth ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Link2 className="h-4 w-4" />
                    )}
                    Connect Home Assistant
                  </button>
                </div>
              </div>

              {panelError && (
                <div className="rounded-xl border border-rose-700/22 bg-rose-500/12 px-3 py-2.5 text-sm text-rose-950">
                  {panelError}
                </div>
              )}
            </div>
          )}

          {activePanel.kind === 'config' && activePanel.providerId === 'home-assistant' && (
            <div
              className={cn(
                'mt-3 min-h-0',
                hasOpenImportSection ? 'flex-1 overflow-hidden' : 'shrink-0',
              )}
            >
              <div
                className={cn(
                  'flex min-h-0 flex-col gap-2 overflow-hidden pr-1',
                  hasOpenImportSection ? 'h-full max-h-full' : '',
                )}
                ref={configContentRef}
              >
                {([
                  { key: 'devices' as const, label: 'Devices', resources: deviceImports },
                  { key: 'groups' as const, label: 'Groups', resources: groupImports },
                ] as const).map((section) => {
                  const isOpen = openSections[section.key]
                  const SectionChevron = isOpen ? ChevronDown : ChevronRight
                  const isRenderVisible = smartHomeOverlayVisibility[section.key]
                  const SectionVisibilityIcon = isRenderVisible ? Eye : EyeOff

                  return (
                    <div
                      className={cn(
                        'rounded-xl bg-[rgba(228,231,236,0.94)] transition',
                        isOpen
                          ? 'flex min-h-0 flex-1 basis-0 flex-col overflow-hidden shadow-[0_10px_24px_rgba(0,0,0,0.14)]'
                          : 'shrink-0 overflow-hidden',
                      )}
                      key={section.key}
                    >
                      <div
                        className={cn(
                          'flex w-full shrink-0 items-center transition',
                          isOpen
                            ? 'bg-white text-zinc-950'
                            : 'bg-[rgba(241,243,246,0.95)] text-zinc-950 hover:bg-white',
                        )}
                      >
                        <button
                          className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3 py-2.5 text-left transition"
                          onClick={() => toggleSection(section.key)}
                          type="button"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <div
                              className={cn(
                                'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl',
                                isOpen
                                  ? 'bg-zinc-950/6 text-zinc-700'
                                  : 'bg-zinc-950/8 text-zinc-700',
                              )}
                            >
                              {section.key === 'devices' ? (
                                <Link2 className="h-4 w-4" />
                              ) : section.key === 'groups' ? (
                                <Layers className="h-4 w-4" />
                              ) : (
                                <Sparkles className="h-4 w-4" />
                              )}
                            </div>
                            <span className="truncate text-sm font-medium">
                              {section.label}
                            </span>
                          </div>
                          <SectionChevron className="h-4 w-4 shrink-0 text-zinc-500" />
                        </button>
                        <button
                          aria-label={`${isRenderVisible ? 'Hide' : 'Show'} ${section.label.toLowerCase()} in render`}
                          aria-pressed={isRenderVisible}
                          className={cn(
                            'mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition',
                            isRenderVisible
                              ? 'border-black/8 bg-zinc-950/6 text-zinc-700 hover:bg-zinc-950/10'
                              : 'border-rose-500/25 bg-rose-500/14 text-rose-900 hover:bg-rose-500/20',
                          )}
                          onClick={() =>
                            setSmartHomeOverlaySectionVisible(
                              section.key,
                              !isRenderVisible,
                            )
                          }
                          title={`${isRenderVisible ? 'Hide' : 'Show'} ${section.label.toLowerCase()} in render`}
                          type="button"
                        >
                          <SectionVisibilityIcon className="h-4 w-4" />
                        </button>
                      </div>

                      {isOpen && (
                        <div
                          className={cn(
                            'min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-black/6 px-3 py-2.5 pr-1 [scrollbar-gutter:stable]',
                            section.key === 'devices'
                              ? 'flex flex-col gap-1.5'
                              : section.key === 'groups'
                                ? 'grid content-start grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-1.5'
                                : 'grid content-start gap-1.5 grid-cols-[repeat(auto-fit,minmax(13.5rem,1fr))]',
                          )}
                          data-smart-home-section-body
                          ref={section.key === 'devices' ? deviceSectionRef : undefined}
                        >
                          {section.key === 'devices' &&
                            deviceCategoryGroups.map(({ category, resources }) => {
                              const isCategoryOpen = openDeviceCategories[category]
                              const CategoryChevron = isCategoryOpen ? ChevronDown : ChevronRight

                              return (
                                <div
                                  className={cn(
                                    'rounded-xl bg-white/42',
                                    isCategoryOpen
                                      ? 'flex min-h-0 flex-1 basis-0 flex-col overflow-hidden'
                                      : 'shrink-0 overflow-hidden',
                                  )}
                                  key={category}
                                >
                                  <button
                                    className="flex h-10 w-full shrink-0 items-center justify-between gap-3 px-2.5 text-left text-zinc-950 transition hover:bg-white/55"
                                    onClick={() => toggleDeviceCategory(category)}
                                    type="button"
                                  >
                                    <div className="flex min-w-0 items-center gap-2.5">
                                      <div
                                        className={cn(
                                          'flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-lg',
                                          getDeviceCategoryTone(category),
                                        )}
                                      >
                                        {getDeviceCategoryIcon(category)}
                                      </div>
                                      <span className="truncate text-sm font-semibold">
                                        {DEVICE_CATEGORY_LABELS[category]} ({resources.length})
                                      </span>
                                    </div>
                                    <CategoryChevron className="h-4 w-4 shrink-0 text-zinc-500" />
                                  </button>

                                  {isCategoryOpen && (
                                    <div
                                      className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,112px)] gap-1.5 overflow-y-auto overscroll-contain border-black/6 border-t bg-white/28 px-2 py-2 [scrollbar-gutter:stable]"
                                      data-smart-home-scroll-body
                                    >
                                      {resources.map((resource) =>
                                        renderResourceRow('devices', resource),
                                      )}
                                    </div>
                                  )}
                                </div>
                              )
                            })}

                          {section.key !== 'devices' &&
                            section.resources.map((resource) => renderResourceRow(section.key, resource))}

                          {false && section.key === 'devices' && (
                            <div
                              className="relative"
                              style={{
                                height: packedDeviceLayout.height,
                                minWidth: packedDeviceLayout.width,
                                width: '100%',
                              }}
                            >
                              <svg
                                aria-hidden="true"
                                className="pointer-events-none absolute top-0 left-0 overflow-visible"
                                height={packedDeviceLayout.contentHeight}
                                viewBox={`0 0 ${packedDeviceLayout.width} ${packedDeviceLayout.contentHeight}`}
                                width={packedDeviceLayout.width}
                              >
                                {packedDeviceLayout.groups.flatMap((deviceGroup) =>
                                  deviceGroup.coordinates.map((coordinate) => (
                                    <rect
                                      fill={deviceGroup.color.background}
                                      height={DEVICE_GROUP_CELL_HEIGHT}
                                      key={`${deviceGroup.group?.id ?? UNGROUPED_DEVICE_GROUP_KEY}:${coordinate.x}:${coordinate.y}`}
                                      width={DEVICE_GROUP_CELL_WIDTH}
                                      x={coordinate.x * DEVICE_GROUP_CELL_WIDTH}
                                      y={coordinate.y * DEVICE_GROUP_CELL_HEIGHT}
                                    />
                                  )),
                                )}
                                {packedDeviceLayout.groups.map((deviceGroup) => (
                                  <path
                                    d={deviceGroup.borderPath}
                                    fill="none"
                                    key={deviceGroup.group?.id ?? UNGROUPED_DEVICE_GROUP_KEY}
                                    stroke={deviceGroup.color.border}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth="1.4"
                                  />
                                ))}
                              </svg>
                              {packedDeviceLayout.groups.map((deviceGroup) => {
                                const primaryGroupId = deviceGroup.group?.id ?? null
                                const labelCoordinate = deviceGroup.coordinates[0]

                                if (!labelCoordinate) {
                                  return null
                                }

                                return (
                                  <Fragment
                                    key={deviceGroup.group?.id ?? UNGROUPED_DEVICE_GROUP_KEY}
                                  >
                                  <div
                                    className="absolute flex h-10 items-center gap-1.5 rounded-xl px-2.5 py-2.5 text-[0.68rem] font-semibold tracking-[0.08em] text-zinc-700 uppercase"
                                    style={{
                                      left:
                                        labelCoordinate.x * DEVICE_GROUP_CELL_WIDTH +
                                        (DEVICE_GROUP_CELL_WIDTH - DEVICE_GROUP_CHIP_WIDTH) / 2,
                                      top:
                                        labelCoordinate.y * DEVICE_GROUP_CELL_HEIGHT +
                                        (DEVICE_GROUP_CELL_HEIGHT - DEVICE_GROUP_CHIP_HEIGHT) / 2,
                                      width: DEVICE_GROUP_CHIP_WIDTH,
                                    }}
                                  >
                                    <span
                                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                                      style={{ backgroundColor: deviceGroup.color.dot }}
                                    />
                                    <span className="truncate">
                                      {deviceGroup.group?.label ?? 'Other'}
                                    </span>
                                  </div>
                                  {deviceGroup.resources.map((resource, resourceIndex) => {
                                    const coordinate =
                                      deviceGroup.coordinates[resourceIndex + 1]
                                    const membershipDots = (
                                      deviceGroupMemberships.get(resource.id) ?? []
                                    )
                                      .filter((group) => group.id !== primaryGroupId)
                                      .map((group) => ({
                                        color: groupColorById.get(group.id)?.dot ?? '#71717a',
                                        id: group.id,
                                        label: group.label,
                                      }))

                                    if (!coordinate) {
                                      return null
                                    }

                                    return (
                                      <div
                                        className="absolute"
                                        key={resource.id}
                                        style={{
                                          left:
                                            coordinate.x * DEVICE_GROUP_CELL_WIDTH +
                                            (DEVICE_GROUP_CELL_WIDTH - DEVICE_GROUP_CHIP_WIDTH) / 2,
                                          top:
                                            coordinate.y * DEVICE_GROUP_CELL_HEIGHT +
                                            (DEVICE_GROUP_CELL_HEIGHT - DEVICE_GROUP_CHIP_HEIGHT) / 2,
                                        }}
                                      >
                                        {renderResourceRow('devices', resource, membershipDots)}
                                      </div>
                                    )
                                  })}
                                  </Fragment>
                                )
                              })}
                            </div>
                          )}

                          {false && section.key !== 'devices' && section.resources.map((resource) => {
                            const owner = resourceOwners.get(resource.id)
                            const isBoundToCurrent =
                              Boolean(owner) && owner?.collectionId === selectedCollection?.id
                            const isBoundElsewhere =
                              Boolean(owner) && owner?.collectionId !== selectedCollection?.id
                            const isPairing = pairingResourceId === resource.id
                            const canBind = false
                            const canPosition = section.key === 'groups'
                            const ownerCollection = owner ? collections[owner.collectionId] : null
                            const canPreview = Boolean(ownerCollection) && canBind
                            const isClickable =
                              canPreview || (canBind && !isBoundElsewhere && !isBoundToCurrent)
                            const rowIsActive = isBoundToCurrent || (canPosition && Boolean(owner))
                            const isRenaming = renamingResourceId === resource.id

                            return (
                              <div
                                className={cn(
                                  'flex min-h-10 w-full items-center gap-2 rounded-xl px-3 py-2.5 transition',
                                  isPairing
                                    ? 'bg-amber-300/42 text-zinc-950 hover:bg-amber-300/58'
                                    : rowIsActive
                                      ? 'bg-cyan-300/42 text-zinc-950 hover:bg-cyan-300/58'
                                      : isBoundElsewhere
                                        ? 'bg-emerald-300/38 text-zinc-950 hover:bg-emerald-300/54'
                                        : 'bg-white/68 text-zinc-950 hover:bg-white',
                                )}
                                key={resource.id}
                              >
                                {isRenaming ? (
                                  <div className="flex min-w-0 flex-1 items-center gap-3">
                                    <div className={cn('shrink-0', getResourceAccentClasses(resource))}>
                                      {getResourceTypeIcon(resource)}
                                    </div>
                                    <input
                                      aria-label={`New name for ${resource.label}`}
                                      className="min-w-0 flex-1 rounded-lg border border-cyan-700/24 bg-white/78 px-2 py-1.5 text-sm font-medium text-zinc-950 outline-none transition focus:border-cyan-700/45"
                                      onChange={(event) => setRenameDraft(event.target.value)}
                                      onClick={(event) => event.stopPropagation()}
                                      onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                          event.preventDefault()
                                          applyGroupRename(resource)
                                          return
                                        }
                                        if (event.key === 'Escape') {
                                          event.preventDefault()
                                          cancelGroupRename()
                                        }
                                      }}
                                      ref={renameInputRef}
                                      value={renameDraft}
                                    />
                                  </div>
                                ) : (
                                  <button
                                    className={cn(
                                      'flex min-w-0 flex-1 items-center justify-between gap-3 text-left outline-none transition focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
                                      isClickable
                                        ? 'cursor-pointer hover:opacity-100'
                                        : 'cursor-default opacity-90',
                                    )}
                                  disabled={!isClickable}
                                  onMouseEnter={() => {
                                    if (ownerCollection && canBind) {
                                      const targetNodeIds = ownerCollection.nodeIds.filter((nodeId) =>
                                        Boolean(sceneNodes[nodeId as AnyNodeId]),
                                      )
                                      if (targetNodeIds.length > 0) {
                                        const focusNodeId =
                                          ownerCollection.controlNodeId ?? targetNodeIds[0]
                                        setHoveredId((focusNodeId as AnyNodeId | undefined) ?? null)
                                        setHoveredIds(targetNodeIds as AnyNodeId[])
                                      }
                                    }
                                  }}
                                  onMouseLeave={clearPreviewedCollection}
                                  onClick={() => {
                                    if (ownerCollection && canBind) {
                                      previewCollection(ownerCollection)
                                      return
                                    }
                                    if (!canBind) {
                                      return
                                    }
                                    if (selectedItems.length > 0) {
                                      bindResourceToItems(resource, selectedItems)
                                      return
                                    }

                                    startPairing(resource.id)
                                  }}
                                  type="button"
                                >
                                  <div className="flex min-w-0 items-center gap-3">
                                    <div className={cn('shrink-0', getResourceAccentClasses(resource))}>
                                      {getResourceTypeIcon(resource)}
                                    </div>
                                      <span className="truncate text-sm font-medium text-zinc-950">
                                      {resource.label}
                                    </span>
                                  </div>
                                  {isPairing && (
                                    <Sparkles className="h-4 w-4 shrink-0 text-amber-200" />
                                  )}
                                  </button>
                                )}

                                {owner && ownerCollection && canBind && (
                                  <button
                                    aria-label={`Unbind ${resource.label} from ${owner.collectionName}`}
                                    className="flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-lg bg-rose-500/16 text-rose-900 outline-none transition hover:bg-rose-500/24 focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
                                    onClick={() => {
                                      unbindResourceFromCollection(ownerCollection, resource.id)
                                    }}
                                    type="button"
                                  >
                                    <Unlink className="h-3.5 w-3.5" />
                                  </button>
                                )}

                                {!owner && !isPairing && canBind && (
                                  <button
                                    aria-label={`Bind ${resource.label}`}
                                    className="flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-lg bg-emerald-500/16 text-emerald-900 outline-none transition hover:bg-emerald-500/24 focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
                                    onClick={() => {
                                      if (selectedItems.length > 0) {
                                        bindResourceToItems(resource, selectedItems)
                                        return
                                      }

                                      startPairing(resource.id)
                                    }}
                                    type="button"
                                  >
                                    <Link2 className="h-3.5 w-3.5" />
                                  </button>
                                )}

                                {canPosition && (
                                  <>
                                    <button
                                      aria-label={`${owner ? 'Reposition' : 'Position'} ${resource.label}`}
                                      className="flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-lg bg-cyan-600/14 text-cyan-950 outline-none transition hover:bg-cyan-600/24 focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
                                      onClick={() => startGroupPositioning(resource)}
                                      type="button"
                                    >
                                      <MapPin className="h-3.5 w-3.5" />
                                    </button>
                                    {isRenaming ? (
                                      <>
                                        <button
                                          aria-label={`Save ${resource.label} name`}
                                          className="flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-lg bg-emerald-500/16 text-emerald-900 outline-none transition hover:bg-emerald-500/24 focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
                                          onClick={() => applyGroupRename(resource)}
                                          type="button"
                                        >
                                          <Check className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                          aria-label={`Cancel renaming ${resource.label}`}
                                          className="flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-lg bg-zinc-950/8 text-zinc-800 outline-none transition hover:bg-zinc-950/14 focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
                                          onClick={cancelGroupRename}
                                          type="button"
                                        >
                                          <X className="h-3.5 w-3.5" />
                                        </button>
                                      </>
                                    ) : (
                                      <button
                                        aria-label={`Rename ${resource.label}`}
                                        className={cn(
                                          'flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-lg bg-zinc-950/8 text-zinc-800 outline-none transition focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
                                          owner
                                            ? 'hover:bg-zinc-950/14'
                                            : 'cursor-not-allowed opacity-35',
                                        )}
                                        disabled={!owner}
                                        onClick={() => startGroupRename(resource)}
                                        type="button"
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                      </button>
                                    )}
                                    <button
                                      aria-label={`Delete ${resource.label}`}
                                      className={cn(
                                        'flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-lg bg-rose-500/14 text-rose-900 outline-none transition focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
                                        owner
                                          ? 'hover:bg-rose-500/24'
                                          : 'cursor-not-allowed opacity-35',
                                      )}
                                      disabled={!owner}
                                      onClick={() => deleteGroupResource(resource)}
                                      type="button"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </>
                                )}
                              </div>
                            )
                          })}

                          {!isRefreshingImports && section.resources.length === 0 && (
                            <div className="col-span-full rounded-xl border border-dashed border-black/8 bg-white/42 px-3 py-3.5 text-center text-xs text-zinc-500">
                              {section.key === 'devices'
                                ? 'No devices found'
                                : section.key === 'groups'
                                  ? 'No groups found'
                                  : 'No actions found'}
                            </div>
                          )}

                          {section.key === 'groups' && (
                            <button
                              aria-label="Create Pascal group"
                              className="flex h-10 w-full items-center justify-center rounded-xl bg-white/68 text-zinc-800 outline-none transition hover:bg-white focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
                              onClick={createNewPascalGroup}
                              type="button"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {activePanel.kind === 'config' && (
            <button
              aria-label="Resize smart home panel"
              className="absolute bottom-0 left-0 z-10 flex h-8 w-8 cursor-nesw-resize touch-none items-end justify-start rounded-tr-xl border-black/8 bg-white/50 p-1.5 text-zinc-600 transition hover:bg-white/80"
              onPointerDown={handlePanelResizePointerDown}
              type="button"
            >
              <span
                aria-hidden="true"
                className="h-3 w-3 rounded-bl-[3px] border-zinc-500/70 border-b-2 border-l-2"
              />
            </button>
          )}
        </section>
      )}
      </div>
    </>
  )

  if (!portalRoot) {
    return null
  }

  return createPortal(panelContent, portalRoot)
}
