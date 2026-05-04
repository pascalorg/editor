import type {
  HomeAssistantAvailableAction,
  HomeAssistantAvailableActionField,
  HomeAssistantDiscoveredDevice,
} from './home-assistant'
import { getHomeAssistantCapabilityCategory } from './home-assistant'

export const HOME_ASSISTANT_DEFAULT_MEDIA_SENTINEL = '__pascal_default_media__'

export type HomeAssistantFieldSelectorKey =
  | 'area'
  | 'boolean'
  | 'color_rgb'
  | 'color_temp'
  | 'constant'
  | 'date'
  | 'datetime'
  | 'entity'
  | 'media'
  | 'number'
  | 'object'
  | 'select'
  | 'state'
  | 'text'
  | 'time'
  | null

export type HomeAssistantFieldOption = {
  description?: string | null
  label: string
  value: unknown
}

function getStateSelectorAttributeCandidates(attributeName: string) {
  switch (attributeName) {
    case 'source':
      return ['source', 'source_list']
    case 'sound_mode':
      return ['sound_mode', 'sound_mode_list']
    case 'fan_mode':
      return ['fan_mode', 'fan_modes']
    case 'hvac_mode':
      return ['hvac_mode', 'hvac_modes']
    case 'preset_mode':
      return ['preset_mode', 'preset_modes']
    case 'swing_mode':
      return ['swing_mode', 'swing_modes']
    case 'swing_horizontal_mode':
      return ['swing_horizontal_mode', 'swing_horizontal_modes']
    default:
      return [attributeName]
  }
}

function getNumberSelectorConfig(field: HomeAssistantAvailableActionField) {
  const selector =
    field.selector?.number && typeof field.selector.number === 'object'
      ? field.selector.number
      : null
  const min = selector && 'min' in selector ? Number(selector.min) : Number.NaN
  const max = selector && 'max' in selector ? Number(selector.max) : Number.NaN
  const step = selector && 'step' in selector ? Number(selector.step) : Number.NaN
  const mode =
    selector && 'mode' in selector && typeof selector.mode === 'string' ? selector.mode : null
  const unit =
    selector &&
    'unit_of_measurement' in selector &&
    typeof selector.unit_of_measurement === 'string'
      ? selector.unit_of_measurement
      : null

  return {
    max: Number.isFinite(max) ? max : null,
    min: Number.isFinite(min) ? min : null,
    mode,
    step: Number.isFinite(step) && step > 0 ? step : 1,
    unit,
  }
}

function clampNumber(value: number, min: number | null, max: number | null) {
  if (min !== null && value < min) {
    return min
  }

  if (max !== null && value > max) {
    return max
  }

  return value
}

function roundToStep(value: number, min: number | null, step: number) {
  if (!Number.isFinite(value)) {
    return min ?? 0
  }

  const base = min ?? 0
  return Number((Math.round((value - base) / step) * step + base).toFixed(4))
}

function buildNumberPresets(field: HomeAssistantAvailableActionField) {
  const config = getNumberSelectorConfig(field)
  if (config.min === null || config.max === null) {
    return [] as HomeAssistantFieldOption[]
  }

  const min = config.min
  const max = config.max
  const step = config.step
  const unit = config.unit
  const span = max - min

  let candidates: number[]
  if (min === 0 && max === 1) {
    candidates = [0, 0.25, 0.5, 0.75, 1]
  } else if (unit === '%' || max === 100) {
    candidates = [0, 25, 50, 75, 100]
  } else if (span <= 10) {
    candidates = [min, min + span * 0.25, min + span * 0.5, min + span * 0.75, max]
  } else {
    candidates = [min, min + span * 0.2, min + span * 0.5, min + span * 0.8, max]
  }

  return Array.from(
    new Set(
      candidates.map((candidate) =>
        clampNumber(roundToStep(candidate, min, step), config.min, config.max),
      ),
    ),
  ).map((value) => ({
    label:
      min === 0 && max === 1
        ? `${Math.round(value * 100)}%`
        : unit === '%'
          ? `${Math.round(value)}%`
          : `${value}${unit ? ` ${unit}` : ''}`,
    value,
  }))
}

function buildColorTemperatureOptions(field: HomeAssistantAvailableActionField) {
  const config = getNumberSelectorConfig(field)
  const usesKelvin =
    field.key.includes('kelvin') ||
    (field.selector?.color_temp &&
      typeof field.selector.color_temp === 'object' &&
      'unit' in field.selector.color_temp &&
      field.selector.color_temp.unit === 'kelvin')

  const presets = usesKelvin
    ? [
        { label: 'Warm', value: 2700 },
        { label: 'Neutral', value: 4000 },
        { label: 'Cool', value: 6500 },
      ]
    : [
        { label: 'Warm', value: 400 },
        { label: 'Neutral', value: 250 },
        { label: 'Cool', value: 153 },
      ]

  return presets.map((preset) => ({
    ...preset,
    value:
      config.min !== null || config.max !== null
        ? clampNumber(Number(preset.value), config.min, config.max)
        : preset.value,
  }))
}

function isDefaultConnectAction(action: HomeAssistantAvailableAction) {
  return (
    action.actionKind === 'connect' &&
    action.domain === 'media_player' &&
    action.service === 'play_media'
  )
}

function canUseDefaultValue(field: HomeAssistantAvailableActionField) {
  return field.defaultValue !== null && field.defaultValue !== undefined
}

export function getHomeAssistantActionFieldSelectorKey(field: HomeAssistantAvailableActionField) {
  if (!field.selector) {
    return null
  }

  const selectorKey = Object.keys(field.selector)[0] ?? null
  switch (selectorKey) {
    case 'area':
    case 'boolean':
    case 'color_rgb':
    case 'color_temp':
    case 'constant':
    case 'date':
    case 'datetime':
    case 'entity':
    case 'media':
    case 'number':
    case 'object':
    case 'select':
    case 'state':
    case 'text':
    case 'time':
      return selectorKey
    default:
      return null
  }
}

export function getHomeAssistantActionFieldOptions(
  action: HomeAssistantAvailableAction,
  field: HomeAssistantAvailableActionField,
  device: HomeAssistantDiscoveredDevice,
) {
  const selectorKey = getHomeAssistantActionFieldSelectorKey(field)

  if (selectorKey === 'boolean') {
    if (field.key === 'is_volume_muted') {
      return [
        { label: 'Mute', value: true },
        { label: 'Unmute', value: false },
      ] satisfies HomeAssistantFieldOption[]
    }

    return [
      { label: 'On', value: true },
      { label: 'Off', value: false },
    ] satisfies HomeAssistantFieldOption[]
  }

  if (selectorKey === 'constant') {
    const constantSelector =
      field.selector?.constant && typeof field.selector.constant === 'object'
        ? field.selector.constant
        : null

    if (!constantSelector || !('value' in constantSelector)) {
      return [] as HomeAssistantFieldOption[]
    }

    return [
      {
        label:
          'label' in constantSelector && typeof constantSelector.label === 'string'
            ? constantSelector.label
            : field.label,
        value: constantSelector.value,
      },
    ]
  }

  if (selectorKey === 'select') {
    const selectSelector = field.selector?.select
    if (
      selectSelector &&
      typeof selectSelector === 'object' &&
      !Array.isArray(selectSelector) &&
      'options' in selectSelector &&
      Array.isArray(selectSelector.options)
    ) {
      return selectSelector.options
        .filter((option: unknown): option is string => typeof option === 'string')
        .map((option: string) => ({ label: option, value: option }))
    }

    return [] as HomeAssistantFieldOption[]
  }

  if (selectorKey === 'state') {
    const stateSelector = field.selector?.state
    if (
      !stateSelector ||
      typeof stateSelector !== 'object' ||
      stateSelector === null ||
      !('attribute' in stateSelector) ||
      typeof stateSelector.attribute !== 'string'
    ) {
      return [] as HomeAssistantFieldOption[]
    }

    const attributes = device.attributes ?? {}
    const options = getStateSelectorAttributeCandidates(stateSelector.attribute).flatMap(
      (attributeName) => {
        const rawValue = attributes[attributeName]
        if (Array.isArray(rawValue)) {
          return rawValue.filter((entry): entry is string => typeof entry === 'string')
        }

        if (typeof rawValue === 'string' && rawValue.trim().length > 0) {
          return [rawValue.trim()]
        }

        return []
      },
    )

    return Array.from(new Set(options)).map((option) => ({
      label: option,
      value: option,
    }))
  }

  if (selectorKey === 'number') {
    return buildNumberPresets(field)
  }

  if (selectorKey === 'color_rgb') {
    return [
      { label: 'Warm', value: [255, 183, 76] },
      { label: 'Daylight', value: [255, 244, 229] },
      { label: 'Blue', value: [91, 160, 255] },
      { label: 'Green', value: [72, 199, 116] },
      { label: 'Violet', value: [153, 102, 255] },
    ] satisfies HomeAssistantFieldOption[]
  }

  if (selectorKey === 'color_temp') {
    return buildColorTemperatureOptions(field)
  }

  if (selectorKey === 'media' && isDefaultConnectAction(action)) {
    return [
      {
        description: 'Uses the configured Home Assistant cast test clip.',
        label: 'Cast Test',
        value: HOME_ASSISTANT_DEFAULT_MEDIA_SENTINEL,
      },
    ]
  }

  return [] as HomeAssistantFieldOption[]
}

export function getHomeAssistantActionInitialFieldValue(
  action: HomeAssistantAvailableAction,
  field: HomeAssistantAvailableActionField,
  device: HomeAssistantDiscoveredDevice,
  serviceData: Record<string, unknown> = {},
) {
  if (serviceData[field.key] !== undefined) {
    return serviceData[field.key]
  }

  if (isDefaultConnectAction(action) && field.key === 'media') {
    return HOME_ASSISTANT_DEFAULT_MEDIA_SENTINEL
  }

  if (field.key === 'is_volume_muted') {
    const muted = device.attributes?.is_volume_muted
    if (typeof muted === 'boolean') {
      return !muted
    }
  }

  if (canUseDefaultValue(field)) {
    return field.defaultValue
  }

  const options = getHomeAssistantActionFieldOptions(action, field, device)
  const onlyOption = options[0]
  if (field.required && options.length === 1 && onlyOption) {
    return onlyOption.value
  }

  return ''
}

export function hasHomeAssistantActionFieldValue(
  field: HomeAssistantAvailableActionField,
  value: unknown,
) {
  const selectorKey = getHomeAssistantActionFieldSelectorKey(field)
  if (selectorKey === 'boolean') {
    return typeof value === 'boolean'
  }

  if (typeof value === 'number') {
    return Number.isFinite(value)
  }

  if (typeof value === 'string') {
    return value.trim().length > 0
  }

  if (Array.isArray(value)) {
    return value.length > 0
  }

  if (value && typeof value === 'object') {
    return true
  }

  return false
}

export function normalizeHomeAssistantActionFieldValue(
  action: HomeAssistantAvailableAction,
  field: HomeAssistantAvailableActionField,
  value: unknown,
) {
  const selectorKey = getHomeAssistantActionFieldSelectorKey(field)

  if (isDefaultConnectAction(action) && value === HOME_ASSISTANT_DEFAULT_MEDIA_SENTINEL) {
    return undefined
  }

  if (selectorKey === 'number') {
    if (typeof value === 'number') {
      return value
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number.parseFloat(value)
      if (Number.isFinite(parsed)) {
        return parsed
      }
    }

    throw new Error(`${field.label} must be a valid number.`)
  }

  if (selectorKey === 'boolean') {
    if (typeof value === 'boolean') {
      return value
    }

    if (value === 'true') {
      return true
    }

    if (value === 'false') {
      return false
    }

    throw new Error(`${field.label} must be true or false.`)
  }

  if (selectorKey === 'media' || selectorKey === 'object') {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (!trimmed) {
        return ''
      }

      try {
        return JSON.parse(trimmed)
      } catch {
        return trimmed
      }
    }
  }

  return value
}

export function buildHomeAssistantActionServiceData(
  action: HomeAssistantAvailableAction,
  device: HomeAssistantDiscoveredDevice,
  values: Record<string, unknown>,
) {
  return action.fields.reduce<Record<string, unknown>>((serviceData, field) => {
    const rawValue =
      values[field.key] !== undefined
        ? values[field.key]
        : getHomeAssistantActionInitialFieldValue(action, field, device)

    if (!field.required && !hasHomeAssistantActionFieldValue(field, rawValue)) {
      return serviceData
    }

    if (field.required && !hasHomeAssistantActionFieldValue(field, rawValue)) {
      throw new Error(`Choose a value for ${field.label}.`)
    }

    const normalizedValue = normalizeHomeAssistantActionFieldValue(action, field, rawValue)
    if (normalizedValue !== undefined) {
      serviceData[field.key] = normalizedValue
    }
    return serviceData
  }, {})
}

export function getHomeAssistantRenderableFields(
  action: HomeAssistantAvailableAction,
  device: HomeAssistantDiscoveredDevice,
) {
  return action.fields.filter((field) => {
    const selectorKey = getHomeAssistantActionFieldSelectorKey(field)
    if (field.required) {
      switch (selectorKey) {
        case 'boolean':
        case 'color_rgb':
        case 'color_temp':
        case 'constant':
        case 'date':
        case 'datetime':
        case 'media':
        case 'number':
        case 'select':
        case 'state':
        case 'time':
          return true
        default:
          return (
            canUseDefaultValue(field) ||
            getHomeAssistantActionFieldOptions(action, field, device).length > 0
          )
      }
    }

    switch (selectorKey) {
      case 'boolean':
      case 'color_rgb':
      case 'color_temp':
      case 'number':
      case 'select':
      case 'state':
        return true
      default:
        return false
    }
  })
}

export function isHomeAssistantActionLean(
  action: HomeAssistantAvailableAction,
  device: HomeAssistantDiscoveredDevice,
) {
  return (
    getHomeAssistantRenderableFields(action, device).length >=
    action.fields.filter((field) => field.required).length
  )
}

export function canRunHomeAssistantActionImmediately(
  action: HomeAssistantAvailableAction,
  device: HomeAssistantDiscoveredDevice,
  values: Record<string, unknown> = {},
) {
  if (action.fields.length === 0 || isDefaultConnectAction(action)) {
    return true
  }

  const requiredFields = action.fields.filter((field) => field.required)
  if (requiredFields.length === 0) {
    return true
  }

  return requiredFields.every((field) => {
    const selectorKey = getHomeAssistantActionFieldSelectorKey(field)
    if (selectorKey === 'number' || selectorKey === 'color_rgb' || selectorKey === 'color_temp') {
      return false
    }

    const value =
      values[field.key] !== undefined
        ? values[field.key]
        : getHomeAssistantActionInitialFieldValue(action, field, device)
    return hasHomeAssistantActionFieldValue(field, value)
  })
}

export function normalizeHomeAssistantDiscoveredDevice(device: HomeAssistantDiscoveredDevice) {
  const availableActions = device.availableActions.filter((action) =>
    isHomeAssistantActionLean(action, device),
  )
  const enabledActionCategories =
    device.enabledActionCategories.length > 0
      ? device.enabledActionCategories.filter((category) =>
          availableActions.some(
            (action) => getHomeAssistantCapabilityCategory(action.actionKind) === category,
          ),
        )
      : Array.from(
          new Set(
            availableActions.map((action) => getHomeAssistantCapabilityCategory(action.actionKind)),
          ),
        )
  const defaultAction =
    availableActions.find((action) => action.key === device.defaultActionKey) ??
    availableActions.find((action) => action.actionKind === 'connect') ??
    availableActions[0] ??
    null

  return {
    ...device,
    availableActions,
    defaultActionKey: defaultAction?.key ?? null,
    enabledActionCategories,
  }
}
