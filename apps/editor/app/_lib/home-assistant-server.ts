import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type {
  HomeAssistantActionRequest,
  HomeAssistantCollectionBinding,
} from '@pascal-app/viewer/home-assistant-bindings'
import type { HomeAssistantActionKind, HomeAssistantLink } from '../../../../packages/editor/src/lib/home-assistant'
import { refreshHomeAssistantAccessToken } from './home-assistant-auth'
import {
  clearLinkedHomeAssistantProfile,
  readLinkedHomeAssistantProfile,
  writeLinkedHomeAssistantProfile,
} from './home-assistant-linked-profile'

const DEFAULT_TEST_MEDIA_URL =
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4'
const DEFAULT_TEST_MEDIA_TYPE = 'video/mp4'
const DEFAULT_TEST_DURATION_SECONDS = 5
const DEFAULT_WAKE_DELAY_MS = 5000
const execFileAsync = promisify(execFile)

const CHROMECAST_RELEASE_SCRIPT = String.raw`
import json
import sys
import time

import pychromecast

target_host = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] != '__none__' else None
target_name = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] != '__none__' else None

if not target_host and not target_name:
    raise RuntimeError('Missing Chromecast host or name.')

chromecasts = []
browser = None
target = None

try:
    chromecasts, browser = pychromecast.get_chromecasts(timeout=8)

    if target_host:
        for chromecast in chromecasts:
            host = getattr(getattr(chromecast, 'cast_info', None), 'host', None)
            if host == target_host:
                target = chromecast
                break

    if target is None and target_name:
        for chromecast in chromecasts:
            if getattr(chromecast, 'name', None) == target_name:
                target = chromecast
                break

    if target is None:
        raise RuntimeError(f'Could not find Chromecast target for host={target_host!r} name={target_name!r}.')

    target.wait(timeout=10)

    before = {
        'app_display_name': getattr(target, 'app_display_name', None),
        'app_id': getattr(target, 'app_id', None),
        'is_idle': bool(getattr(target, 'is_idle', False)),
    }

    target.quit_app()
    for _ in range(12):
        if getattr(target, 'app_display_name', None) == 'Backdrop':
            break
        time.sleep(1)

    after = {
        'app_display_name': getattr(target, 'app_display_name', None),
        'app_id': getattr(target, 'app_id', None),
        'is_idle': bool(getattr(target, 'is_idle', False)),
    }

    print(json.dumps({'before': before, 'after': after}))
finally:
    if target is not None:
        try:
            target.disconnect()
        except Exception:
            pass

    if browser is not None:
        pychromecast.discovery.stop_discovery(browser)
`

export type HomeAssistantServerConfig = {
  accessToken: string
  baseUrl: string
  baseUrlCandidates: string[]
  castEntityId: string
  clientId?: string
  externalUrl?: string | null
  instanceUrl?: string
  mode?: 'linked-session' | 'local-env'
  testDurationSeconds: number
  testMediaType: string
  testMediaUrl: string
  wakeDelayMs: number
}

export type HomeAssistantEntityState = {
  attributes?: Record<string, unknown>
  entity_id: string
  state: string
}

type ChromecastReleaseResult = {
  afterAppDisplayName: string | null
  beforeAppDisplayName: string | null
  released: boolean
}

export type HomeAssistantServiceFieldDescription = {
  advanced?: boolean
  default?: unknown
  example?: unknown
  filter?: {
    attribute?: Record<string, unknown[]>
    supported_features?: Array<number | number[]>
  }
  required?: boolean
  selector?: Record<string, unknown>
}

export type HomeAssistantServiceDescription = {
  fields?: Record<string, HomeAssistantServiceFieldDescription>
  response?: {
    optional: boolean
  }
  target?: {
    entity?:
      | {
          domain?: string[]
          supported_features?: Array<number | number[]>
        }
      | Array<{
          domain?: string[]
          supported_features?: Array<number | number[]>
        }>
  }
}

export type HomeAssistantServiceRegistryEntry = {
  domain: string
  services: Record<string, HomeAssistantServiceDescription>
}

export type HomeAssistantDeviceActionResponse = {
  actionKind: HomeAssistantActionKind
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

export type HomeAssistantConnectionStatus = {
  baseUrl: string | null
  castEntityId: string | null
  castFriendlyName: string | null
  clientId: string | null
  entityCount: number
  externalUrl: string | null
  instanceUrl: string | null
  linked: boolean
  message: string
  mode: 'linked-session' | 'local-env' | 'unlinked'
  success: boolean
}

export type HomeAssistantCollectionActionResponse = {
  collectionName: string
  message: string
  results: Array<{
    entityId: string | null
    finalState: string | null
    resourceId: string
  }>
  success: boolean
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value?.trim() ?? `${fallback}`, 10)
  return Number.isFinite(parsed) ? Math.max(1, parsed) : fallback
}

function parseNonNegativeInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value?.trim() ?? `${fallback}`, 10)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback
}

export function readHomeAssistantServerConfig(): HomeAssistantServerConfig {
  const baseUrl = process.env.NEXT_PUBLIC_HA_BASE_URL?.trim() ?? ''
  const accessToken = process.env.NEXT_PUBLIC_HA_ACCESS_TOKEN?.trim() ?? ''
  const castEntityId = process.env.NEXT_PUBLIC_HA_CAST_ENTITY_ID?.trim() ?? ''

  return {
    accessToken,
    baseUrl: baseUrl.replace(/\/$/, ''),
    baseUrlCandidates: baseUrl ? [baseUrl.replace(/\/$/, '')] : [],
    castEntityId,
    clientId: undefined,
    externalUrl: null,
    instanceUrl: baseUrl.replace(/\/$/, ''),
    mode: 'local-env',
    testDurationSeconds: parsePositiveInt(
      process.env.NEXT_PUBLIC_HA_TEST_DURATION_SECONDS,
      DEFAULT_TEST_DURATION_SECONDS,
    ),
    testMediaType: process.env.NEXT_PUBLIC_HA_TEST_MEDIA_TYPE?.trim() ?? DEFAULT_TEST_MEDIA_TYPE,
    testMediaUrl: process.env.NEXT_PUBLIC_HA_TEST_MEDIA_URL?.trim() ?? DEFAULT_TEST_MEDIA_URL,
    wakeDelayMs: parseNonNegativeInt(process.env.NEXT_PUBLIC_HA_WAKE_DELAY_MS, DEFAULT_WAKE_DELAY_MS),
  }
}

export function hasHomeAssistantServerConfig(config: HomeAssistantServerConfig) {
  return Boolean(config.baseUrl && config.accessToken)
}

function getAccessTokenExpiresAt(expiresInSeconds: number) {
  return new Date(Date.now() + expiresInSeconds * 1000).toISOString()
}

function getLinkedProfileBaseUrlCandidates(linkedProfile: {
  externalUrl?: string | null
  instanceUrl: string
}) {
  return Array.from(
    new Set([linkedProfile.externalUrl, linkedProfile.instanceUrl].filter(Boolean)),
  ) as string[]
}

async function refreshLinkedProfileAccessToken(linkedProfile: {
  clientId: string
  externalUrl?: string | null
  instanceUrl: string
  refreshToken: string
}) {
  const candidates = getLinkedProfileBaseUrlCandidates(linkedProfile)
  let lastError: unknown = null

  for (const candidate of candidates) {
    try {
      return await refreshHomeAssistantAccessToken(
        candidate,
        linkedProfile.clientId,
        linkedProfile.refreshToken,
      )
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Failed to refresh the linked Home Assistant session.')
}

export async function resolveHomeAssistantServerConfig() {
  const linkedProfile = await readLinkedHomeAssistantProfile()
  if (!linkedProfile) {
    return readHomeAssistantServerConfig()
  }

  let accessToken = linkedProfile.accessToken
  let accessTokenExpiresAt = Date.parse(linkedProfile.accessTokenExpiresAt)

  if (!Number.isFinite(accessTokenExpiresAt) || accessTokenExpiresAt <= Date.now() + 60_000) {
    try {
      const refreshedTokens = await refreshLinkedProfileAccessToken(linkedProfile)
      accessToken = refreshedTokens.access_token
      accessTokenExpiresAt = Date.parse(getAccessTokenExpiresAt(refreshedTokens.expires_in))

      await writeLinkedHomeAssistantProfile({
        ...linkedProfile,
        accessToken,
        accessTokenExpiresAt: new Date(accessTokenExpiresAt).toISOString(),
      })
    } catch (error) {
      await clearLinkedHomeAssistantProfile()
      throw error instanceof Error
        ? error
        : new Error('Failed to refresh the linked Home Assistant session.')
    }
  }

  const fallbackConfig = readHomeAssistantServerConfig()
  const baseUrlCandidates = getLinkedProfileBaseUrlCandidates(linkedProfile)
  const preferredBaseUrl = baseUrlCandidates[0] ?? linkedProfile.instanceUrl

  return {
    accessToken,
    baseUrl: preferredBaseUrl,
    baseUrlCandidates,
    castEntityId: fallbackConfig.castEntityId,
    clientId: linkedProfile.clientId,
    externalUrl: linkedProfile.externalUrl,
    instanceUrl: linkedProfile.instanceUrl,
    mode: 'linked-session',
    testDurationSeconds: fallbackConfig.testDurationSeconds,
    testMediaType: fallbackConfig.testMediaType,
    testMediaUrl: fallbackConfig.testMediaUrl,
    wakeDelayMs: fallbackConfig.wakeDelayMs,
  } satisfies HomeAssistantServerConfig
}

function getRequestBaseUrlCandidates(config: HomeAssistantServerConfig) {
  return Array.from(
    new Set([config.baseUrl, ...config.baseUrlCandidates].filter(Boolean)),
  )
}

function shouldRetryHomeAssistantRequest(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true
  }

  if (error instanceof TypeError) {
    return true
  }

  if (error instanceof Error && /fetch failed/i.test(error.message)) {
    return true
  }

  return false
}

export async function haRequest<T>(
  config: HomeAssistantServerConfig,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const candidates = getRequestBaseUrlCandidates(config)
  let lastError: unknown = null

  for (const baseUrl of candidates) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          ...(init?.headers ?? {}),
        },
        cache: 'no-store',
        signal: init?.signal ?? AbortSignal.timeout(8000),
      })

      if (!response.ok) {
        const body = await response.text()
        const error = new Error(`HA ${response.status} ${response.statusText}: ${body || 'request failed'}`)

        if ([502, 503, 504].includes(response.status) && baseUrl !== candidates.at(-1)) {
          lastError = error
          continue
        }

        throw error
      }

      if (response.status === 204) {
        return undefined as T
      }

      return (await response.json()) as T
    } catch (error) {
      lastError = error
      if (!shouldRetryHomeAssistantRequest(error) || baseUrl === candidates.at(-1)) {
        throw error
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Home Assistant request failed.')
}

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runPythonReleaseScript(host: string | null, name: string | null) {
  const normalizedHost = host && host.trim().length > 0 ? host.trim() : '__none__'
  const normalizedName = name && name.trim().length > 0 ? name.trim() : '__none__'
  const candidates = [
    { command: 'python', args: ['-c', CHROMECAST_RELEASE_SCRIPT, normalizedHost, normalizedName] },
    { command: 'py', args: ['-3', '-c', CHROMECAST_RELEASE_SCRIPT, normalizedHost, normalizedName] },
  ] as const

  let lastError: unknown = null
  for (const candidate of candidates) {
    try {
      const result = await execFileAsync(candidate.command, candidate.args, {
        timeout: 30000,
      })
      return result.stdout
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Unable to run the Chromecast cleanup helper.')
}

export async function releaseChromecastReceiver(
  host: string | null,
  name: string | null,
): Promise<ChromecastReleaseResult> {
  const stdout = await runPythonReleaseScript(host, name)
  const payload = JSON.parse(stdout.trim()) as {
    after?: { app_display_name?: unknown }
    before?: { app_display_name?: unknown }
  }

  const beforeAppDisplayName =
    typeof payload.before?.app_display_name === 'string' ? payload.before.app_display_name : null
  const afterAppDisplayName =
    typeof payload.after?.app_display_name === 'string' ? payload.after.app_display_name : null

  return {
    afterAppDisplayName,
    beforeAppDisplayName,
    released:
      afterAppDisplayName === 'Backdrop' ||
      afterAppDisplayName === null,
  }
}

export function getEntityState(config: HomeAssistantServerConfig, entityId: string) {
  return haRequest<HomeAssistantEntityState>(config, `/api/states/${entityId}`)
}

export function listEntityStates(config: HomeAssistantServerConfig) {
  return haRequest<HomeAssistantEntityState[]>(config, '/api/states')
}

export function listServices(config: HomeAssistantServerConfig) {
  return haRequest<HomeAssistantServiceRegistryEntry[]>(config, '/api/services')
}

export function callService(
  config: HomeAssistantServerConfig,
  domain: string,
  service: string,
  data: Record<string, unknown>,
) {
  return haRequest<unknown>(config, `/api/services/${domain}/${service}`, {
    body: JSON.stringify(data),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  })
}

function getResourceActionForRequest(
  binding: HomeAssistantCollectionBinding,
  resource: HomeAssistantCollectionBinding['resources'][number],
  request: HomeAssistantActionRequest,
) {
  const actions = resource.actions ?? []
  const defaultAction =
    (resource.defaultActionKey
      ? actions.find((action) => action.key === resource.defaultActionKey)
      : null) ??
    actions[0] ??
    null

  if (request.kind === 'trigger') {
    return defaultAction
  }

  if (request.kind === 'toggle') {
    const desiredServices = request.value ? ['turn_on', 'open_cover'] : ['turn_off', 'close_cover']
    return (
      actions.find((action) => desiredServices.includes(action.service)) ??
      actions.find((action) => action.service === 'toggle') ??
      defaultAction
    )
  }

  const serviceCandidatesByCapability: Record<
  Extract<HomeAssistantActionRequest, { kind: 'range' }>['capability'],
    string[]
  > = {
    brightness: ['turn_on', 'set_percentage'],
    speed: ['set_percentage', 'set_fan_speed'],
    temperature: ['set_temperature'],
    volume: ['volume_set'],
  }

  return (
    actions.find((action) =>
      serviceCandidatesByCapability[request.capability].includes(action.service),
    ) ?? defaultAction
  )
}

function normalizeRangeValueForField(fieldKey: string, value: number) {
  if (fieldKey === 'brightness_pct' || fieldKey === 'percentage') {
    if (value <= 1) {
      return Math.max(0, Math.min(100, Math.round(value * 100)))
    }
    return Math.max(0, Math.min(100, Math.round(value)))
  }

  if (fieldKey === 'brightness') {
    if (value <= 1) {
      return Math.max(0, Math.min(255, Math.round(value * 255)))
    }
    if (value <= 100) {
      return Math.max(0, Math.min(255, Math.round((value / 100) * 255)))
    }
    return Math.max(0, Math.min(255, Math.round(value)))
  }

  if (fieldKey === 'volume_level') {
    if (value <= 1) {
      return Math.max(0, Math.min(1, value))
    }
    return Math.max(0, Math.min(1, value / 100))
  }

  return value
}

function buildCollectionServiceData(
  action: NonNullable<ReturnType<typeof getResourceActionForRequest>>,
  request: HomeAssistantActionRequest,
) {
  if (request.kind !== 'range') {
    return {}
  }

  const fieldKeys = (action.fields ?? []).map((field) => field.key)
  const preferredFieldKeyByCapability: Record<
  Extract<HomeAssistantActionRequest, { kind: 'range' }>['capability'],
    string[]
  > = {
    brightness: ['brightness_pct', 'brightness'],
    speed: ['percentage', 'fan_speed'],
    temperature: ['temperature'],
    volume: ['volume_level'],
  }

  const targetFieldKey =
    preferredFieldKeyByCapability[request.capability].find((fieldKey) => fieldKeys.includes(fieldKey)) ??
    fieldKeys[0]

  return targetFieldKey
    ? {
        [targetFieldKey]: normalizeRangeValueForField(targetFieldKey, request.value),
      }
    : {}
}

export async function readCastEntityFriendlyName(config: HomeAssistantServerConfig) {
  if (!hasHomeAssistantServerConfig(config) || !config.castEntityId) {
    return null
  }

  try {
    const state = await getEntityState(config, config.castEntityId)
    const friendlyName = state.attributes?.friendly_name
    return typeof friendlyName === 'string' && friendlyName.trim().length > 0
      ? friendlyName.trim()
      : null
  } catch {
    return null
  }
}

export async function validateHomeAssistantConnection(
  config: HomeAssistantServerConfig,
): Promise<HomeAssistantConnectionStatus> {
  if (!hasHomeAssistantServerConfig(config)) {
    return {
      baseUrl: null,
      castEntityId: null,
      castFriendlyName: null,
      clientId: null,
      entityCount: 0,
      externalUrl: null,
      instanceUrl: null,
      linked: false,
      message: 'Home Assistant is not linked yet.',
      mode: 'unlinked',
      success: false,
    }
  }

  const states = await listEntityStates(config)
  let castFriendlyName: string | null = null
  if (config.castEntityId) {
    try {
      const castState = await getEntityState(config, config.castEntityId)
      const friendlyName = castState.attributes?.friendly_name
      castFriendlyName =
        typeof friendlyName === 'string' && friendlyName.trim().length > 0 ? friendlyName.trim() : null
    } catch {
      castFriendlyName = null
    }
  }

  const isLinkedSession = config.mode === 'linked-session'

  return {
    baseUrl: config.baseUrl,
    castEntityId: config.castEntityId,
    castFriendlyName,
    clientId: config.clientId ?? null,
    entityCount: states.length,
    externalUrl: config.externalUrl ?? null,
    instanceUrl: config.instanceUrl ?? config.baseUrl ?? null,
    linked: true,
    message: isLinkedSession
      ? `Connected to Home Assistant at ${config.baseUrl}.`
      : `Connected to local Home Assistant at ${config.baseUrl}.`,
    mode: isLinkedSession ? 'linked-session' : 'local-env',
    success: true,
  }
}

export async function runHomeAssistantDeviceAction(
  config: HomeAssistantServerConfig,
  itemName: string,
  link: HomeAssistantLink,
): Promise<HomeAssistantDeviceActionResponse> {
  if (!hasHomeAssistantServerConfig(config)) {
    throw new Error('Home Assistant is not linked yet.')
  }

  const entityId = link.haEntityId ?? config.castEntityId
  if (!entityId) {
    throw new Error(`No Home Assistant entity is mapped for ${link.deviceName}.`)
  }

  if (
    link.actionKind === 'connect' &&
    link.serviceDomain === 'media_player' &&
    link.serviceName === 'play_media' &&
    Object.keys(link.serviceData).length === 0
  ) {
    const initial = await getEntityState(config, entityId)
    if (initial.state === 'unavailable') {
      throw new Error(`Entity ${entityId} is unavailable in Home Assistant.`)
    }

    await callService(config, 'media_player', 'play_media', {
      entity_id: entityId,
      media_content_id: config.testMediaUrl,
      media_content_type: config.testMediaType,
    })

    const timeline: HomeAssistantDeviceActionResponse['timeline'] = []
    for (let second = 1; second <= config.testDurationSeconds; second += 1) {
      await delay(1000)
      const sample = await getEntityState(config, entityId)
      timeline.push({
        appName: typeof sample.attributes?.app_name === 'string' ? sample.attributes.app_name : null,
        mediaTitle:
          typeof sample.attributes?.media_title === 'string' ? sample.attributes.media_title : null,
        second,
        state: sample.state,
      })
    }

    await callService(config, 'media_player', 'media_stop', {
      entity_id: entityId,
    })

    const releaseResult = await releaseChromecastReceiver(link.ip, link.deviceName)
    await delay(1500)
    const finalState = await getEntityState(config, entityId)
    const observedAppNames = Array.from(
      new Set(
        timeline
          .map((entry) => entry.appName?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    )
    const availableAfterAction = releaseResult.released || finalState.state === 'off'
    const friendlyName = initial.attributes?.friendly_name

    return {
      actionKind: link.actionKind,
      availableAfterAction,
      deviceName: link.deviceName,
      finalState: finalState.state,
      initialFriendlyName:
        typeof friendlyName === 'string' && friendlyName.trim().length > 0 ? friendlyName : null,
      initialState: initial.state,
      itemName,
      message: availableAfterAction
        ? `${itemName} responded through Home Assistant and the Chromecast was returned to its normal idle state.`
        : `${itemName} responded through Home Assistant, but the Chromecast did not return to its normal idle state.`,
      observedAppNames,
      success: observedAppNames.length > 0 && availableAfterAction,
      timeline,
    }
  }

  if (link.actionKind === 'power' && link.serviceDomain === 'homeassistant' && link.serviceName === 'toggle') {
    const initial = await getEntityState(config, entityId)
    const initiallyOn = initial.state !== 'off'
    const service = initiallyOn ? 'turn_off' : 'turn_on'

    await callService(config, 'homeassistant', service, {
      entity_id: entityId,
    })
    await delay(1500)

    const finalState = await getEntityState(config, entityId)
    const friendlyName = initial.attributes?.friendly_name

    return {
      actionKind: 'power',
      availableAfterAction: true,
      deviceName: link.deviceName,
      finalState: finalState.state,
      initialFriendlyName:
        typeof friendlyName === 'string' && friendlyName.trim().length > 0 ? friendlyName : null,
      initialState: initial.state,
      itemName,
      message: `${itemName} toggled ${link.deviceName} through Home Assistant.`,
      observedAppNames: [],
      success: initial.state !== finalState.state,
      timeline: [],
    }
  }

  const initial = await getEntityState(config, entityId)
  if (initial.state === 'unavailable') {
    throw new Error(`Entity ${entityId} is unavailable in Home Assistant.`)
  }

  await callService(config, link.serviceDomain, link.serviceName, {
    entity_id: entityId,
    ...link.serviceData,
  })
  await delay(1500)
  const finalState = await getEntityState(config, entityId)
  const friendlyName = initial.attributes?.friendly_name

  return {
    actionKind: link.actionKind,
    availableAfterAction: true,
    deviceName: link.deviceName,
    finalState: finalState.state,
    initialFriendlyName:
      typeof friendlyName === 'string' && friendlyName.trim().length > 0 ? friendlyName : null,
    initialState: initial.state,
    itemName,
    message: `${itemName} ran ${link.actionLabel} on ${link.deviceName} through Home Assistant.`,
    observedAppNames: [],
    success: finalState.state !== 'unavailable',
    timeline: [],
  }
}

export async function runHomeAssistantCollectionAction(
  config: HomeAssistantServerConfig,
  collectionName: string,
  binding: HomeAssistantCollectionBinding,
  request: HomeAssistantActionRequest,
): Promise<HomeAssistantCollectionActionResponse> {
  if (!hasHomeAssistantServerConfig(config)) {
    throw new Error('Home Assistant is not linked yet.')
  }

  const resources = binding.resources ?? []
  if (resources.length === 0) {
    throw new Error(`No Home Assistant resources are linked to ${collectionName}.`)
  }

  const shouldUsePrimaryOnly =
    binding.aggregation === 'primary' || binding.aggregation === 'single'
  const primaryResourceId =
    binding.primaryResourceId ?? resources[0]?.id ?? null
  const targetResources = shouldUsePrimaryOnly
    ? resources.filter((resource) => resource.id === primaryResourceId).slice(0, 1)
    : resources

  const results: HomeAssistantCollectionActionResponse['results'] = []

  for (const resource of targetResources) {
    const action = getResourceActionForRequest(binding, resource, request)
    if (!action) {
      continue
    }

    const entityId = resource.entityId ?? null
    const serviceData = buildCollectionServiceData(action, request)
    const payload =
      entityId && action.domain !== 'scene'
        ? { entity_id: entityId, ...serviceData }
        : entityId
          ? { entity_id: entityId, ...serviceData }
          : { ...serviceData }

    await callService(config, action.domain, action.service, payload)

    let finalState: string | null = null
    if (entityId) {
      try {
        const state = await getEntityState(config, entityId)
        finalState = state.state
      } catch {
        finalState = null
      }
    }

    results.push({
      entityId,
      finalState,
      resourceId: resource.id,
    })
  }

  return {
    collectionName,
    message: `Ran Home Assistant action for ${collectionName}.`,
    results,
    success: results.length > 0,
  }
}
