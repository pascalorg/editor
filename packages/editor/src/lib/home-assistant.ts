import type { ItemNode } from '@pascal-app/core'

export const HOME_ASSISTANT_LINK_METADATA_KEY = 'homeAssistantLink'
export const PASCAL_HA_DEVICE_ACTION_REQUEST_EVENT = 'pascal:ha-device-action-request'

export type HomeAssistantDeviceProtocol = 'home-assistant' | 'mdns' | 'ssdp'
export type HomeAssistantCapabilityCategory = 'access' | 'audio' | 'other' | 'playback' | 'power'
export type HomeAssistantActionKind =
  | 'close'
  | 'connect'
  | 'custom'
  | 'lock'
  | 'next'
  | 'open'
  | 'pause'
  | 'play'
  | 'power'
  | 'previous'
  | 'stop'
  | 'turn_off'
  | 'turn_on'
  | 'unlock'
  | 'volume'
export type HomeAssistantActionIcon =
  | 'brightness'
  | 'clean_area'
  | 'clean_spot'
  | 'climate_mode'
  | 'close'
  | 'color'
  | 'color_temperature'
  | 'connect'
  | 'custom'
  | 'direction'
  | 'fan_mode'
  | 'group'
  | 'humidity'
  | 'locate'
  | 'lock'
  | 'next'
  | 'open'
  | 'pause'
  | 'play'
  | 'play_pause'
  | 'playlist_clear'
  | 'position'
  | 'position_stop'
  | 'power_toggle'
  | 'previous'
  | 'preset_mode'
  | 'repeat'
  | 'return_to_base'
  | 'search'
  | 'seek'
  | 'shuffle'
  | 'sound_mode'
  | 'speed'
  | 'speed_down'
  | 'speed_up'
  | 'start'
  | 'stop'
  | 'swing'
  | 'swing_horizontal'
  | 'temperature'
  | 'tilt_close'
  | 'tilt_open'
  | 'tilt_position'
  | 'tilt_stop'
  | 'toggle'
  | 'turn_off'
  | 'turn_on'
  | 'ungroup'
  | 'unlock'
  | 'volume_down'
  | 'volume_mute'
  | 'volume_set'
  | 'volume_up'

export type HomeAssistantServiceTargetFilter = {
  domain?: string[]
  supported_features?: Array<number | number[]>
}

export type HomeAssistantSelectorConfig = Record<string, unknown>

export type HomeAssistantAvailableActionField = {
  advanced: boolean
  defaultValue: unknown
  example: unknown
  filterAttribute: Record<string, unknown[]> | null
  filterSupportedFeatures: Array<number | number[]> | null
  key: string
  label: string
  required: boolean
  selector: HomeAssistantSelectorConfig | null
}

export type HomeAssistantAvailableAction = {
  actionKind: HomeAssistantActionKind
  description: string
  domain: string
  fields: HomeAssistantAvailableActionField[]
  key: string
  label: string
  service: string
}

export type HomeAssistantActionPresentation = {
  displayKey: string
  icon: HomeAssistantActionIcon
  label: string
}

export type HomeAssistantDiscoveredDevice = {
  actionable: boolean
  attributes: Record<string, unknown> | null
  availableActions: HomeAssistantAvailableAction[]
  enabledActionCategories: HomeAssistantCapabilityCategory[]
  defaultActionKey: string | null
  defaultServiceData: Record<string, unknown>
  description: string
  deviceType: string
  haEntityId: string | null
  id: string
  ip: string | null
  manufacturer: string | null
  model: string | null
  name: string
  protocol: HomeAssistantDeviceProtocol
  serviceType: string | null
  supportedFeatures: number | null
}

export type HomeAssistantLink = {
  actionKind: HomeAssistantActionKind
  actionLabel: string
  description: string
  deviceId: string
  deviceName: string
  deviceType: string
  enabledActionCategories: HomeAssistantCapabilityCategory[]
  haEntityId: string | null
  ip: string | null
  linkedAt: string
  manufacturer: string | null
  model: string | null
  protocol: HomeAssistantDeviceProtocol
  serviceData: Record<string, unknown>
  serviceDomain: string
  serviceName: string
  serviceType: string | null
}

export type PascalHaDeviceActionRequestDetail = {
  itemId: ItemNode['id']
  itemName: ItemNode['asset']['name']
  link: HomeAssistantLink
}

function isMetadataRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function normalizeActionKind(value: unknown): HomeAssistantActionKind | null {
  switch (value) {
    case 'close':
    case 'connect':
    case 'custom':
    case 'lock':
    case 'next':
    case 'open':
    case 'pause':
    case 'play':
    case 'power':
    case 'previous':
    case 'stop':
    case 'turn_off':
    case 'turn_on':
    case 'unlock':
    case 'volume':
      return value
    default:
      return null
  }
}

function normalizeCapabilityCategory(value: unknown): HomeAssistantCapabilityCategory | null {
  switch (value) {
    case 'access':
    case 'audio':
    case 'other':
    case 'playback':
    case 'power':
      return value
    default:
      return null
  }
}

export function getHomeAssistantCapabilityCategory(
  actionKind: HomeAssistantActionKind,
): HomeAssistantCapabilityCategory {
  switch (actionKind) {
    case 'turn_on':
    case 'turn_off':
    case 'power':
      return 'power'
    case 'play':
    case 'pause':
    case 'stop':
    case 'next':
    case 'previous':
    case 'connect':
      return 'playback'
    case 'volume':
      return 'audio'
    case 'lock':
    case 'unlock':
    case 'open':
    case 'close':
      return 'access'
    default:
      return 'other'
  }
}

function normalizeCapabilityCategories(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as HomeAssistantCapabilityCategory[]
  }

  return value.reduce<HomeAssistantCapabilityCategory[]>((categories, entry) => {
    const normalized = normalizeCapabilityCategory(entry)
    if (normalized && !categories.includes(normalized)) {
      categories.push(normalized)
    }
    return categories
  }, [])
}

function deriveLegacyServiceDomain(actionKind: HomeAssistantActionKind) {
  switch (actionKind) {
    case 'play':
    case 'pause':
    case 'stop':
    case 'next':
    case 'previous':
    case 'connect':
    case 'volume':
      return 'media_player'
    default:
      return 'homeassistant'
  }
}

function deriveLegacyServiceName(actionKind: HomeAssistantActionKind) {
  switch (actionKind) {
    case 'connect':
      return 'play_media'
    case 'play':
      return 'media_play'
    case 'pause':
      return 'media_pause'
    case 'stop':
      return 'media_stop'
    case 'next':
      return 'media_next_track'
    case 'previous':
      return 'media_previous_track'
    case 'volume':
      return 'volume_set'
    case 'turn_on':
      return 'turn_on'
    case 'turn_off':
      return 'turn_off'
    case 'lock':
      return 'lock'
    case 'unlock':
      return 'unlock'
    case 'open':
      return 'open_cover'
    case 'close':
      return 'close_cover'
    default:
      return 'toggle'
  }
}

function normalizeProtocol(value: unknown): HomeAssistantDeviceProtocol | null {
  return value === 'home-assistant' || value === 'mdns' || value === 'ssdp' ? value : null
}

function titleCaseServiceLabel(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
}

function buildHomeAssistantActionPresentation({
  actionKind,
  fallbackLabel,
  serviceDomain,
  serviceName,
}: {
  actionKind: HomeAssistantActionKind
  fallbackLabel?: string | null
  serviceDomain: string
  serviceName: string
}): HomeAssistantActionPresentation {
  if (
    serviceDomain === 'media_player' &&
    serviceName === 'play_media' &&
    actionKind === 'connect'
  ) {
    return {
      displayKey: 'connect',
      icon: 'connect',
      label: 'Connect',
    }
  }

  switch (serviceName) {
    case 'turn_on':
      return { displayKey: 'turn_on', icon: 'turn_on', label: 'Turn On' }
    case 'turn_off':
      return { displayKey: 'turn_off', icon: 'turn_off', label: 'Turn Off' }
    case 'toggle':
      return { displayKey: 'toggle', icon: 'toggle', label: 'Toggle' }
    case 'media_play':
      return { displayKey: 'play', icon: 'play', label: 'Play' }
    case 'media_play_pause':
      return { displayKey: 'play_pause', icon: 'play_pause', label: 'Play/Pause' }
    case 'media_pause':
    case 'pause':
      return { displayKey: 'pause', icon: 'pause', label: 'Pause' }
    case 'media_stop':
    case 'stop':
      return { displayKey: 'stop', icon: 'stop', label: 'Stop' }
    case 'start':
      return { displayKey: 'start', icon: 'start', label: 'Start' }
    case 'media_next_track':
      return { displayKey: 'next', icon: 'next', label: 'Next' }
    case 'media_previous_track':
      return { displayKey: 'previous', icon: 'previous', label: 'Previous' }
    case 'volume_up':
      return { displayKey: 'volume_up', icon: 'volume_up', label: 'Volume Up' }
    case 'volume_down':
      return { displayKey: 'volume_down', icon: 'volume_down', label: 'Volume Down' }
    case 'volume_set':
      return { displayKey: 'volume_set', icon: 'volume_set', label: 'Set Volume' }
    case 'volume_mute':
      return { displayKey: 'volume_mute', icon: 'volume_mute', label: 'Mute' }
    case 'select_source':
      return { displayKey: 'source', icon: 'connect', label: 'Source' }
    case 'select_sound_mode':
      return { displayKey: 'sound_mode', icon: 'sound_mode', label: 'Sound Mode' }
    case 'repeat_set':
      return { displayKey: 'repeat', icon: 'repeat', label: 'Repeat' }
    case 'shuffle_set':
      return { displayKey: 'shuffle', icon: 'shuffle', label: 'Shuffle' }
    case 'media_seek':
      return { displayKey: 'seek', icon: 'seek', label: 'Seek' }
    case 'join':
      return { displayKey: 'group', icon: 'group', label: 'Group' }
    case 'unjoin':
      return { displayKey: 'ungroup', icon: 'ungroup', label: 'Ungroup' }
    case 'clear_playlist':
      return { displayKey: 'playlist_clear', icon: 'playlist_clear', label: 'Clear Queue' }
    case 'search_media':
      return { displayKey: 'search', icon: 'search', label: 'Search' }
    case 'lock':
      return { displayKey: 'lock', icon: 'lock', label: 'Lock' }
    case 'unlock':
      return { displayKey: 'unlock', icon: 'unlock', label: 'Unlock' }
    case 'open_cover':
    case 'open':
      return { displayKey: 'open', icon: 'open', label: 'Open' }
    case 'close_cover':
    case 'close':
      return { displayKey: 'close', icon: 'close', label: 'Close' }
    case 'open_cover_tilt':
      return { displayKey: 'tilt_open', icon: 'tilt_open', label: 'Tilt Open' }
    case 'close_cover_tilt':
      return { displayKey: 'tilt_close', icon: 'tilt_close', label: 'Tilt Close' }
    case 'set_cover_position':
      return { displayKey: 'position', icon: 'position', label: 'Position' }
    case 'set_cover_tilt_position':
      return { displayKey: 'tilt_position', icon: 'tilt_position', label: 'Tilt Position' }
    case 'stop_cover':
      return { displayKey: 'position_stop', icon: 'position_stop', label: 'Stop' }
    case 'stop_cover_tilt':
      return { displayKey: 'tilt_stop', icon: 'tilt_stop', label: 'Tilt Stop' }
    case 'increase_speed':
      return { displayKey: 'speed_up', icon: 'speed_up', label: 'Speed Up' }
    case 'decrease_speed':
      return { displayKey: 'speed_down', icon: 'speed_down', label: 'Speed Down' }
    case 'set_percentage':
      return { displayKey: 'speed', icon: 'speed', label: 'Speed' }
    case 'set_direction':
      return { displayKey: 'direction', icon: 'direction', label: 'Direction' }
    case 'oscillate':
      return { displayKey: 'swing', icon: 'swing', label: 'Oscillate' }
    case 'set_preset_mode':
      return { displayKey: 'preset_mode', icon: 'preset_mode', label: 'Preset' }
    case 'set_fan_mode':
      return { displayKey: 'fan_mode', icon: 'fan_mode', label: 'Fan Mode' }
    case 'set_hvac_mode':
      return { displayKey: 'climate_mode', icon: 'climate_mode', label: 'Mode' }
    case 'set_temperature':
      return { displayKey: 'temperature', icon: 'temperature', label: 'Temperature' }
    case 'set_humidity':
      return { displayKey: 'humidity', icon: 'humidity', label: 'Humidity' }
    case 'set_swing_mode':
      return { displayKey: 'swing', icon: 'swing', label: 'Swing' }
    case 'set_swing_horizontal_mode':
      return { displayKey: 'swing_horizontal', icon: 'swing_horizontal', label: 'Horizontal Swing' }
    case 'clean_spot':
      return { displayKey: 'clean_spot', icon: 'clean_spot', label: 'Spot Clean' }
    case 'clean_area':
      return { displayKey: 'clean_area', icon: 'clean_area', label: 'Area Clean' }
    case 'return_to_base':
      return { displayKey: 'return_to_base', icon: 'return_to_base', label: 'Return' }
    case 'locate':
      return { displayKey: 'locate', icon: 'locate', label: 'Locate' }
    case 'set_fan_speed':
      return { displayKey: 'fan_mode', icon: 'fan_mode', label: 'Fan Speed' }
    default:
      break
  }

  switch (actionKind) {
    case 'turn_on':
      return { displayKey: 'turn_on', icon: 'turn_on', label: 'Turn On' }
    case 'turn_off':
      return { displayKey: 'turn_off', icon: 'turn_off', label: 'Turn Off' }
    case 'power':
      return { displayKey: 'toggle', icon: 'toggle', label: 'Toggle' }
    case 'play':
      return { displayKey: 'play', icon: 'play', label: 'Play' }
    case 'pause':
      return { displayKey: 'pause', icon: 'pause', label: 'Pause' }
    case 'stop':
      return { displayKey: 'stop', icon: 'stop', label: 'Stop' }
    case 'next':
      return { displayKey: 'next', icon: 'next', label: 'Next' }
    case 'previous':
      return { displayKey: 'previous', icon: 'previous', label: 'Previous' }
    case 'volume':
      return {
        displayKey: serviceName || 'volume_set',
        icon:
          serviceName === 'volume_up'
            ? 'volume_up'
            : serviceName === 'volume_down'
              ? 'volume_down'
              : serviceName === 'volume_mute'
                ? 'volume_mute'
                : 'volume_set',
        label: fallbackLabel ?? 'Volume',
      }
    case 'lock':
      return { displayKey: 'lock', icon: 'lock', label: 'Lock' }
    case 'unlock':
      return { displayKey: 'unlock', icon: 'unlock', label: 'Unlock' }
    case 'open':
      return { displayKey: 'open', icon: 'open', label: 'Open' }
    case 'close':
      return { displayKey: 'close', icon: 'close', label: 'Close' }
    case 'connect':
      return { displayKey: 'connect', icon: 'connect', label: 'Connect' }
    default:
      return {
        displayKey: `${serviceDomain}.${serviceName}`,
        icon: 'custom',
        label: fallbackLabel?.trim() || titleCaseServiceLabel(serviceName),
      }
  }
}

export function getHomeAssistantAvailableActionPresentation(
  action: Pick<HomeAssistantAvailableAction, 'actionKind' | 'domain' | 'label' | 'service'>,
): HomeAssistantActionPresentation {
  return buildHomeAssistantActionPresentation({
    actionKind: action.actionKind,
    fallbackLabel: action.label,
    serviceDomain: action.domain,
    serviceName: action.service,
  })
}

export function toHomeAssistantLink(
  device: HomeAssistantDiscoveredDevice,
  action: HomeAssistantAvailableAction | null = null,
  serviceData: Record<string, unknown> = device.defaultServiceData,
  enabledActionCategories?: HomeAssistantCapabilityCategory[],
  linkedAt = new Date().toISOString(),
): HomeAssistantLink {
  const resolvedAction =
    action ??
    device.availableActions.find((candidate) => candidate.key === device.defaultActionKey) ??
    device.availableActions[0] ??
    null
  const resolvedEnabledCategories =
    enabledActionCategories && enabledActionCategories.length > 0
      ? enabledActionCategories
      : device.enabledActionCategories.length > 0
        ? device.enabledActionCategories
        : Array.from(
            new Set(
              device.availableActions.map((candidate) =>
                getHomeAssistantCapabilityCategory(candidate.actionKind),
              ),
            ),
          )

  return {
    actionKind: resolvedAction?.actionKind ?? 'custom',
    actionLabel: resolvedAction?.label ?? 'Run action',
    description: device.description,
    deviceId: device.id,
    deviceName: device.name,
    deviceType: device.deviceType,
    enabledActionCategories: resolvedEnabledCategories,
    haEntityId: device.haEntityId,
    ip: device.ip,
    linkedAt,
    manufacturer: device.manufacturer,
    model: device.model,
    protocol: device.protocol,
    serviceData,
    serviceDomain: resolvedAction?.domain ?? 'homeassistant',
    serviceName: resolvedAction?.service ?? 'toggle',
    serviceType: device.serviceType,
  }
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function getHomeAssistantLink(metadata: unknown): HomeAssistantLink | null {
  if (!isMetadataRecord(metadata)) {
    return null
  }

  const value = metadata[HOME_ASSISTANT_LINK_METADATA_KEY]
  if (!isMetadataRecord(value)) {
    return null
  }

  const protocol = normalizeProtocol(value.protocol)
  const actionKind = normalizeActionKind(value.actionKind)
  const deviceId = normalizeString(value.deviceId)
  const deviceName = normalizeString(value.deviceName)
  const deviceType = normalizeString(value.deviceType)
  const enabledActionCategories = normalizeCapabilityCategories(value.enabledActionCategories)
  const actionLabel = normalizeString(value.actionLabel)
  const description = normalizeString(value.description)
  const linkedAt = normalizeString(value.linkedAt)
  const serviceDomain = normalizeString(value.serviceDomain)
  const serviceName = normalizeString(value.serviceName)
  const serviceData = isJsonRecord(value.serviceData) ? value.serviceData : {}

  if (
    !protocol ||
    !actionKind ||
    !deviceId ||
    !deviceName ||
    !deviceType ||
    !actionLabel ||
    !description ||
    !linkedAt
  ) {
    return null
  }

  return {
    actionKind,
    actionLabel,
    description,
    deviceId,
    deviceName,
    deviceType,
    enabledActionCategories:
      enabledActionCategories.length > 0
        ? enabledActionCategories
        : [getHomeAssistantCapabilityCategory(actionKind)],
    haEntityId: normalizeString(value.haEntityId),
    ip: normalizeString(value.ip),
    linkedAt,
    manufacturer: normalizeString(value.manufacturer),
    model: normalizeString(value.model),
    protocol,
    serviceData,
    serviceDomain: serviceDomain ?? deriveLegacyServiceDomain(actionKind),
    serviceName: serviceName ?? deriveLegacyServiceName(actionKind),
    serviceType: normalizeString(value.serviceType),
  }
}

export function setHomeAssistantLink(metadata: unknown, link: HomeAssistantLink | null) {
  const nextMetadata = isMetadataRecord(metadata) ? { ...metadata } : {}

  if (link) {
    nextMetadata[HOME_ASSISTANT_LINK_METADATA_KEY] = link
    return nextMetadata
  }

  delete nextMetadata[HOME_ASSISTANT_LINK_METADATA_KEY]
  return nextMetadata
}

export function getHomeAssistantActionPresentation(link: HomeAssistantLink | null) {
  if (!link?.haEntityId) {
    return null
  }

  const presentation = buildHomeAssistantActionPresentation({
    actionKind: link.actionKind,
    fallbackLabel: link.actionLabel,
    serviceDomain: link.serviceDomain,
    serviceName: link.serviceName,
  })

  return {
    icon: presentation.icon,
    label: presentation.label,
  }
}

export function requestHomeAssistantDeviceAction(item: ItemNode, link: HomeAssistantLink) {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(
    new CustomEvent<PascalHaDeviceActionRequestDetail>(PASCAL_HA_DEVICE_ACTION_REQUEST_EVENT, {
      detail: {
        itemId: item.id,
        itemName: item.asset.name,
        link,
      },
    }),
  )
}
