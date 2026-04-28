import type {
  HomeAssistantAction,
  HomeAssistantCollectionCapability,
  HomeAssistantResourceKind,
} from '@pascal-app/core/schema'
import type { HomeAssistantImportedResource } from '../../../../packages/editor/src/lib/home-assistant-collections'
import {
  isHiddenHomeAssistantGroupResourceId,
  toImportedEntityResource,
} from '../../../../packages/editor/src/lib/home-assistant-collections'
import { discoverHomeAssistantDevices } from './home-assistant-discovery'
import type { HomeAssistantEntityState, HomeAssistantServerConfig } from './home-assistant-server'
import { listEntityStates } from './home-assistant-server'

const IMPORTABLE_TRIGGER_DOMAINS: Array<{
  capability: HomeAssistantCollectionCapability
  kind: HomeAssistantResourceKind
  service: string
  stateEntityDomain: string
}> = [
  {
    capability: 'trigger',
    kind: 'scene',
    service: 'turn_on',
    stateEntityDomain: 'scene',
  },
  {
    capability: 'trigger',
    kind: 'script',
    service: 'turn_on',
    stateEntityDomain: 'script',
  },
  {
    capability: 'trigger',
    kind: 'automation',
    service: 'trigger',
    stateEntityDomain: 'automation',
  },
]

function createTriggerAction(domain: string, label: string, service: string): HomeAssistantAction {
  return {
    capability: 'trigger',
    domain,
    fields: [],
    key: `${domain}.${service}`,
    label,
    service,
  }
}

function toTriggerResource(
  state: HomeAssistantEntityState,
  domainConfig: (typeof IMPORTABLE_TRIGGER_DOMAINS)[number],
): HomeAssistantImportedResource {
  const label =
    typeof state.attributes?.friendly_name === 'string' &&
    state.attributes.friendly_name.trim().length > 0
      ? state.attributes.friendly_name.trim()
      : state.entity_id

  return {
    actions: [createTriggerAction(domainConfig.stateEntityDomain, label, domainConfig.service)],
    capabilities: [domainConfig.capability],
    defaultActionKey: `${domainConfig.stateEntityDomain}.${domainConfig.service}`,
    description: `${domainConfig.kind} imported from Home Assistant`,
    domain: domainConfig.stateEntityDomain,
    entityId: state.entity_id,
    id: state.entity_id,
    kind: domainConfig.kind,
    label,
    state: state.state,
  }
}

function getTriggerResources(states: HomeAssistantEntityState[]) {
  return states.flatMap((state) => {
    const domain = state.entity_id.split('.')[0] ?? ''
    const domainConfig = IMPORTABLE_TRIGGER_DOMAINS.find(
      (entry) => entry.stateEntityDomain === domain,
    )
    if (!domainConfig) {
      return []
    }

    return [toTriggerResource(state, domainConfig)]
  })
}

function getMemberEntityIds(state: HomeAssistantEntityState | undefined) {
  const rawEntityIds =
    state?.attributes?.entity_id ?? state?.attributes?.entities ?? state?.attributes?.members
  const values = Array.isArray(rawEntityIds)
    ? rawEntityIds
    : typeof rawEntityIds === 'string'
      ? rawEntityIds.split(/[\s,]+/)
      : []

  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter((value) => /^[a-z0-9_]+\.[a-z0-9_]+$/i.test(value)),
    ),
  )
}

function isLikelyGroupEntity(
  resource: HomeAssistantImportedResource,
  state: HomeAssistantEntityState | undefined,
) {
  const label =
    typeof state?.attributes?.friendly_name === 'string'
      ? state.attributes.friendly_name
      : resource.label
  const haystack = `${resource.entityId ?? resource.id} ${label}`.toLowerCase()

  return /\b(group|all[_\s-]?lights|lights[_\s-]?all)\b/.test(haystack)
}

function applyGroupMetadata(
  resource: HomeAssistantImportedResource,
  statesByEntityId: Map<string, HomeAssistantEntityState>,
): HomeAssistantImportedResource {
  if (!(resource.kind === 'entity' && resource.entityId)) {
    return resource
  }

  const state = statesByEntityId.get(resource.entityId)
  const memberEntityIds = getMemberEntityIds(state)
  if (memberEntityIds.length === 0 && !isLikelyGroupEntity(resource, state)) {
    return resource
  }

  return {
    ...resource,
    description:
      memberEntityIds.length > 0
        ? `${resource.description}; ${memberEntityIds.length} grouped HA entities`
        : `${resource.description}; grouped HA entity`,
    isGroup: true,
    memberEntityIds,
  }
}

function isImportedDeviceResource(resource: HomeAssistantImportedResource) {
  return resource.kind === 'entity' && resource.isGroup !== true && Boolean(resource.entityId)
}

function removeHiddenGroupMembers(
  resources: HomeAssistantImportedResource[],
): HomeAssistantImportedResource[] {
  const importedDeviceEntityIds = new Set(
    resources
      .filter(isImportedDeviceResource)
      .map((resource) => resource.entityId)
      .filter((entityId): entityId is string => Boolean(entityId)),
  )

  return resources.map((resource) => {
    if (!(resource.kind === 'entity' && resource.isGroup === true)) {
      return resource
    }

    const memberEntityIds = (resource.memberEntityIds ?? []).filter((entityId) =>
      importedDeviceEntityIds.has(entityId),
    )

    return {
      ...resource,
      memberEntityIds,
    }
  })
}

export async function listImportableHomeAssistantResources(
  config: HomeAssistantServerConfig,
): Promise<HomeAssistantImportedResource[]> {
  const [devices, states] = await Promise.all([
    discoverHomeAssistantDevices(config),
    listEntityStates(config),
  ])
  const statesByEntityId = new Map(states.map((state) => [state.entity_id, state]))

  const resources = [
    ...devices
      .map((device) => toImportedEntityResource(device))
      .map((resource) => applyGroupMetadata(resource, statesByEntityId)),
    ...getTriggerResources(states),
  ]

  const uniqueResources = new Map<string, HomeAssistantImportedResource>()
  for (const resource of resources) {
    if (isHiddenHomeAssistantGroupResourceId(resource.id)) {
      continue
    }
    uniqueResources.set(resource.id, resource)
  }

  return removeHiddenGroupMembers(Array.from(uniqueResources.values())).sort((left, right) =>
    left.label.localeCompare(right.label),
  )
}
