import type {
  HassActionConfig,
  HomeAssistantLike,
  ResourceStateSummary,
} from './types'
import type {
  HomeAssistantAction,
  HomeAssistantActionRequest,
  HomeAssistantCollectionBinding,
  HomeAssistantResourceBinding,
} from '@pascal-app/core'
import { getResourceEntityIds, summarizeResourceState } from './artifact'

type CardActionTarget = {
  binding: HomeAssistantCollectionBinding
  element: HTMLElement
  hass: HomeAssistantLike
  resource?: HomeAssistantResourceBinding | null
}

type RangeCapability = Extract<HomeAssistantActionRequest, { kind: 'range' }>['capability']

function splitServiceName(name: string | undefined) {
  if (!name) {
    return null
  }
  const [domain, service] = name.split('.', 2)
  return domain && service ? { domain, service } : null
}

function findAction(
  resource: HomeAssistantResourceBinding,
  predicate: (action: HomeAssistantAction) => boolean,
) {
  return resource.actions.find(predicate) ?? null
}

function findActionForCapability(
  resource: HomeAssistantResourceBinding,
  capability: RangeCapability,
) {
  return (
    findAction(resource, (action) => action.capability === capability) ??
    findAction(resource, (action) =>
      (action.fields ?? []).some((field) => {
        switch (capability) {
          case 'brightness':
            return field.key === 'brightness_pct' || field.key === 'brightness'
          case 'speed':
            return field.key === 'percentage'
          case 'temperature':
            return field.key === 'temperature'
          case 'volume':
            return field.key === 'volume_level'
          default:
            return false
        }
      }),
    )
  )
}

function getDefaultAction(resource: HomeAssistantResourceBinding) {
  return (
    resource.actions.find((action) => action.key === resource.defaultActionKey) ??
    resource.actions.find((action) => action.service === 'toggle') ??
    resource.actions[0] ??
    null
  )
}

function resolveToggleAction(
  resource: HomeAssistantResourceBinding,
  desiredOn: boolean | null,
) {
  if (desiredOn === null) {
    return (
      findAction(resource, (action) => action.service === 'toggle') ??
      getDefaultAction(resource)
    )
  }

  return (
    findAction(resource, (action) => action.service === (desiredOn ? 'turn_on' : 'turn_off')) ??
    findAction(resource, (action) => action.service === 'toggle') ??
    getDefaultAction(resource)
  )
}

function getServiceData(
  resource: HomeAssistantResourceBinding,
  state: ResourceStateSummary,
  action: HomeAssistantAction,
  extraData: Record<string, unknown> = {},
) {
  const entityIds = getResourceEntityIds(resource)
  const entityTarget =
    entityIds.length === 0 ? undefined : entityIds.length === 1 ? entityIds[0] : entityIds
  const acceptsBrightnessPct = (action.fields ?? []).some((field) => field.key === 'brightness_pct')
  return {
    ...(entityTarget ? { entity_id: entityTarget } : {}),
    ...(acceptsBrightnessPct && typeof state.brightnessPct === 'number'
      ? { brightness_pct: state.brightnessPct }
      : {}),
    ...extraData,
  }
}

function getRangeServiceData(action: HomeAssistantAction, request: HomeAssistantActionRequest) {
  if (request.kind !== 'range') {
    return {}
  }
  const fieldKeys = new Set((action.fields ?? []).map((field) => field.key))

  switch (request.capability) {
    case 'brightness':
      if (fieldKeys.has('brightness_pct')) {
        return { brightness_pct: request.value }
      }
      return fieldKeys.has('brightness') ? { brightness: Math.round((request.value / 100) * 255) } : {}
    case 'speed':
      return fieldKeys.has('percentage') ? { percentage: request.value } : {}
    case 'temperature':
      return fieldKeys.has('temperature') ? { temperature: request.value } : {}
    case 'volume':
      return fieldKeys.has('volume_level') ? { volume_level: request.value / 100 } : {}
    default:
      return {}
  }
}

export async function runResourceDefaultAction({
  desiredOn,
  hass,
  resource,
}: {
  desiredOn?: boolean | null
  hass: HomeAssistantLike
  resource: HomeAssistantResourceBinding
}) {
  const action =
    resource.kind === 'entity'
      ? resolveToggleAction(resource, desiredOn ?? null)
      : getDefaultAction(resource)
  if (!action) {
    throw new Error(`No action is available for ${resource.label || resource.id}.`)
  }

  const state = summarizeResourceState(hass, resource)
  await hass.callService(action.domain, action.service, getServiceData(resource, state, action))
}

export async function runBindingDefaultAction({
  binding,
  hass,
}: {
  binding: HomeAssistantCollectionBinding
  hass: HomeAssistantLike
}) {
  const resources = binding.resources ?? []
  if (resources.length === 0) {
    throw new Error('Pascal binding has no Home Assistant resources.')
  }

  const primary =
    resources.find((resource) => resource.id === binding.primaryResourceId) ?? resources[0]
  const current = primary ? summarizeResourceState(hass, primary) : null
  const desiredOn = current ? !current.isOn : null

  await Promise.all(
    resources.map((resource) =>
      runResourceDefaultAction({
        desiredOn,
        hass,
        resource,
      }),
    ),
  )
}

export async function runHomeAssistantActionRequest({
  binding,
  hass,
  request,
}: {
  binding: HomeAssistantCollectionBinding
  hass: HomeAssistantLike
  request: HomeAssistantActionRequest
}) {
  const resources = binding.resources ?? []
  if (resources.length === 0) {
    throw new Error('Pascal binding has no Home Assistant resources.')
  }

  if (request.kind === 'toggle') {
    await Promise.all(
      resources.map((resource) =>
        runResourceDefaultAction({
          desiredOn: request.value,
          hass,
          resource,
        }),
      ),
    )
    return
  }

  if (request.kind === 'trigger') {
    await runBindingDefaultAction({ binding, hass })
    return
  }

  await Promise.all(
    resources.map(async (resource) => {
      const action = findActionForCapability(resource, request.capability)
      if (!action) {
        return
      }
      const state = summarizeResourceState(hass, resource)
      await hass.callService(
        action.domain,
        action.service,
        getServiceData(resource, state, action, getRangeServiceData(action, request)),
      )
    }),
  )
}

function fireHassEvent(element: HTMLElement, type: string, detail: Record<string, unknown>) {
  const event = new CustomEvent(type, {
    bubbles: true,
    cancelable: false,
    composed: true,
    detail,
  })
  element.dispatchEvent(event)
}

export async function runHassActionConfig(
  action: HassActionConfig | undefined,
  target: CardActionTarget,
) {
  const normalizedAction = action?.action ?? 'toggle'
  const resource =
    target.resource ??
    target.binding.resources.find((candidate) => candidate.id === target.binding.primaryResourceId) ??
    target.binding.resources[0] ??
    null
  const entityId = action?.entity ?? resource?.entityId ?? resource?.memberEntityIds?.[0]

  if (normalizedAction === 'none') {
    return
  }

  if (normalizedAction === 'more-info') {
    if (entityId) {
      fireHassEvent(target.element, 'hass-more-info', { entityId })
    }
    return
  }

  if (normalizedAction === 'toggle') {
    await runBindingDefaultAction({ binding: target.binding, hass: target.hass })
    return
  }

  if (normalizedAction === 'perform-action') {
    const split = splitServiceName(action?.perform_action ?? action?.service)
    if (!split) {
      throw new Error('perform-action requires a domain.service action name.')
    }
    await target.hass.callService(split.domain, split.service, action?.data ?? {}, action?.target)
    return
  }

  if (normalizedAction === 'navigate' && action?.navigation_path) {
    history.pushState(null, '', action.navigation_path)
    window.dispatchEvent(new CustomEvent('location-changed'))
    return
  }

  if (normalizedAction === 'url' && action?.url_path) {
    window.open(action.url_path, '_blank', 'noopener,noreferrer')
  }
}
