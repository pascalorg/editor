import { generateId } from './base'
import type { AnyNodeId } from './types'

export type CollectionId = `collection_${string}`
export type CollectionKind = 'automation' | 'device' | 'group'
export type CollectionCapability =
  | 'brightness'
  | 'media'
  | 'power'
  | 'speed'
  | 'temperature'
  | 'trigger'
  | 'volume'
export type CollectionZoneId = `zone_${string}`
export type HomeAssistantResourceKind = 'automation' | 'entity' | 'scene' | 'script'
export type CollectionHomeAssistantAggregation =
  | 'all'
  | 'any_on'
  | 'primary'
  | 'single'
  | 'trigger_only'

export type CollectionHomeAssistantActionField = {
  defaultValue?: unknown
  key: string
  label: string
  required: boolean
  selector?: Record<string, unknown> | null
}

export type CollectionHomeAssistantAction = {
  capability: CollectionCapability
  domain: string
  fields?: CollectionHomeAssistantActionField[]
  key: string
  label: string
  service: string
}

export type CollectionHomeAssistantResourceBinding = {
  actions: CollectionHomeAssistantAction[]
  capabilities: CollectionCapability[]
  defaultActionKey?: string | null
  entityId?: string | null
  id: string
  kind: HomeAssistantResourceKind
  label: string
}

export type CollectionHomeAssistantBinding = {
  aggregation: CollectionHomeAssistantAggregation
  primaryResourceId?: string | null
  resources: CollectionHomeAssistantResourceBinding[]
}

export type CollectionHomeAssistantActionRequest =
  | {
      capability: Extract<CollectionCapability, 'brightness' | 'speed' | 'temperature' | 'volume'>
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

export type CollectionPresentation = {
  icon?: string
  label?: string
  rtsOrder?: number
}

export type Collection = {
  capabilities?: CollectionCapability[]
  id: CollectionId
  kind?: CollectionKind
  name: string
  color?: string
  nodeIds: AnyNodeId[]
  controlNodeId?: AnyNodeId
  homeAssistant?: CollectionHomeAssistantBinding
  presentation?: CollectionPresentation
  zoneIds?: CollectionZoneId[]
}

export const generateCollectionId = (): CollectionId => generateId('collection')

const COLLECTION_KIND_ORDER: CollectionKind[] = ['device', 'group', 'automation']

const dedupeStringArray = <T extends string>(values: T[] | undefined) =>
  Array.from(new Set((values ?? []).filter((value): value is T => typeof value === 'string')))

const normalizeAction = (
  action: CollectionHomeAssistantAction,
): CollectionHomeAssistantAction | null => {
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
          .filter(
            (field): field is CollectionHomeAssistantActionField =>
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
  resource: CollectionHomeAssistantResourceBinding,
): CollectionHomeAssistantResourceBinding | null => {
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

  return {
    actions: Array.isArray(resource.actions)
      ? resource.actions
          .map((action) => normalizeAction(action))
          .filter((action): action is CollectionHomeAssistantAction => Boolean(action))
      : [],
    capabilities: dedupeStringArray(resource.capabilities),
    defaultActionKey:
      typeof resource.defaultActionKey === 'string' ? resource.defaultActionKey : null,
    entityId: typeof resource.entityId === 'string' ? resource.entityId : null,
    id: resource.id,
    kind: resource.kind,
    label: resource.label,
  }
}

export const normalizeCollection = (collection: Collection): Collection => {
  const normalizedResources = Array.isArray(collection.homeAssistant?.resources)
    ? collection.homeAssistant.resources
        .map((resource) => normalizeResource(resource))
        .filter((resource): resource is CollectionHomeAssistantResourceBinding => Boolean(resource))
    : []
  const capabilities = dedupeStringArray([
    ...(collection.capabilities ?? []),
    ...normalizedResources.flatMap((resource) => resource.capabilities),
  ])
  const kind =
    collection.kind && COLLECTION_KIND_ORDER.includes(collection.kind)
      ? collection.kind
      : normalizedResources.some((resource) => resource.kind !== 'entity')
        ? 'automation'
        : collection.nodeIds.length > 1
          ? 'group'
          : 'device'

  return {
    ...collection,
    capabilities,
    controlNodeId:
      typeof collection.controlNodeId === 'string' && collection.nodeIds.includes(collection.controlNodeId)
        ? collection.controlNodeId
        : collection.nodeIds[0],
    homeAssistant:
      normalizedResources.length > 0
        ? {
            aggregation:
              collection.homeAssistant?.aggregation ?? (kind === 'automation' ? 'trigger_only' : 'single'),
            primaryResourceId:
              typeof collection.homeAssistant?.primaryResourceId === 'string'
                ? collection.homeAssistant.primaryResourceId
                : normalizedResources[0]?.id ?? null,
            resources: normalizedResources,
          }
        : undefined,
    kind,
    presentation:
      collection.presentation &&
      typeof collection.presentation === 'object' &&
      !Array.isArray(collection.presentation)
        ? {
            icon:
              typeof collection.presentation.icon === 'string' ? collection.presentation.icon : undefined,
            label:
              typeof collection.presentation.label === 'string'
                ? collection.presentation.label
                : undefined,
            rtsOrder:
              typeof collection.presentation.rtsOrder === 'number'
                ? collection.presentation.rtsOrder
                : undefined,
          }
        : undefined,
    zoneIds: dedupeStringArray(collection.zoneIds),
  }
}
