import { createHash } from 'node:crypto'
import dgram from 'node:dgram'
import type {
  HomeAssistantActionKind,
  HomeAssistantActionPresentation,
  HomeAssistantAvailableAction,
  HomeAssistantAvailableActionField,
  HomeAssistantCapabilityCategory,
  HomeAssistantDiscoveredDevice,
  HomeAssistantServiceTargetFilter,
} from '../../../../packages/editor/src/lib/home-assistant'
import {
  getHomeAssistantAvailableActionPresentation,
  getHomeAssistantCapabilityCategory,
} from '../../../../packages/editor/src/lib/home-assistant'
import {
  type HomeAssistantEntityState,
  type HomeAssistantServerConfig,
  type HomeAssistantServiceDescription,
  type HomeAssistantServiceRegistryEntry,
  hasHomeAssistantServerConfig,
  listEntityStates,
  listServices,
  readCastEntityFriendlyName,
} from './home-assistant-server'

const MDNS_GROUP = '224.0.0.251'
const MDNS_PORT = 5353
const SSDP_GROUP = '239.255.255.250'
const SSDP_PORT = 1900
const DISCOVERY_TIMEOUT_MS = 1800

const MDNS_SERVICES: Array<{
  actionKind: HomeAssistantActionKind
  actionLabel: string
  deviceType: string
  serviceType: string
}> = [
  {
    actionKind: 'connect',
    actionLabel: 'Connect',
    deviceType: 'Google Cast',
    serviceType: '_googlecast._tcp.local',
  },
  {
    actionKind: 'power',
    actionLabel: 'Power',
    deviceType: 'ESPHome Device',
    serviceType: '_esphomelib._tcp.local',
  },
  {
    actionKind: 'power',
    actionLabel: 'Power',
    deviceType: 'HomeKit Device',
    serviceType: '_hap._tcp.local',
  },
  {
    actionKind: 'power',
    actionLabel: 'Power',
    deviceType: 'Matter Device',
    serviceType: '_matter._tcp.local',
  },
]

const HA_DISCOVERABLE_DOMAINS = new Set([
  'climate',
  'cover',
  'fan',
  'light',
  'lock',
  'media_player',
  'switch',
  'vacuum',
])

type MdnsRecord =
  | {
      classCode: number
      name: string
      ttl: number
      type: 1 | 28
      value: string
    }
  | {
      classCode: number
      name: string
      ttl: number
      type: 12
      value: string
    }
  | {
      classCode: number
      name: string
      port: number
      priority: number
      target: string
      ttl: number
      type: 33
      weight: number
    }
  | {
      classCode: number
      entries: string[]
      name: string
      properties: Record<string, string>
      ttl: number
      type: 16
    }

type SsdpResponse = {
  headers: Record<string, string>
  location: string | null
  server: string | null
  st: string | null
  usn: string | null
}

type DeviceDescription = {
  deviceType: string | null
  friendlyName: string | null
  manufacturer: string | null
  modelName: string | null
}

type SsdpClassification = {
  actionKind: HomeAssistantActionKind
  actionLabel: string
  deviceType: string
}

function stableDeviceId(parts: Array<string | null | undefined>) {
  const hash = createHash('sha1')
  for (const part of parts) {
    if (part) {
      hash.update(part)
    }
    hash.update('|')
  }
  return hash.digest('hex').slice(0, 16)
}

function getEntityDomain(entityId: string) {
  return entityId.split('.')[0] ?? ''
}

function encodeDnsName(name: string) {
  const parts = name.replace(/\.$/, '').split('.')
  return Buffer.concat([
    ...parts.map((part) => Buffer.concat([Buffer.from([part.length]), Buffer.from(part, 'utf8')])),
    Buffer.from([0]),
  ])
}

function buildMdnsQuery(serviceTypes: string[]) {
  const header = Buffer.alloc(12)
  header.writeUInt16BE(0, 0)
  header.writeUInt16BE(0, 2)
  header.writeUInt16BE(serviceTypes.length, 4)
  header.writeUInt16BE(0, 6)
  header.writeUInt16BE(0, 8)
  header.writeUInt16BE(0, 10)

  const questions = serviceTypes.map((serviceType) =>
    Buffer.concat([
      encodeDnsName(serviceType),
      Buffer.from([0x00, 0x0c]),
      Buffer.from([0x00, 0x01]),
    ]),
  )

  return Buffer.concat([header, ...questions])
}

function decodeDnsName(
  buffer: Buffer,
  offset: number,
  visited = new Set<number>(),
): { name: string; offset: number } {
  if (visited.has(offset)) {
    return { name: '', offset: offset + 1 }
  }
  visited.add(offset)

  const labels: string[] = []
  let currentOffset = offset
  let finalOffset = offset
  let jumped = false

  while (currentOffset < buffer.length) {
    const length = buffer[currentOffset] ?? 0
    if (length === 0) {
      finalOffset = jumped ? finalOffset : currentOffset + 1
      break
    }

    if ((length & 0xc0) === 0xc0) {
      const pointer = ((length & 0x3f) << 8) | (buffer[currentOffset + 1] ?? 0)
      const decoded = decodeDnsName(buffer, pointer, visited)
      if (decoded.name) {
        labels.push(decoded.name)
      }
      finalOffset = jumped ? finalOffset : currentOffset + 2
      jumped = true
      break
    }

    const labelStart = currentOffset + 1
    const labelEnd = labelStart + length
    labels.push(buffer.toString('utf8', labelStart, labelEnd))
    currentOffset = labelEnd
    if (!jumped) {
      finalOffset = currentOffset
    }
  }

  return { name: labels.filter(Boolean).join('.'), offset: finalOffset }
}

function parseTxtRecord(data: Buffer) {
  const entries: string[] = []
  const properties: Record<string, string> = {}
  let offset = 0

  while (offset < data.length) {
    const length = data[offset]
    offset += 1
    if (!length || offset + length > data.length) {
      continue
    }
    const entry = data.toString('utf8', offset, offset + length)
    entries.push(entry)
    const separatorIndex = entry.indexOf('=')
    if (separatorIndex >= 0) {
      properties[entry.slice(0, separatorIndex)] = entry.slice(separatorIndex + 1)
    } else {
      properties[entry] = ''
    }
    offset += length
  }

  return { entries, properties }
}

function parseMdnsPacket(message: Buffer) {
  if (message.length < 12) {
    return [] as MdnsRecord[]
  }

  const questionCount = message.readUInt16BE(4)
  const answerCount = message.readUInt16BE(6)
  const authorityCount = message.readUInt16BE(8)
  const additionalCount = message.readUInt16BE(10)

  let offset = 12
  for (let index = 0; index < questionCount; index += 1) {
    const decoded = decodeDnsName(message, offset)
    offset = decoded.offset + 4
  }

  const recordCount = answerCount + authorityCount + additionalCount
  const records: MdnsRecord[] = []

  for (let index = 0; index < recordCount; index += 1) {
    const nameDecoded = decodeDnsName(message, offset)
    offset = nameDecoded.offset
    if (offset + 10 > message.length) {
      break
    }

    const type = message.readUInt16BE(offset)
    const classCode = message.readUInt16BE(offset + 2) & 0x7fff
    const ttl = message.readUInt32BE(offset + 4)
    const dataLength = message.readUInt16BE(offset + 8)
    const dataOffset = offset + 10
    const dataEnd = dataOffset + dataLength
    if (dataEnd > message.length) {
      break
    }

    if (type === 12) {
      const value = decodeDnsName(message, dataOffset).name
      records.push({ classCode, name: nameDecoded.name, ttl, type: 12, value })
    } else if (type === 33) {
      const priority = message.readUInt16BE(dataOffset)
      const weight = message.readUInt16BE(dataOffset + 2)
      const port = message.readUInt16BE(dataOffset + 4)
      const target = decodeDnsName(message, dataOffset + 6).name
      records.push({
        classCode,
        name: nameDecoded.name,
        port,
        priority,
        target,
        ttl,
        type: 33,
        weight,
      })
    } else if (type === 16) {
      const parsed = parseTxtRecord(message.subarray(dataOffset, dataEnd))
      records.push({
        classCode,
        entries: parsed.entries,
        name: nameDecoded.name,
        properties: parsed.properties,
        ttl,
        type: 16,
      })
    } else if (type === 1) {
      const value = Array.from(message.subarray(dataOffset, dataEnd)).join('.')
      records.push({ classCode, name: nameDecoded.name, ttl, type: 1, value })
    } else if (type === 28) {
      const groups: string[] = []
      for (let groupIndex = 0; groupIndex < dataLength; groupIndex += 2) {
        groups.push(message.readUInt16BE(dataOffset + groupIndex).toString(16))
      }
      records.push({ classCode, name: nameDecoded.name, ttl, type: 28, value: groups.join(':') })
    }

    offset = dataEnd
  }

  return records
}

function collectUdpMessages({
  onMessage,
  send,
  timeoutMs,
}: {
  onMessage: (message: Buffer, info: dgram.RemoteInfo) => void
  send: (socket: dgram.Socket) => void
  timeoutMs: number
}) {
  return new Promise<void>((resolve) => {
    const socket = dgram.createSocket({ reuseAddr: true, type: 'udp4' })
    socket.on('error', () => {
      socket.close()
      resolve()
    })
    socket.on('message', (message, info) => onMessage(message, info))
    socket.bind(0, () => {
      try {
        send(socket)
      } catch {
        socket.close()
        resolve()
      }
    })
    setTimeout(() => {
      socket.close()
      resolve()
    }, timeoutMs)
  })
}

async function discoverMdnsDevices(
  config: HomeAssistantServerConfig,
  castFriendlyName: string | null,
) {
  const records: MdnsRecord[] = []
  const query = buildMdnsQuery(MDNS_SERVICES.map((entry) => entry.serviceType))

  await collectUdpMessages({
    onMessage: (message) => {
      records.push(...parseMdnsPacket(message))
    },
    send: (socket) => {
      socket.setMulticastTTL(255)
      socket.send(query, MDNS_PORT, MDNS_GROUP)
    },
    timeoutMs: DISCOVERY_TIMEOUT_MS,
  })

  const devices = new Map<string, HomeAssistantDiscoveredDevice>()

  for (const service of MDNS_SERVICES) {
    const ptrRecords = records.filter(
      (record): record is Extract<MdnsRecord, { type: 12 }> =>
        record.type === 12 && record.name === service.serviceType,
    )

    for (const ptrRecord of ptrRecords) {
      const instanceName = ptrRecord.value
      const srvRecord = records.find(
        (record): record is Extract<MdnsRecord, { type: 33 }> =>
          record.type === 33 && record.name === instanceName,
      )
      const txtRecord = records.find(
        (record): record is Extract<MdnsRecord, { type: 16 }> =>
          record.type === 16 && record.name === instanceName,
      )

      const hostName = srvRecord?.target ?? instanceName
      const addressRecord = records.find(
        (record): record is Extract<MdnsRecord, { type: 1 | 28 }> =>
          (record.type === 1 || record.type === 28) && record.name === hostName,
      )

      const friendlyName =
        txtRecord?.properties.fn ??
        txtRecord?.properties.name ??
        instanceName.replace(`.${service.serviceType}`, '')
      const manufacturer = txtRecord?.properties.mf ?? null
      const model = txtRecord?.properties.md ?? null
      const ip = addressRecord?.value ?? null
      const isCastDevice = service.serviceType === '_googlecast._tcp.local'
      const actionable =
        isCastDevice &&
        Boolean(config.castEntityId) &&
        (!castFriendlyName || !friendlyName || castFriendlyName === friendlyName)

      const description = `${service.deviceType} via mDNS (${service.serviceType})`
      const id = `mdns-${stableDeviceId([service.serviceType, friendlyName, ip, txtRecord?.properties.id])}`

      devices.set(id, {
        actionable,
        attributes: null,
        availableActions: [],
        enabledActionCategories: [],
        defaultActionKey: null,
        defaultServiceData: {},
        description,
        deviceType: service.deviceType,
        haEntityId: actionable ? config.castEntityId : null,
        id,
        ip,
        manufacturer,
        model,
        name: friendlyName,
        protocol: 'mdns',
        serviceType: service.serviceType,
        supportedFeatures: null,
      })
    }
  }

  return Array.from(devices.values())
}

function parseSsdpResponse(message: Buffer) {
  const lines = message
    .toString('utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const headers: Record<string, string> = {}
  for (const line of lines.slice(1)) {
    const separatorIndex = line.indexOf(':')
    if (separatorIndex <= 0) {
      continue
    }
    const key = line.slice(0, separatorIndex).trim().toLowerCase()
    headers[key] = line.slice(separatorIndex + 1).trim()
  }

  return {
    headers,
    location: headers.location ?? null,
    server: headers.server ?? null,
    st: headers.st ?? null,
    usn: headers.usn ?? null,
  } satisfies SsdpResponse
}

function buildSsdpSearch(st: string) {
  return Buffer.from(
    [
      'M-SEARCH * HTTP/1.1',
      `HOST: ${SSDP_GROUP}:${SSDP_PORT}`,
      'MAN: "ssdp:discover"',
      'MX: 1',
      `ST: ${st}`,
      '',
      '',
    ].join('\r\n'),
  )
}

function matchXmlTag(xml: string, tagName: string) {
  const match = new RegExp(`<${tagName}>([^<]+)</${tagName}>`, 'i').exec(xml)
  return match?.[1]?.trim() ?? null
}

async function fetchDeviceDescription(location: string | null) {
  if (!location) {
    return null
  }

  try {
    const response = await fetch(location, {
      cache: 'no-store',
      signal: AbortSignal.timeout(1200),
    })
    if (!response.ok) {
      return null
    }

    const xml = await response.text()
    return {
      deviceType: matchXmlTag(xml, 'deviceType'),
      friendlyName: matchXmlTag(xml, 'friendlyName'),
      manufacturer: matchXmlTag(xml, 'manufacturer'),
      modelName: matchXmlTag(xml, 'modelName'),
    } satisfies DeviceDescription
  } catch {
    return null
  }
}

function classifySsdpResponse(
  response: SsdpResponse,
  description: DeviceDescription | null,
): SsdpClassification | null {
  const haystack = [
    response.st,
    response.usn,
    response.server,
    description?.deviceType,
    description?.friendlyName,
    description?.manufacturer,
    description?.modelName,
    response.location,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  if (haystack.includes('roku')) {
    return {
      actionKind: 'connect',
      actionLabel: 'Connect',
      deviceType: 'Roku Device',
    }
  }

  if (
    haystack.includes('google cast') ||
    haystack.includes('chromecast') ||
    haystack.includes('mediarenderer') ||
    haystack.includes('sonos')
  ) {
    return {
      actionKind:
        haystack.includes('chromecast') || haystack.includes('google cast') ? 'connect' : 'play',
      actionLabel:
        haystack.includes('chromecast') || haystack.includes('google cast') ? 'Connect' : 'Play',
      deviceType:
        haystack.includes('chromecast') || haystack.includes('google cast')
          ? 'Google Cast'
          : 'Media Renderer',
    }
  }

  if (
    haystack.includes('wemo') ||
    haystack.includes('tplink') ||
    haystack.includes('tapo') ||
    haystack.includes('shelly') ||
    haystack.includes('switch') ||
    haystack.includes('smart plug') ||
    haystack.includes('plug') ||
    haystack.includes('light')
  ) {
    return {
      actionKind: 'power',
      actionLabel: 'Power',
      deviceType: 'Smart Power Device',
    }
  }

  return null
}

async function discoverSsdpDevices(
  config: HomeAssistantServerConfig,
  castFriendlyName: string | null,
) {
  const responses = new Map<string, SsdpResponse>()
  const searchTargets = ['ssdp:all', 'roku:ecp', 'urn:schemas-upnp-org:device:MediaRenderer:1']

  await collectUdpMessages({
    onMessage: (message) => {
      const response = parseSsdpResponse(message)
      const key =
        response.usn ??
        response.location ??
        response.st ??
        stableDeviceId([message.toString('utf8')])
      responses.set(key, response)
    },
    send: (socket) => {
      for (const searchTarget of searchTargets) {
        socket.send(buildSsdpSearch(searchTarget), SSDP_PORT, SSDP_GROUP)
      }
    },
    timeoutMs: DISCOVERY_TIMEOUT_MS,
  })

  const devices: HomeAssistantDiscoveredDevice[] = []

  for (const response of responses.values()) {
    const description = await fetchDeviceDescription(response.location)
    const classification = classifySsdpResponse(response, description)
    if (!classification) {
      continue
    }

    const name = description?.friendlyName ?? response.server ?? response.st ?? 'Unknown device'
    const ip = response.location?.match(/https?:\/\/([^/:]+)/i)?.[1] ?? null
    const isCastDevice = classification.deviceType === 'Google Cast'
    const actionable =
      isCastDevice &&
      Boolean(config.castEntityId) &&
      (!castFriendlyName || !name || castFriendlyName === name)

    devices.push({
      actionable,
      attributes: null,
      availableActions: [],
      enabledActionCategories: [],
      defaultActionKey: null,
      defaultServiceData: {},
      description: `${classification.deviceType} via SSDP`,
      deviceType: classification.deviceType,
      haEntityId: actionable ? config.castEntityId : null,
      id: `ssdp-${stableDeviceId([response.usn, response.location, name, ip])}`,
      ip,
      manufacturer: description?.manufacturer ?? null,
      model: description?.modelName ?? null,
      name,
      protocol: 'ssdp',
      serviceType: response.st,
      supportedFeatures: null,
    })
  }

  return devices
}

function readStringAttribute(attributes: Record<string, unknown> | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = attributes?.[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }

  return null
}

function titleCase(value: string) {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function normalizeSupportedFeatureGroups(
  supportedFeatures: Array<number | number[]> | undefined,
): Array<number | number[]> {
  if (!Array.isArray(supportedFeatures)) {
    return []
  }

  return supportedFeatures.filter((entry) =>
    Array.isArray(entry)
      ? entry.every((item) => typeof item === 'number')
      : typeof entry === 'number',
  )
}

function matchesSupportedFeatures(
  entitySupportedFeatures: number | null,
  requiredFeatures: Array<number | number[]>,
) {
  if (requiredFeatures.length === 0) {
    return true
  }

  if (entitySupportedFeatures === null) {
    return false
  }

  return requiredFeatures.some((entry) =>
    Array.isArray(entry)
      ? entry.every((feature) => (entitySupportedFeatures & feature) === feature)
      : (entitySupportedFeatures & entry) === entry,
  )
}

function matchesAttributeFilter(
  attributes: Record<string, unknown> | undefined,
  filterAttribute: Record<string, unknown[]> | undefined,
) {
  if (!filterAttribute) {
    return true
  }

  return Object.entries(filterAttribute).every(([attributeName, allowedValues]) => {
    const value = attributes?.[attributeName]
    if (Array.isArray(value)) {
      return value.some((item) => allowedValues.some((allowedValue) => allowedValue === item))
    }

    return allowedValues.some((allowedValue) => allowedValue === value)
  })
}

function normalizeEntityTargetFilters(
  serviceDescription: HomeAssistantServiceDescription,
): HomeAssistantServiceTargetFilter[] {
  const entityTarget = serviceDescription.target?.entity
  if (Array.isArray(entityTarget)) {
    return entityTarget
  }

  return entityTarget ? [entityTarget] : []
}

function matchesEntityTarget(
  domain: string,
  entitySupportedFeatures: number | null,
  serviceDescription: HomeAssistantServiceDescription,
) {
  const targetFilters = normalizeEntityTargetFilters(serviceDescription)
  if (targetFilters.length === 0) {
    return false
  }

  return targetFilters.some((filter) => {
    const matchesDomain = !filter.domain || filter.domain.includes(domain)
    if (!matchesDomain) {
      return false
    }

    return matchesSupportedFeatures(
      entitySupportedFeatures,
      normalizeSupportedFeatureGroups(filter.supported_features),
    )
  })
}

function deriveActionKind(
  serviceDomain: string,
  serviceName: string,
  state: HomeAssistantEntityState,
  config: HomeAssistantServerConfig,
): HomeAssistantActionKind {
  if (
    state.entity_id === config.castEntityId &&
    serviceDomain === 'media_player' &&
    serviceName === 'play_media'
  ) {
    return 'connect'
  }

  switch (serviceName) {
    case 'turn_on':
      return 'turn_on'
    case 'turn_off':
      return 'turn_off'
    case 'toggle':
      return 'power'
    case 'media_play':
    case 'media_play_pause':
    case 'play_media':
    case 'repeat_set':
    case 'shuffle_set':
    case 'media_seek':
    case 'select_source':
    case 'clear_playlist':
    case 'join':
    case 'unjoin':
      return 'play'
    case 'media_pause':
      return 'pause'
    case 'media_stop':
      return 'stop'
    case 'media_next_track':
      return 'next'
    case 'media_previous_track':
      return 'previous'
    case 'volume_up':
    case 'volume_down':
    case 'volume_set':
    case 'volume_mute':
    case 'select_sound_mode':
      return 'volume'
    case 'lock':
      return 'lock'
    case 'unlock':
      return 'unlock'
    case 'open_cover':
      return 'open'
    case 'close_cover':
      return 'close'
    default:
      return serviceDomain === 'lock' ? 'lock' : 'custom'
  }
}

function buildActionLabel(
  serviceDomain: string,
  serviceName: string,
  state: HomeAssistantEntityState,
  config: HomeAssistantServerConfig,
  actionKind: HomeAssistantActionKind,
) {
  const actionPresentation = getHomeAssistantAvailableActionPresentation({
    actionKind,
    domain: serviceDomain,
    label:
      state.entity_id === config.castEntityId &&
      serviceDomain === 'media_player' &&
      serviceName === 'play_media'
        ? 'Connect'
        : titleCase(serviceName),
    service: serviceName,
  })

  return actionPresentation.label
}

function buildActionFields(
  serviceDescription: HomeAssistantServiceDescription,
  state: HomeAssistantEntityState,
  entitySupportedFeatures: number | null,
) {
  return Object.entries(serviceDescription.fields ?? {}).reduce<
    HomeAssistantAvailableActionField[]
  >((fields, [fieldKey, fieldDescription]) => {
    const supportedFeatureFilter = normalizeSupportedFeatureGroups(
      fieldDescription.filter?.supported_features,
    )
    const passesSupportedFeatures = matchesSupportedFeatures(
      entitySupportedFeatures,
      supportedFeatureFilter,
    )
    const passesAttributeFilter = matchesAttributeFilter(
      state.attributes,
      fieldDescription.filter?.attribute,
    )

    if (!passesSupportedFeatures || !passesAttributeFilter) {
      return fields
    }

    fields.push({
      advanced: Boolean(fieldDescription.advanced),
      defaultValue: fieldDescription.default ?? null,
      example: fieldDescription.example ?? null,
      filterAttribute: fieldDescription.filter?.attribute ?? null,
      filterSupportedFeatures: supportedFeatureFilter.length > 0 ? supportedFeatureFilter : null,
      key: fieldKey,
      label: titleCase(fieldKey),
      required: Boolean(fieldDescription.required),
      selector: fieldDescription.selector ?? null,
    })

    return fields
  }, [])
}

function buildAvailableActions(
  state: HomeAssistantEntityState,
  config: HomeAssistantServerConfig,
  services: HomeAssistantServiceRegistryEntry[],
) {
  const domain = getEntityDomain(state.entity_id)
  const entitySupportedFeatures =
    typeof state.attributes?.supported_features === 'number'
      ? state.attributes.supported_features
      : null

  const actionsByDisplayKey = new Map<
    string,
    {
      action: HomeAssistantAvailableAction
      presentation: HomeAssistantActionPresentation
      score: number
    }
  >()

  function scoreActionCandidate(action: HomeAssistantAvailableAction) {
    let score = action.domain === domain ? 100 : action.domain === 'homeassistant' ? 10 : 40

    switch (action.service) {
      case 'media_play':
      case 'media_pause':
      case 'media_stop':
      case 'media_next_track':
      case 'media_previous_track':
      case 'turn_on':
      case 'turn_off':
      case 'toggle':
      case 'volume_up':
      case 'volume_down':
      case 'volume_set':
      case 'volume_mute':
      case 'select_source':
      case 'select_sound_mode':
      case 'repeat_set':
      case 'shuffle_set':
      case 'media_seek':
      case 'set_cover_position':
      case 'set_cover_tilt_position':
      case 'set_temperature':
      case 'set_humidity':
      case 'set_hvac_mode':
      case 'set_fan_mode':
      case 'set_swing_mode':
      case 'set_swing_horizontal_mode':
      case 'set_percentage':
      case 'set_direction':
      case 'oscillate':
      case 'set_preset_mode':
      case 'start':
      case 'return_to_base':
      case 'locate':
      case 'clean_spot':
      case 'clean_area':
      case 'lock':
      case 'unlock':
      case 'open_cover':
      case 'close_cover':
      case 'open_cover_tilt':
      case 'close_cover_tilt':
      case 'stop_cover':
      case 'stop_cover_tilt':
        score += 25
        break
      case 'media_play_pause':
        score += 15
        break
      case 'play_media':
        score += action.actionKind === 'connect' ? 30 : 5
        break
      default:
        score += 5
        break
    }

    return score
  }

  for (const serviceRegistryEntry of services) {
    for (const [serviceName, serviceDescription] of Object.entries(serviceRegistryEntry.services)) {
      if (serviceDescription.response && serviceDescription.response.optional === false) {
        continue
      }

      if (!matchesEntityTarget(domain, entitySupportedFeatures, serviceDescription)) {
        continue
      }

      const actionKind = deriveActionKind(serviceRegistryEntry.domain, serviceName, state, config)
      const action: HomeAssistantAvailableAction = {
        actionKind,
        description: `${serviceRegistryEntry.domain}.${serviceName}`,
        domain: serviceRegistryEntry.domain,
        fields: buildActionFields(serviceDescription, state, entitySupportedFeatures),
        key: `${serviceRegistryEntry.domain}.${serviceName}`,
        label: buildActionLabel(
          serviceRegistryEntry.domain,
          serviceName,
          state,
          config,
          actionKind,
        ),
        service: serviceName,
      }
      const presentation = getHomeAssistantAvailableActionPresentation(action)
      const score = scoreActionCandidate(action)
      const existingEntry = actionsByDisplayKey.get(presentation.displayKey)

      if (!existingEntry || score > existingEntry.score) {
        actionsByDisplayKey.set(presentation.displayKey, {
          action,
          presentation,
          score,
        })
      }
    }
  }

  return Array.from(actionsByDisplayKey.values()).map((entry) => ({
    ...entry.action,
    label: entry.presentation.label,
  }))
}

function pickDefaultActionKey(
  state: HomeAssistantEntityState,
  config: HomeAssistantServerConfig,
  actions: HomeAssistantAvailableAction[],
) {
  const preferredServiceKeys =
    state.entity_id === config.castEntityId
      ? ['media_player.play_media', 'media_player.turn_on', 'media_player.toggle']
      : [
          `${getEntityDomain(state.entity_id)}.toggle`,
          `${getEntityDomain(state.entity_id)}.turn_on`,
          'media_player.media_play',
          'media_player.play_media',
          actions[0]?.key ?? '',
        ]

  return (
    preferredServiceKeys.find((serviceKey) =>
      actions.some((action) => action.key === serviceKey),
    ) ?? null
  )
}

function classifyHomeAssistantEntity(
  state: HomeAssistantEntityState,
  config: HomeAssistantServerConfig,
) {
  const domain = getEntityDomain(state.entity_id)
  if (!HA_DISCOVERABLE_DOMAINS.has(domain) || state.state === 'unavailable') {
    return null
  }

  if (domain === 'media_player') {
    const isConfiguredCast = state.entity_id === config.castEntityId
    return {
      deviceType: isConfiguredCast ? 'Google Cast' : 'Media Player',
    }
  }

  const deviceTypeByDomain: Record<string, string> = {
    climate: 'Climate Device',
    cover: 'Smart Cover',
    fan: 'Smart Fan',
    light: 'Smart Light',
    lock: 'Smart Lock',
    switch: 'Smart Switch',
    vacuum: 'Robot Vacuum',
  }

  return {
    deviceType: deviceTypeByDomain[domain] ?? 'Smart Device',
  }
}

async function discoverHomeAssistantEntityDevices(
  config: HomeAssistantServerConfig,
  castFriendlyName: string | null,
  services: HomeAssistantServiceRegistryEntry[],
) {
  if (!(config.baseUrl && config.accessToken)) {
    return [] as HomeAssistantDiscoveredDevice[]
  }

  let states: HomeAssistantEntityState[]
  try {
    states = await listEntityStates(config)
  } catch {
    return [] as HomeAssistantDiscoveredDevice[]
  }

  const devices: HomeAssistantDiscoveredDevice[] = []

  for (const state of states) {
    const classification = classifyHomeAssistantEntity(state, config)
    if (!classification) {
      continue
    }

    const availableActions = buildAvailableActions(state, config, services)
    if (availableActions.length === 0) {
      continue
    }

    const friendlyName =
      readStringAttribute(state.attributes, 'friendly_name') ?? state.entity_id.replace(/_/g, ' ')
    const manufacturer = readStringAttribute(
      state.attributes,
      'manufacturer',
      'device_manufacturer',
      'hw_version',
    )
    const model = readStringAttribute(
      state.attributes,
      'model',
      'model_name',
      'device_model',
      'sw_version',
    )
    const ip = readStringAttribute(state.attributes, 'ip_address', 'ip')
    const isConfiguredCast =
      state.entity_id === config.castEntityId ||
      (!!castFriendlyName && friendlyName === castFriendlyName)
    const supportedFeatures =
      typeof state.attributes?.supported_features === 'number'
        ? state.attributes.supported_features
        : null
    const enabledActionCategories = Array.from(
      new Set<HomeAssistantCapabilityCategory>(
        availableActions.map((action) => getHomeAssistantCapabilityCategory(action.actionKind)),
      ),
    )

    devices.push({
      actionable: true,
      attributes: state.attributes ?? null,
      availableActions,
      enabledActionCategories,
      defaultActionKey: pickDefaultActionKey(state, config, availableActions),
      defaultServiceData: {},
      description: `${classification.deviceType} via Home Assistant`,
      deviceType: isConfiguredCast ? 'Google Cast' : classification.deviceType,
      haEntityId: state.entity_id,
      id: `ha-${stableDeviceId([state.entity_id, friendlyName, manufacturer, model])}`,
      ip,
      manufacturer,
      model,
      name: friendlyName,
      protocol: 'home-assistant',
      serviceType: null,
      supportedFeatures,
    })
  }

  return devices
}

function shouldPreferDiscoveredDevice(
  nextDevice: HomeAssistantDiscoveredDevice,
  existingDevice: HomeAssistantDiscoveredDevice | undefined,
) {
  if (!existingDevice) {
    return true
  }

  if (existingDevice.protocol === 'home-assistant' && nextDevice.protocol !== 'home-assistant') {
    return true
  }

  if (!existingDevice.ip && nextDevice.ip) {
    return true
  }

  return false
}

function mergeDiscoveredDevice(
  nextDevice: HomeAssistantDiscoveredDevice,
  existingDevice: HomeAssistantDiscoveredDevice | undefined,
) {
  if (!existingDevice) {
    return nextDevice
  }

  const preferredDevice = shouldPreferDiscoveredDevice(nextDevice, existingDevice)
    ? nextDevice
    : existingDevice
  const fallbackDevice = preferredDevice === nextDevice ? existingDevice : nextDevice

  return {
    ...preferredDevice,
    attributes: preferredDevice.attributes ?? fallbackDevice.attributes,
    availableActions:
      preferredDevice.availableActions.length > 0
        ? preferredDevice.availableActions
        : fallbackDevice.availableActions,
    enabledActionCategories:
      preferredDevice.enabledActionCategories.length > 0
        ? preferredDevice.enabledActionCategories
        : fallbackDevice.enabledActionCategories,
    defaultActionKey: preferredDevice.defaultActionKey ?? fallbackDevice.defaultActionKey,
    supportedFeatures: preferredDevice.supportedFeatures ?? fallbackDevice.supportedFeatures,
  }
}

export async function discoverHomeAssistantDevices(config: HomeAssistantServerConfig) {
  const castFriendlyName = hasHomeAssistantServerConfig(config)
    ? await readCastEntityFriendlyName(config)
    : null
  const services = hasHomeAssistantServerConfig(config)
    ? await listServices(config).catch(() => [] as HomeAssistantServiceRegistryEntry[])
    : []

  const [mdnsDevices, ssdpDevices, homeAssistantEntityDevices] = await Promise.all([
    discoverMdnsDevices(config, castFriendlyName),
    discoverSsdpDevices(config, castFriendlyName),
    discoverHomeAssistantEntityDevices(config, castFriendlyName, services),
  ])

  const uniqueDevices = new Map<string, HomeAssistantDiscoveredDevice>()
  for (const device of [...mdnsDevices, ...ssdpDevices, ...homeAssistantEntityDevices]) {
    if (!device.actionable) {
      continue
    }

    const key = device.haEntityId ?? `${device.deviceType}:${device.name}:${device.ip ?? ''}`
    uniqueDevices.set(key, mergeDiscoveredDevice(device, uniqueDevices.get(key)))
  }

  return Array.from(uniqueDevices.values())
    .filter((device) => device.availableActions.length > 0)
    .sort((left, right) => left.name.localeCompare(right.name))
}
