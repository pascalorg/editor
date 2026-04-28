'use client'

import type { ItemNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { ArrowLeft, Check, LoaderCircle, Power, RefreshCw, Tv } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type {
  HomeAssistantAvailableAction,
  HomeAssistantAvailableActionField,
  HomeAssistantCapabilityCategory,
  HomeAssistantDiscoveredDevice,
  HomeAssistantLink,
} from '../../lib/home-assistant'
import {
  getHomeAssistantAvailableActionPresentation,
  getHomeAssistantCapabilityCategory,
  toHomeAssistantLink,
} from '../../lib/home-assistant'
import {
  buildHomeAssistantActionServiceData,
  canRunHomeAssistantActionImmediately,
  getHomeAssistantActionFieldOptions,
  getHomeAssistantActionInitialFieldValue,
  getHomeAssistantRenderableFields,
  type HomeAssistantFieldOption,
  normalizeHomeAssistantDiscoveredDevice,
} from '../../lib/home-assistant-controls'
import { cn } from '../../lib/utils'
import { HomeAssistantActionIconView } from '../ui/home-assistant-action-icon'

type DeviceLoadState = 'idle' | 'loading' | 'ready' | 'error'

type HomeAssistantActionResponse = {
  actionKind: string
  availableAfterAction: boolean
  deviceName: string
  finalState: string
  initialFriendlyName: string | null
  initialState: string
  itemName: string
  message: string
  observedAppNames: string[]
  success: boolean
  timeline: Array<{
    appName: string | null
    mediaTitle: string | null
    second: number
    state: string
  }>
}

const CATEGORY_ORDER: HomeAssistantCapabilityCategory[] = [
  'power',
  'playback',
  'audio',
  'access',
  'other',
]

function getCategoryMeta(category: HomeAssistantCapabilityCategory) {
  switch (category) {
    case 'power':
      return { icon: <Power className="h-4 w-4" />, label: 'Power' }
    case 'playback':
      return {
        icon: <HomeAssistantActionIconView className="h-4 w-4" icon="play" />,
        label: 'Playback',
      }
    case 'audio':
      return {
        icon: <HomeAssistantActionIconView className="h-4 w-4" icon="volume_set" />,
        label: 'Audio',
      }
    case 'access':
      return {
        icon: <HomeAssistantActionIconView className="h-4 w-4" icon="lock" />,
        label: 'Access',
      }
    case 'other':
    default:
      return {
        icon: <HomeAssistantActionIconView className="h-4 w-4" icon="custom" />,
        label: 'Other',
      }
  }
}

function buildFallbackDevice(link: HomeAssistantLink): HomeAssistantDiscoveredDevice {
  const actionKey = `${link.serviceDomain}.${link.serviceName}`
  return {
    actionable: Boolean(link.haEntityId),
    attributes: null,
    availableActions: [
      {
        actionKind: link.actionKind,
        description: `${link.serviceDomain}.${link.serviceName}`,
        domain: link.serviceDomain,
        fields: [],
        key: actionKey,
        label: link.actionLabel,
        service: link.serviceName,
      },
    ],
    defaultActionKey: actionKey,
    defaultServiceData: link.serviceData,
    description: link.description,
    deviceType: link.deviceType,
    enabledActionCategories: link.enabledActionCategories,
    haEntityId: link.haEntityId,
    id: link.deviceId,
    ip: link.ip,
    manufacturer: link.manufacturer,
    model: link.model,
    name: link.deviceName,
    protocol: link.protocol,
    serviceType: link.serviceType,
    supportedFeatures: null,
  }
}

function getDeviceKey(device: Pick<HomeAssistantDiscoveredDevice, 'haEntityId' | 'id'>) {
  return device.haEntityId ?? device.id
}

function getLinkKey(link: Pick<HomeAssistantLink, 'haEntityId' | 'deviceId'>) {
  return link.haEntityId ?? link.deviceId
}

function isTelevisionItem(item: ItemNode) {
  const candidates = [item.asset.id, item.asset.name, item.asset.src, ...(item.asset.tags ?? [])]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)

  return candidates.some(
    (candidate) =>
      candidate === 'tv' ||
      candidate.includes('television') ||
      candidate.includes('flat-screen-tv'),
  )
}

function isHomeAssistantOffAction(action: HomeAssistantAvailableAction, link: HomeAssistantLink) {
  return (
    action.actionKind === 'turn_off' ||
    action.service === 'turn_off' ||
    link.serviceName === 'turn_off'
  )
}

function isDeferredHomeAssistantPowerToggle(
  action: HomeAssistantAvailableAction,
  link: HomeAssistantLink,
) {
  return (
    action.actionKind === 'power' || action.service === 'toggle' || link.serviceName === 'toggle'
  )
}

function isHomeAssistantOffState(state: string) {
  return state.trim().toLowerCase() === 'off'
}

type HomeAssistantConnectivityPanelProps = {
  item: ItemNode
  link: HomeAssistantLink
  onClose: () => void
}

export function HomeAssistantConnectivityPanel({
  item,
  link,
  onClose,
}: HomeAssistantConnectivityPanelProps) {
  const [loadState, setLoadState] = useState<DeviceLoadState>('idle')
  const [reloadToken, setReloadToken] = useState(0)
  const [loadError, setLoadError] = useState('')
  const [device, setDevice] = useState<HomeAssistantDiscoveredDevice | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<HomeAssistantCapabilityCategory | null>(
    null,
  )
  const [selectedActionKey, setSelectedActionKey] = useState<string | null>(null)
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({})
  const [isActionRunning, setIsActionRunning] = useState(false)
  const [actionError, setActionError] = useState('')
  const [actionResult, setActionResult] = useState<HomeAssistantActionResponse | null>(null)
  const [statusMessage, setStatusMessage] = useState('Choose a connected feature to run.')

  const enabledCategories = useMemo(
    () =>
      CATEGORY_ORDER.filter((category) =>
        (link.enabledActionCategories.length > 0
          ? link.enabledActionCategories
          : CATEGORY_ORDER
        ).includes(category),
      ),
    [link.enabledActionCategories],
  )

  const visibleActions = useMemo(() => {
    if (!device || !selectedCategory) {
      return [] as HomeAssistantAvailableAction[]
    }

    return device.availableActions.filter(
      (action) =>
        enabledCategories.includes(getHomeAssistantCapabilityCategory(action.actionKind)) &&
        getHomeAssistantCapabilityCategory(action.actionKind) === selectedCategory,
    )
  }, [device, enabledCategories, selectedCategory])

  const selectedAction = useMemo(
    () => visibleActions.find((action) => action.key === selectedActionKey) ?? null,
    [selectedActionKey, visibleActions],
  )

  useEffect(() => {
    let cancelled = false

    async function loadDevice() {
      setLoadState('loading')
      setLoadError('')

      try {
        const response = await fetch('/api/home-assistant/discover-devices', {
          cache: 'no-store',
        })
        const payload = (await response.json()) as {
          devices?: HomeAssistantDiscoveredDevice[]
          error?: string
        }

        if (!response.ok) {
          throw new Error(payload.error || 'Failed to load Home Assistant device features.')
        }

        const devices = Array.isArray(payload.devices) ? payload.devices : []
        const matchedDevice =
          devices.find((candidate) => getDeviceKey(candidate) === getLinkKey(link)) ?? null
        const nextDevice = normalizeHomeAssistantDiscoveredDevice(
          matchedDevice !== null
            ? {
                ...matchedDevice,
                enabledActionCategories: link.enabledActionCategories,
              }
            : buildFallbackDevice(link),
        )

        if (cancelled) {
          return
        }

        const nextCategories = CATEGORY_ORDER.filter(
          (category) =>
            nextDevice.availableActions.some(
              (action) => getHomeAssistantCapabilityCategory(action.actionKind) === category,
            ) && enabledCategories.includes(category),
        )
        const defaultCategory = nextCategories[0] ?? null

        setDevice(nextDevice)
        setSelectedCategory(defaultCategory)
        setSelectedActionKey(null)
        setFieldValues({})
        setStatusMessage(
          nextCategories.length > 0
            ? `Choose a ${nextDevice.name} feature to run from ${item.asset.name}.`
            : 'No enabled Home Assistant features are available for this item.',
        )
        setLoadState('ready')
      } catch (error) {
        if (cancelled) {
          return
        }

        const message =
          error instanceof Error ? error.message : 'Failed to load Home Assistant device features.'
        setDevice(normalizeHomeAssistantDiscoveredDevice(buildFallbackDevice(link)))
        setLoadError(message)
        setLoadState('error')
      }
    }

    void loadDevice()

    return () => {
      cancelled = true
    }
  }, [enabledCategories, item.asset.name, link, reloadToken])

  useEffect(() => {
    if (!device || !selectedAction) {
      return
    }

    setFieldValues((currentValues) =>
      getHomeAssistantRenderableFields(selectedAction, device).reduce<Record<string, unknown>>(
        (values, field) => {
          values[field.key] =
            currentValues[field.key] ??
            getHomeAssistantActionInitialFieldValue(selectedAction, field, device, link.serviceData)
          return values
        },
        {},
      ),
    )
  }, [device, link, selectedAction])

  function setFieldValue(fieldKey: string, value: unknown) {
    setFieldValues((currentValues) => ({
      ...currentValues,
      [fieldKey]: value,
    }))
    setActionError('')
    setActionResult(null)
  }

  async function runAction(
    actionToRun: HomeAssistantAvailableAction | null = selectedAction,
    overrideValues?: Record<string, unknown>,
  ) {
    if (!device || !actionToRun) {
      return
    }

    try {
      const serviceData = buildHomeAssistantActionServiceData(
        actionToRun,
        device,
        overrideValues ?? fieldValues,
      )
      const actionLink = toHomeAssistantLink(
        device,
        actionToRun,
        serviceData,
        enabledCategories,
        link.linkedAt,
      )

      setIsActionRunning(true)
      setActionError('')
      setActionResult(null)
      setStatusMessage(`Running ${actionToRun.label} on ${device.name}...`)
      if (isTelevisionItem(item)) {
        const viewer = useViewer.getState()
        if (isHomeAssistantOffAction(actionToRun, actionLink)) {
          viewer.clearHomeAssistantItemEffect(item.id)
        } else if (!isDeferredHomeAssistantPowerToggle(actionToRun, actionLink)) {
          viewer.triggerHomeAssistantItemEffect(item.id)
        }
      }

      const response = await fetch('/api/home-assistant/device-action', {
        body: JSON.stringify({
          itemName: item.asset.name,
          link: actionLink,
        }),
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
      })
      const payload = (await response.json()) as HomeAssistantActionResponse & { error?: string }

      if (!response.ok) {
        throw new Error(payload.error || 'The Home Assistant action failed.')
      }

      setActionResult(payload)
      if (isTelevisionItem(item)) {
        const viewer = useViewer.getState()
        if (isHomeAssistantOffState(payload.finalState)) {
          viewer.clearHomeAssistantItemEffect(item.id)
        } else {
          viewer.triggerHomeAssistantItemEffect(item.id)
        }
      }
      setStatusMessage(payload.message)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'The Home Assistant action did not complete.'
      setActionError(message)
      setStatusMessage('The Home Assistant action did not complete.')
    } finally {
      setIsActionRunning(false)
    }
  }

  async function handleActionClick(action: HomeAssistantAvailableAction) {
    if (isActionRunning) {
      return
    }

    const nextFieldValues = getHomeAssistantRenderableFields(
      action,
      device ?? buildFallbackDevice(link),
    ).reduce<Record<string, unknown>>((values, field) => {
      values[field.key] =
        fieldValues[field.key] ??
        getHomeAssistantActionInitialFieldValue(
          action,
          field,
          device ?? buildFallbackDevice(link),
          link.serviceData,
        )
      return values
    }, {})

    setSelectedActionKey(action.key)
    setFieldValues(nextFieldValues)
    setActionError('')
    setActionResult(null)

    if (
      canRunHomeAssistantActionImmediately(
        action,
        device ?? buildFallbackDevice(link),
        nextFieldValues,
      )
    ) {
      await runAction(action, nextFieldValues)
      return
    }

    setStatusMessage(`Choose a ${action.label.toLowerCase()} option.`)
  }

  function optionValueKey(value: unknown) {
    return typeof value === 'string' ? value : JSON.stringify(value)
  }

  async function runSelectedActionIfReady(nextValues: Record<string, unknown>) {
    if (!device || !selectedAction) {
      return
    }

    try {
      buildHomeAssistantActionServiceData(selectedAction, device, nextValues)
      await runAction(selectedAction, nextValues)
    } catch {
      setStatusMessage(`Choose a ${selectedAction.label.toLowerCase()} option.`)
    }
  }

  function renderField(field: HomeAssistantAvailableActionField) {
    if (!device || !selectedAction) {
      return null
    }

    const selectorKey =
      field.selector && Object.keys(field.selector).length > 0
        ? Object.keys(field.selector)[0]
        : null
    const value = fieldValues[field.key]
    const options = getHomeAssistantActionFieldOptions(selectedAction, field, device)
    const fieldLabel = `${field.label}${field.required ? ' *' : ''}`
    const baseCardClass = 'rounded-2xl border border-white/10 bg-black/24 px-3 py-3'

    if (
      selectorKey === 'boolean' ||
      selectorKey === 'select' ||
      selectorKey === 'state' ||
      selectorKey === 'color_rgb' ||
      selectorKey === 'color_temp' ||
      selectorKey === 'media' ||
      selectorKey === 'constant'
    ) {
      return (
        <div
          className={baseCardClass}
          data-testid={`ha-connectivity-field-${field.key}`}
          key={field.key}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="block font-medium text-sm text-white">{fieldLabel}</span>
            <span className="text-[0.68rem] uppercase tracking-[0.18em] text-zinc-500">
              One Tap
            </span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {options.map((option: HomeAssistantFieldOption) => {
              const isSelected = optionValueKey(value) === optionValueKey(option.value)
              const isColor = selectorKey === 'color_rgb'
              const colorValue =
                isColor && Array.isArray(option.value)
                  ? `rgb(${option.value[0]}, ${option.value[1]}, ${option.value[2]})`
                  : null

              return (
                <button
                  className={cn(
                    'flex min-h-10 items-center justify-between gap-2 rounded-2xl border px-3 py-2 text-left text-sm transition',
                    isSelected
                      ? 'border-cyan-400/45 bg-cyan-500/14 text-cyan-50'
                      : 'border-white/10 bg-white/5 text-zinc-200 hover:border-white/20 hover:bg-white/8 hover:text-white',
                  )}
                  key={`${field.key}-${optionValueKey(option.value)}`}
                  onClick={() => {
                    const nextValues = {
                      ...fieldValues,
                      [field.key]: option.value,
                    }
                    setFieldValue(field.key, option.value)
                    void runSelectedActionIfReady(nextValues)
                  }}
                  type="button"
                >
                  <span className="truncate">{option.label}</span>
                  {colorValue ? (
                    <span
                      className="h-4 w-4 shrink-0 rounded-full border border-white/20"
                      style={{ backgroundColor: colorValue }}
                    />
                  ) : (
                    <HomeAssistantActionIconView
                      className="h-4 w-4 shrink-0"
                      icon={
                        selectorKey === 'boolean' && option.value === false ? 'toggle' : 'connect'
                      }
                    />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )
    }

    if (selectorKey === 'number') {
      const numberSelector =
        field.selector?.number && typeof field.selector.number === 'object'
          ? field.selector.number
          : null
      const min = numberSelector && 'min' in numberSelector ? Number(numberSelector.min) : 0
      const max = numberSelector && 'max' in numberSelector ? Number(numberSelector.max) : 100
      const step = numberSelector && 'step' in numberSelector ? Number(numberSelector.step) : 1
      const numericValue =
        typeof value === 'number'
          ? value
          : typeof value === 'string' && value.trim().length > 0
            ? Number.parseFloat(value)
            : min

      return (
        <div
          className={baseCardClass}
          data-testid={`ha-connectivity-field-${field.key}`}
          key={field.key}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="block font-medium text-sm text-white">{fieldLabel}</span>
            <span className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2 py-1 text-xs text-cyan-100">
              {Number.isFinite(numericValue)
                ? min === 0 && max === 1
                  ? `${Math.round(numericValue * 100)}%`
                  : numericValue
                : min}
            </span>
          </div>
          {options.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {options.map((option: HomeAssistantFieldOption) => (
                <button
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs transition',
                    optionValueKey(option.value) === optionValueKey(value)
                      ? 'border-cyan-400/45 bg-cyan-500/14 text-cyan-50'
                      : 'border-white/10 bg-white/5 text-zinc-300 hover:border-white/20 hover:bg-white/8 hover:text-white',
                  )}
                  key={`${field.key}-${optionValueKey(option.value)}`}
                  onClick={() => {
                    const nextValues = {
                      ...fieldValues,
                      [field.key]: option.value,
                    }
                    setFieldValue(field.key, option.value)
                    void runSelectedActionIfReady(nextValues)
                  }}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
          <input
            className="mt-3 w-full accent-cyan-400"
            max={String(max)}
            min={String(min)}
            onChange={(event) => setFieldValue(field.key, Number(event.target.value))}
            onPointerUp={(event) => {
              const nextValue = Number((event.target as HTMLInputElement).value)
              const nextValues = {
                ...fieldValues,
                [field.key]: nextValue,
              }
              setFieldValue(field.key, nextValue)
              void runSelectedActionIfReady(nextValues)
            }}
            step={String(step)}
            type="range"
            value={Number.isFinite(numericValue) ? numericValue : min}
          />
        </div>
      )
    }

    if (selectorKey === 'date' || selectorKey === 'time' || selectorKey === 'datetime') {
      const inputType = selectorKey === 'datetime' ? 'datetime-local' : selectorKey
      return (
        <label
          className={baseCardClass}
          data-testid={`ha-connectivity-field-${field.key}`}
          key={field.key}
        >
          <span className="block font-medium text-sm text-white">{fieldLabel}</span>
          <input
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-300/45"
            onChange={(event) => {
              const nextValues = {
                ...fieldValues,
                [field.key]: event.target.value,
              }
              setFieldValue(field.key, event.target.value)
              void runSelectedActionIfReady(nextValues)
            }}
            type={inputType}
            value={typeof value === 'string' ? value : ''}
          />
        </label>
      )
    }

    return null
  }

  return (
    <div
      className="pointer-events-auto w-[min(88vw,18rem)] rounded-[1.75rem] border border-cyan-400/25 bg-zinc-950/94 p-3 text-white shadow-[0_24px_80px_rgba(0,0,0,0.42)] backdrop-blur-xl"
      data-testid="ha-connectivity-panel"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-3">
        <button
          className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-zinc-200 transition hover:border-white/20 hover:bg-white/8 hover:text-white"
          onClick={onClose}
          type="button"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>

        <div className="min-w-0 flex-1 text-right">
          <p className="truncate font-medium text-sm text-white">{item.name || item.asset.name}</p>
          <p className="truncate text-xs text-zinc-400">{device?.name ?? link.deviceName}</p>
        </div>

        <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-500/10 text-cyan-100">
          <Tv className="h-4 w-4" />
        </span>
      </div>

      <div className="mt-3 rounded-[1.4rem] border border-white/10 bg-black/24 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs uppercase tracking-[0.18em] text-zinc-500">
              Connected features
            </p>
            <p className="mt-1 truncate font-medium text-sm text-white">
              {device?.name ?? link.deviceName}
            </p>
          </div>

          <button
            className="flex h-9 w-9 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-zinc-300 transition hover:border-white/20 hover:bg-white/8 hover:text-white"
            onClick={() => {
              setLoadState('loading')
              setActionError('')
              setActionResult(null)
              setStatusMessage('Refreshing Home Assistant features...')
              setReloadToken((currentValue) => currentValue + 1)
            }}
            title="Refresh Home Assistant features"
            type="button"
          >
            <RefreshCw className={cn('h-4 w-4', loadState === 'loading' && 'animate-spin')} />
          </button>
        </div>

        {enabledCategories.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2" data-testid="ha-connectivity-categories">
            {enabledCategories.map((category) => {
              const meta = getCategoryMeta(category)
              const isSelected = selectedCategory === category

              return (
                <button
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-2xl border transition',
                    isSelected
                      ? 'border-cyan-400/45 bg-cyan-500/14 text-cyan-100'
                      : 'border-white/10 bg-white/5 text-zinc-300 hover:border-white/20 hover:bg-white/8 hover:text-white',
                  )}
                  data-testid="ha-connectivity-category"
                  key={category}
                  onClick={() => {
                    setSelectedCategory(category)
                    setSelectedActionKey(null)
                    setFieldValues({})
                    setActionError('')
                    setActionResult(null)
                    setStatusMessage(`Choose a ${meta.label.toLowerCase()} feature to run.`)
                  }}
                  title={meta.label}
                  type="button"
                >
                  {meta.icon}
                </button>
              )
            })}
          </div>
        )}

        <div className="mt-3 rounded-[1.2rem] border border-white/10 bg-black/20 p-2">
          {loadState === 'loading' && (
            <div className="flex items-center gap-2 px-2 py-3 text-sm text-zinc-300">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              Loading device features...
            </div>
          )}

          {loadState === 'error' && (
            <div className="rounded-2xl border border-rose-500/35 bg-rose-500/10 px-3 py-3 text-sm text-rose-100">
              {loadError || 'Failed to load Home Assistant features.'}
            </div>
          )}

          {loadState === 'ready' && visibleActions.length === 0 && (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-zinc-300">
              No enabled actions are available in this category.
            </div>
          )}

          {loadState === 'ready' && visibleActions.length > 0 && (
            <div className="grid grid-cols-4 gap-2" data-testid="ha-connectivity-actions">
              {visibleActions.map((action) => {
                const isSelected = selectedAction?.key === action.key
                const renderableFieldCount = device
                  ? getHomeAssistantRenderableFields(action, device).length
                  : 0
                const actionPresentation = getHomeAssistantAvailableActionPresentation(action)

                return (
                  <button
                    className={cn(
                      'relative flex h-12 items-center justify-center rounded-2xl border transition',
                      isSelected
                        ? 'border-cyan-400/45 bg-cyan-500/14 text-cyan-100'
                        : 'border-white/10 bg-white/5 text-zinc-300 hover:border-white/20 hover:bg-white/8 hover:text-white',
                    )}
                    data-testid="ha-connectivity-action"
                    key={action.key}
                    onClick={() => void handleActionClick(action)}
                    title={action.label}
                    type="button"
                  >
                    <HomeAssistantActionIconView icon={actionPresentation.icon} />
                    {renderableFieldCount > 0 && (
                      <span className="absolute right-1.5 top-1.5 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-1 text-[0.58rem] font-medium leading-4 text-cyan-200">
                        {renderableFieldCount}
                      </span>
                    )}
                    {isSelected && (
                      <span className="absolute bottom-1.5 right-1.5 text-cyan-200">
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {selectedAction &&
          device &&
          getHomeAssistantRenderableFields(selectedAction, device).length > 0 && (
            <div className="mt-3 grid gap-2" data-testid="ha-connectivity-fields">
              {getHomeAssistantRenderableFields(selectedAction, device).map((field) =>
                renderField(field),
              )}
            </div>
          )}
      </div>

      <div
        className="mt-3 rounded-[1.25rem] border border-white/10 bg-black/24 px-3 py-3 text-sm text-zinc-200"
        data-testid="ha-connectivity-status"
      >
        {statusMessage}
      </div>

      {actionError && (
        <div className="mt-3 rounded-[1.25rem] border border-rose-500/35 bg-rose-500/10 px-3 py-3 text-sm text-rose-100">
          {actionError}
        </div>
      )}

      {actionResult && (
        <div
          className="mt-3 rounded-[1.25rem] border border-cyan-400/20 bg-cyan-500/10 px-3 py-3 text-sm text-cyan-50"
          data-testid="ha-connectivity-result"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">{actionResult.deviceName}</span>
            <span className="text-xs uppercase tracking-[0.16em] text-cyan-100/80">
              {actionResult.initialState} to {actionResult.finalState}
            </span>
          </div>
          {actionResult.observedAppNames.length > 0 && (
            <p className="mt-2 text-xs text-cyan-100/85">
              Observed receiver apps: {actionResult.observedAppNames.join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
