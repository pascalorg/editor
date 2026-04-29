import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import type { CollectionId } from '../collections'
import type { AnyNode, AnyNodeId } from '../types'

export const HOME_ASSISTANT_RTS_PILL_WORLD_HEIGHT = 3.5

export type HomeAssistantCollectionCapability =
  | 'brightness'
  | 'media'
  | 'power'
  | 'speed'
  | 'temperature'
  | 'trigger'
  | 'volume'

export type HomeAssistantResourceKind = 'automation' | 'entity' | 'scene' | 'script'

export type HomeAssistantBindingAggregation =
  | 'all'
  | 'any_on'
  | 'primary'
  | 'single'
  | 'trigger_only'

const HOME_ASSISTANT_BINDING_AGGREGATIONS = [
  'all',
  'any_on',
  'primary',
  'single',
  'trigger_only',
] as const satisfies HomeAssistantBindingAggregation[]

const homeAssistantActionFieldSchema = z.object({
  defaultValue: z.unknown().optional(),
  key: z.string(),
  label: z.string(),
  required: z.boolean(),
  selector: z.record(z.string(), z.unknown()).nullable().optional(),
})

const homeAssistantActionSchema = z.object({
  capability: z.enum([
    'brightness',
    'media',
    'power',
    'speed',
    'temperature',
    'trigger',
    'volume',
  ] satisfies HomeAssistantCollectionCapability[]),
  domain: z.string(),
  fields: z.array(homeAssistantActionFieldSchema).optional(),
  key: z.string(),
  label: z.string(),
  service: z.string(),
})

const homeAssistantResourceBindingSchema = z.object({
  actions: z.array(homeAssistantActionSchema).default([]),
  capabilities: z.array(
    z.enum([
      'brightness',
      'media',
      'power',
      'speed',
      'temperature',
      'trigger',
      'volume',
    ] satisfies HomeAssistantCollectionCapability[]),
  ),
  defaultActionKey: z.string().nullable().optional(),
  entityId: z.string().nullable().optional(),
  id: z.string(),
  isGroup: z.boolean().optional(),
  kind: z.enum(['automation', 'entity', 'scene', 'script'] satisfies HomeAssistantResourceKind[]),
  label: z.string(),
  memberEntityIds: z.array(z.string()).optional(),
})

const homeAssistantRoomControlGroupSchema = z.object({
  memberResourceIds: z.array(z.string()),
})

const homeAssistantRoomControlCompositionSchema = z.object({
  excludedResourceIds: z.array(z.string()).optional(),
  groups: z.array(homeAssistantRoomControlGroupSchema).optional(),
  mode: z.enum(['ha-derived', 'user-managed']).optional(),
})

const homeAssistantBindingPresentationSchema = z.object({
  icon: z.string().optional(),
  label: z.string().optional(),
  rtsHidden: z.boolean().optional(),
  rtsRoomControls: homeAssistantRoomControlCompositionSchema.optional(),
  rtsOrder: z.number().optional(),
  rtsScreenPosition: z
    .object({
      x: z.number(),
      y: z.number(),
    })
    .optional(),
  rtsWorldPosition: z
    .object({
      x: z.number(),
      y: z.number(),
      z: z.number(),
    })
    .optional(),
})

const homeAssistantCollectionBindingSchema = z.object({
  aggregation: z.enum(HOME_ASSISTANT_BINDING_AGGREGATIONS),
  collectionId: z.custom<CollectionId>(),
  presentation: homeAssistantBindingPresentationSchema.optional(),
  primaryResourceId: z.string().nullable().optional(),
  resources: z.array(homeAssistantResourceBindingSchema),
})

export type HomeAssistantActionField = z.infer<typeof homeAssistantActionFieldSchema>
export type HomeAssistantAction = z.infer<typeof homeAssistantActionSchema>
export type HomeAssistantResourceBinding = z.infer<typeof homeAssistantResourceBindingSchema>
export type HomeAssistantRoomControlGroup = z.infer<typeof homeAssistantRoomControlGroupSchema>
export type HomeAssistantRoomControlComposition = z.infer<
  typeof homeAssistantRoomControlCompositionSchema
>
export type HomeAssistantBindingPresentation = z.infer<
  typeof homeAssistantBindingPresentationSchema
>
export type HomeAssistantCollectionBinding = z.infer<typeof homeAssistantCollectionBindingSchema>
export type HomeAssistantCollectionBindingMap = Record<CollectionId, HomeAssistantCollectionBinding>

type LegacyHomeAssistantRoomControlComposition = Omit<
  HomeAssistantRoomControlComposition,
  'groups'
> & {
  groups?: Array<HomeAssistantRoomControlGroup & { id?: string }>
}

type LegacyHomeAssistantBindingPresentation = HomeAssistantBindingPresentation & {
  rtsExcludedResourceIds?: string[]
  rtsGroups?: string[][]
  rtsRoomControls?: LegacyHomeAssistantRoomControlComposition
}

export const HomeAssistantBindingNode = BaseNode.extend({
  id: objectId('ha-binding'),
  type: nodeType('home-assistant-binding'),
  aggregation: z.enum(HOME_ASSISTANT_BINDING_AGGREGATIONS).default('single'),
  collectionId: z.custom<CollectionId>(),
  presentation: homeAssistantBindingPresentationSchema.optional(),
  primaryResourceId: z.string().nullable().optional(),
  resources: z.array(homeAssistantResourceBindingSchema).default([]),
})

export type HomeAssistantBindingNode = z.infer<typeof HomeAssistantBindingNode>
export type HomeAssistantBindingNodeId = HomeAssistantBindingNode['id']
export type HomeAssistantBindingNodeMap = Record<CollectionId, HomeAssistantBindingNode>

export type HomeAssistantActionRequest =
  | {
      capability: Extract<
        HomeAssistantCollectionCapability,
        'brightness' | 'speed' | 'temperature' | 'volume'
      >
      kind: 'range'
      value: number
    }
  | {
      kind: 'toggle'
      value: boolean
    }
  | {
      kind: 'trigger'
    }

const dedupeStringArray = <T extends string>(values: T[] | undefined) =>
  Array.from(new Set((values ?? []).filter((value): value is T => typeof value === 'string')))

const normalizeAction = (action: HomeAssistantAction): HomeAssistantAction | null => {
  if (!(action && typeof action === 'object')) {
    return null
  }

  if (
    typeof action.key !== 'string' ||
    typeof action.label !== 'string' ||
    typeof action.domain !== 'string' ||
    typeof action.service !== 'string' ||
    typeof action.capability !== 'string'
  ) {
    return null
  }

  return {
    capability: action.capability,
    domain: action.domain,
    fields: Array.isArray(action.fields)
      ? action.fields
          .filter((field): field is HomeAssistantActionField =>
            Boolean(
              field &&
                typeof field === 'object' &&
                typeof field.key === 'string' &&
                typeof field.label === 'string' &&
                typeof field.required === 'boolean',
            ),
          )
          .map((field) => ({
            defaultValue: field.defaultValue,
            key: field.key,
            label: field.label,
            required: field.required,
            selector:
              field.selector && typeof field.selector === 'object' && !Array.isArray(field.selector)
                ? field.selector
                : null,
          }))
      : [],
    key: action.key,
    label: action.label,
    service: action.service,
  }
}

const normalizeResource = (
  resource: HomeAssistantResourceBinding,
): HomeAssistantResourceBinding | null => {
  if (!(resource && typeof resource === 'object')) {
    return null
  }

  if (
    typeof resource.id !== 'string' ||
    typeof resource.kind !== 'string' ||
    typeof resource.label !== 'string'
  ) {
    return null
  }

  const memberEntityIds = dedupeStringArray(resource.memberEntityIds)
  const isGroup = resource.isGroup === true || memberEntityIds.length > 0

  return {
    actions: Array.isArray(resource.actions)
      ? resource.actions
          .map((action) => normalizeAction(action))
          .filter((action): action is HomeAssistantAction => Boolean(action))
      : [],
    capabilities: dedupeStringArray(resource.capabilities),
    defaultActionKey:
      typeof resource.defaultActionKey === 'string' ? resource.defaultActionKey : null,
    entityId: typeof resource.entityId === 'string' ? resource.entityId : null,
    id: resource.id,
    ...(isGroup ? { isGroup, memberEntityIds } : {}),
    kind: resource.kind,
    label: resource.label,
  }
}

const clampUnit = (value: number) => Math.max(0, Math.min(1, value))

const normalizeAggregation = (value: unknown): HomeAssistantBindingAggregation =>
  HOME_ASSISTANT_BINDING_AGGREGATIONS.includes(value as HomeAssistantBindingAggregation)
    ? (value as HomeAssistantBindingAggregation)
    : 'single'

const normalizeStringGroups = (groups: unknown) =>
  Array.isArray(groups)
    ? groups
        .filter(Array.isArray)
        .map((group) =>
          group.filter((memberId): memberId is string => typeof memberId === 'string'),
        )
        .filter((group) => group.length > 0)
    : undefined

const getRoomControlMemberResourceId = (collectionId: CollectionId, memberId: string) => {
  const prefix = `${collectionId}:home-assistant:`
  if (!memberId.startsWith(prefix)) {
    return null
  }

  const encodedResourceId = memberId.slice(prefix.length).replace(/:\d+$/, '')
  try {
    return decodeURIComponent(encodedResourceId)
  } catch {
    return encodedResourceId
  }
}

const getLegacyRoomControlMemberId = (collectionId: CollectionId, resourceId: string) =>
  `${collectionId}:home-assistant:${resourceId.replace(/[^a-zA-Z0-9_-]/g, '-')}`

const normalizeRoomControlComposition = ({
  collectionId,
  presentation,
  resources,
}: {
  collectionId: CollectionId
  presentation: LegacyHomeAssistantBindingPresentation | undefined
  resources: HomeAssistantResourceBinding[]
}): HomeAssistantRoomControlComposition | undefined => {
  const resourceIds = new Set(resources.map((resource) => resource.id))
  const resourceAliases = new Map<string, string>()
  for (const resource of resources) {
    const currentMemberId = `${collectionId}:home-assistant:${encodeURIComponent(resource.id)}`
    const legacyMemberId = getLegacyRoomControlMemberId(collectionId, resource.id)
    resourceAliases.set(currentMemberId, resource.id)
    resourceAliases.set(legacyMemberId, resource.id)
  }
  const existingComposition = presentation?.rtsRoomControls
  const rawGroups =
    existingComposition?.groups?.map((group) => group.memberResourceIds) ??
    normalizeStringGroups(presentation?.rtsGroups) ??
    []
  const groups = rawGroups
    .map((group, index) => {
      const memberResourceIds = Array.from(
        new Set(
          group
            .map((memberId) => {
              if (resourceIds.has(memberId)) {
                return memberId
              }
              const canonicalMemberId = memberId.replace(/:\d+$/, '')
              return (
                resourceAliases.get(memberId) ??
                resourceAliases.get(canonicalMemberId) ??
                getRoomControlMemberResourceId(collectionId, memberId)
              )
            })
            .filter((resourceId): resourceId is string =>
              Boolean(resourceId && resourceIds.has(resourceId)),
            ),
        ),
      )

      return { memberResourceIds }
    })
    .filter((group) => group.memberResourceIds.length > 0)
  const excludedResourceIds = dedupeStringArray(
    existingComposition?.excludedResourceIds ?? presentation?.rtsExcludedResourceIds,
  )
  const mode =
    existingComposition?.mode === 'ha-derived' || existingComposition?.mode === 'user-managed'
      ? existingComposition.mode
      : undefined

  if (groups.length === 0 && excludedResourceIds.length === 0 && !mode) {
    return undefined
  }

  return {
    ...(excludedResourceIds.length > 0 ? { excludedResourceIds } : {}),
    ...(groups.length > 0 ? { groups } : {}),
    ...(mode ? { mode } : {}),
  }
}

export const normalizeHomeAssistantCollectionBinding = (
  binding: HomeAssistantCollectionBinding | Record<string, unknown>,
): HomeAssistantCollectionBinding | null => {
  if (!(binding && typeof binding === 'object')) {
    return null
  }

  const collectionId =
    typeof binding.collectionId === 'string' ? (binding.collectionId as CollectionId) : null
  if (!collectionId) {
    return null
  }

  const normalizedResources = Array.isArray(binding.resources)
    ? binding.resources
        .map((resource) => normalizeResource(resource))
        .filter((resource): resource is HomeAssistantResourceBinding => Boolean(resource))
    : []

  if (normalizedResources.length === 0) {
    return null
  }

  const presentation =
    binding.presentation &&
    typeof binding.presentation === 'object' &&
    !Array.isArray(binding.presentation)
      ? (binding.presentation as LegacyHomeAssistantBindingPresentation)
      : undefined

  return {
    aggregation: normalizeAggregation(binding.aggregation),
    collectionId,
    presentation: presentation
      ? {
          icon: typeof presentation.icon === 'string' ? presentation.icon : undefined,
          label: typeof presentation.label === 'string' ? presentation.label : undefined,
          rtsHidden: presentation.rtsHidden === true ? presentation.rtsHidden : undefined,
          rtsRoomControls: normalizeRoomControlComposition({
            collectionId,
            presentation,
            resources: normalizedResources,
          }),
          rtsOrder:
            typeof presentation.rtsOrder === 'number'
              ? presentation.rtsOrder
              : undefined,
          rtsScreenPosition:
            presentation.rtsScreenPosition &&
            typeof presentation.rtsScreenPosition.x === 'number' &&
            typeof presentation.rtsScreenPosition.y === 'number'
              ? {
                  x: clampUnit(presentation.rtsScreenPosition.x),
                  y: clampUnit(presentation.rtsScreenPosition.y),
                }
              : undefined,
          rtsWorldPosition:
            presentation.rtsWorldPosition &&
            typeof presentation.rtsWorldPosition.x === 'number' &&
            typeof presentation.rtsWorldPosition.y === 'number' &&
            typeof presentation.rtsWorldPosition.z === 'number'
              ? {
                  x: presentation.rtsWorldPosition.x,
                  y: presentation.rtsWorldPosition.y,
                  z: presentation.rtsWorldPosition.z,
                }
              : undefined,
        }
      : undefined,
    primaryResourceId:
      typeof binding.primaryResourceId === 'string'
        ? binding.primaryResourceId
        : (normalizedResources[0]?.id ?? null),
    resources: normalizedResources,
  }
}

export const createHomeAssistantBindingNode = ({
  binding,
  id,
  name,
}: {
  binding: HomeAssistantCollectionBinding
  id?: HomeAssistantBindingNodeId
  name?: string
}) => {
  const normalizedBinding = normalizeHomeAssistantCollectionBinding(binding)
  if (!normalizedBinding) {
    return null
  }

  return HomeAssistantBindingNode.parse({
    ...normalizedBinding,
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
  })
}

export const isHomeAssistantBindingNode = (
  node: AnyNode | null | undefined,
): node is HomeAssistantBindingNode => node?.type === 'home-assistant-binding'

export const getHomeAssistantBindingNodes = (nodes: Record<AnyNodeId, AnyNode>) =>
  Object.values(nodes).filter((node): node is HomeAssistantBindingNode =>
    isHomeAssistantBindingNode(node),
  )

export const getHomeAssistantBindingNodeMap = (
  nodes: Record<AnyNodeId, AnyNode>,
): HomeAssistantBindingNodeMap =>
  Object.fromEntries(
    getHomeAssistantBindingNodes(nodes).flatMap((node) =>
      node.resources.length > 0 ? [[node.collectionId, node]] : [],
    ),
  ) as HomeAssistantBindingNodeMap

export const getHomeAssistantBindingNodeForCollection = (
  nodes: Record<AnyNodeId, AnyNode>,
  collectionId: CollectionId,
) => getHomeAssistantBindingNodes(nodes).find((node) => node.collectionId === collectionId) ?? null

export const getHomeAssistantBindingNodeIdForCollection = (
  nodes: Record<AnyNodeId, AnyNode>,
  collectionId: CollectionId,
) => getHomeAssistantBindingNodeForCollection(nodes, collectionId)?.id ?? null

export const getHomeAssistantBindingCapabilities = (
  binding: HomeAssistantCollectionBinding | null | undefined,
) => new Set(binding?.resources.flatMap((resource) => resource.capabilities ?? []) ?? [])

export const hasHomeAssistantBinding = (
  binding: HomeAssistantCollectionBinding | null | undefined,
) => Boolean(binding?.resources?.length)

export const isHomeAssistantTriggerBinding = (
  binding: HomeAssistantCollectionBinding | null | undefined,
) =>
  binding?.aggregation === 'trigger_only' ||
  (hasHomeAssistantBinding(binding) &&
    getHomeAssistantBindingCapabilities(binding).has('trigger') &&
    !getHomeAssistantBindingCapabilities(binding).has('power'))

export const getHomeAssistantBindingDisplayLabel = (
  binding: HomeAssistantCollectionBinding | null | undefined,
  fallbackLabel: string,
) => binding?.presentation?.label?.trim() || fallbackLabel.trim() || 'Collection'
