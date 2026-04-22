import type {
  CollectionCapability,
  CollectionHomeAssistantAction,
  HomeAssistantResourceKind,
} from '@pascal-app/core/schema'
import type { HomeAssistantImportedResource } from '../../../../packages/editor/src/lib/home-assistant-collections'
import { toImportedEntityResource } from '../../../../packages/editor/src/lib/home-assistant-collections'
import { discoverHomeAssistantDevices } from './home-assistant-discovery'
import type { HomeAssistantEntityState, HomeAssistantServerConfig } from './home-assistant-server'
import { listEntityStates } from './home-assistant-server'

const IMPORTABLE_TRIGGER_DOMAINS: Array<{
  capability: CollectionCapability
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

function createTriggerAction(
  domain: string,
  label: string,
  service: string,
): CollectionHomeAssistantAction {
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
    typeof state.attributes?.friendly_name === 'string' && state.attributes.friendly_name.trim().length > 0
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

export async function listImportableHomeAssistantResources(
  config: HomeAssistantServerConfig,
): Promise<HomeAssistantImportedResource[]> {
  const [devices, states] = await Promise.all([
    discoverHomeAssistantDevices(config),
    listEntityStates(config),
  ])

  const resources = [
    ...devices.map((device) => toImportedEntityResource(device)),
    ...getTriggerResources(states),
  ]

  const uniqueResources = new Map<string, HomeAssistantImportedResource>()
  for (const resource of resources) {
    uniqueResources.set(resource.id, resource)
  }

  return Array.from(uniqueResources.values()).sort((left, right) =>
    left.label.localeCompare(right.label),
  )
}
