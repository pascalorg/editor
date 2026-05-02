import dgram from 'node:dgram'
import os from 'node:os'

export type HomeAssistantDiscoveredInstance = {
  id: string
  instanceUrl: string
  label: string
  source: 'known-host' | 'loopback' | 'zeroconf'
}

const MDNS_GROUP = '224.0.0.251'
const MDNS_PORT = 5353
const DISCOVERY_TIMEOUT_MS = 1800
const HOME_ASSISTANT_SERVICE_TYPE = '_home-assistant._tcp.local'
const HOME_ASSISTANT_KNOWN_HOST_CANDIDATES = [
  'http://homeassistant.local:8123',
  'http://homeassistant:8123',
]

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
      name: string
      properties: Record<string, string>
      raw: Array<{ key: string; value: string | null }>
      ttl: number
      type: 16
    }

function stableId(parts: Array<string | null | undefined>) {
  return parts
    .map((part) => part?.trim().toLowerCase() ?? '')
    .join('|')
    .replace(/[^a-z0-9|]+/g, '-')
    .replace(/\|+/g, '|')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
}

function encodeDnsName(value: string) {
  const normalized = value.replace(/\.$/, '')
  const labels = normalized.split('.').filter(Boolean)
  const parts: Buffer[] = []

  for (const label of labels) {
    const encoded = Buffer.from(label, 'utf8')
    parts.push(Buffer.from([encoded.length]))
    parts.push(encoded)
  }

  parts.push(Buffer.from([0]))
  return Buffer.concat(parts)
}

function buildMdnsQuery(serviceType: string) {
  const header = Buffer.alloc(12)
  header.writeUInt16BE(0, 0)
  header.writeUInt16BE(0, 2)
  header.writeUInt16BE(1, 4)
  header.writeUInt16BE(0, 6)
  header.writeUInt16BE(0, 8)
  header.writeUInt16BE(0, 10)

  return Buffer.concat([
    header,
    encodeDnsName(serviceType),
    Buffer.from([0x00, 0x0c]),
    Buffer.from([0x00, 0x01]),
  ])
}

function getLanIpv4Addresses() {
  return Object.values(os.networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address)
}

function decodeDnsName(message: Buffer, startOffset: number) {
  const labels: string[] = []
  let offset = startOffset
  let jumped = false
  let nextOffset = startOffset
  let guard = 0

  while (offset < message.length && guard < 64) {
    guard += 1
    const length = message[offset]

    if (length === undefined) {
      break
    }

    if (length === 0) {
      if (!jumped) {
        nextOffset = offset + 1
      }
      break
    }

    if ((length & 0xc0) === 0xc0) {
      const pointer = ((length & 0x3f) << 8) | (message[offset + 1] ?? 0)
      if (!jumped) {
        nextOffset = offset + 2
      }
      offset = pointer
      jumped = true
      continue
    }

    const labelStart = offset + 1
    const labelEnd = labelStart + length
    if (labelEnd > message.length) {
      break
    }

    labels.push(message.subarray(labelStart, labelEnd).toString('utf8'))
    offset = labelEnd
    if (!jumped) {
      nextOffset = offset
    }
  }

  return {
    name: labels.join('.'),
    offset: nextOffset,
  }
}

function parseTxtRecord(data: Buffer) {
  const raw: Array<{ key: string; value: string | null }> = []
  const properties: Record<string, string> = {}
  let offset = 0

  while (offset < data.length) {
    const entryLength = data[offset] ?? 0
    offset += 1
    if (entryLength <= 0 || offset + entryLength > data.length) {
      break
    }

    const entry = data.subarray(offset, offset + entryLength).toString('utf8')
    offset += entryLength

    const separatorIndex = entry.indexOf('=')
    if (separatorIndex === -1) {
      raw.push({ key: entry, value: null })
      continue
    }

    const key = entry.slice(0, separatorIndex)
    const value = entry.slice(separatorIndex + 1)
    raw.push({ key, value })
    properties[key] = value
  }

  return { raw, properties }
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
    const decodedName = decodeDnsName(message, offset)
    offset = decodedName.offset
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

    if (type === 1 && dataLength === 4) {
      records.push({
        classCode,
        name: decodedName.name,
        ttl,
        type,
        value: Array.from(message.subarray(dataOffset, dataEnd)).join('.'),
      })
    } else if (type === 12) {
      records.push({
        classCode,
        name: decodedName.name,
        ttl,
        type,
        value: decodeDnsName(message, dataOffset).name,
      })
    } else if (type === 16) {
      records.push({
        classCode,
        name: decodedName.name,
        ttl,
        type,
        ...parseTxtRecord(message.subarray(dataOffset, dataEnd)),
      })
    } else if (type === 28 && dataLength === 16) {
      const segments: string[] = []
      for (let partIndex = 0; partIndex < 8; partIndex += 1) {
        segments.push(message.readUInt16BE(dataOffset + partIndex * 2).toString(16))
      }
      records.push({
        classCode,
        name: decodedName.name,
        ttl,
        type,
        value: segments.join(':'),
      })
    } else if (type === 33 && dataLength >= 6) {
      records.push({
        classCode,
        name: decodedName.name,
        port: message.readUInt16BE(dataOffset + 4),
        priority: message.readUInt16BE(dataOffset),
        target: decodeDnsName(message, dataOffset + 6).name,
        ttl,
        type,
        weight: message.readUInt16BE(dataOffset + 2),
      })
    }

    offset = dataEnd
  }

  return records
}

async function collectUdpMessages(onMessage: (message: Buffer) => void) {
  await new Promise<void>((resolve, reject) => {
    const socket = dgram.createSocket({ reuseAddr: true, type: 'udp4' })

    const finish = (callback?: () => void) => {
      try {
        callback?.()
      } finally {
        try {
          socket.close()
        } catch {}
      }
    }

    socket.on('error', (error) => {
      clearTimeout(timeout)
      finish(() => reject(error))
    })

    socket.on('message', onMessage)

    socket.bind(0, () => {
      try {
        socket.setMulticastTTL(255)
        const query = buildMdnsQuery(HOME_ASSISTANT_SERVICE_TYPE)
        const interfaces = getLanIpv4Addresses()

        socket.send(query, MDNS_PORT, MDNS_GROUP)
        for (const interfaceAddress of interfaces) {
          try {
            socket.setMulticastInterface(interfaceAddress)
            socket.send(query, MDNS_PORT, MDNS_GROUP)
          } catch {}
        }
      } catch (error) {
        clearTimeout(timeout)
        finish(() => reject(error))
      }
    })

    const timeout = setTimeout(() => {
      finish(() => resolve())
    }, DISCOVERY_TIMEOUT_MS)
  })
}

async function probeHttpCandidate(url: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1200)

  try {
    const response = await fetch(url, {
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
    })
    const contentType = response.headers.get('content-type') ?? ''

    if (contentType.includes('text/html')) {
      const html = await response.text()
      return /home assistant/i.test(html)
    }

    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

async function discoverLoopbackInstances() {
  const candidates = ['http://localhost:8123', 'http://127.0.0.1:8123']
  const discovered: HomeAssistantDiscoveredInstance[] = []

  for (const candidate of candidates) {
    const reachable = await probeHttpCandidate(candidate)
    if (!reachable) {
      continue
    }

    discovered.push({
      id: `loopback:${stableId([candidate])}`,
      instanceUrl: candidate,
      label: 'This machine',
      source: 'loopback',
    })
  }

  return discovered
}

async function discoverKnownHostInstances() {
  const discovered: HomeAssistantDiscoveredInstance[] = []

  for (const candidate of HOME_ASSISTANT_KNOWN_HOST_CANDIDATES) {
    const reachable = await probeHttpCandidate(candidate)
    if (!reachable) {
      continue
    }

    const url = new URL(candidate)
    discovered.push({
      id: `known-host:${stableId([candidate])}`,
      instanceUrl: candidate,
      label: url.hostname,
      source: 'known-host',
    })
  }

  return discovered
}

async function discoverZeroconfInstances() {
  const records: MdnsRecord[] = []

  try {
    await collectUdpMessages((message) => {
      records.push(...parseMdnsPacket(message))
    })
  } catch {
    return [] as HomeAssistantDiscoveredInstance[]
  }

  const ptrRecords = records.filter(
    (record): record is Extract<MdnsRecord, { type: 12 }> =>
      record.type === 12 && record.name === HOME_ASSISTANT_SERVICE_TYPE,
  )

  const instances = new Map<string, HomeAssistantDiscoveredInstance>()

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

    if (!srvRecord) {
      continue
    }

    const addressRecord = records.find(
      (record): record is Extract<MdnsRecord, { type: 1 | 28 }> =>
        (record.type === 1 || record.type === 28) && record.name === srvRecord.target,
    )

    if (!addressRecord) {
      continue
    }

    const label =
      txtRecord?.properties.location_name ??
      txtRecord?.properties.fn ??
      txtRecord?.properties.name ??
      instanceName.replace(`.${HOME_ASSISTANT_SERVICE_TYPE}`, '')
    const protocol = srvRecord.port === 443 ? 'https' : 'http'
    const address =
      addressRecord.type === 28 && !addressRecord.value.startsWith('[')
        ? `[${addressRecord.value}]`
        : addressRecord.value
    const instanceUrl = `${protocol}://${address}:${srvRecord.port}`
    const id = `zeroconf:${stableId([instanceUrl, label])}`

    instances.set(id, {
      id,
      instanceUrl,
      label,
      source: 'zeroconf',
    })
  }

  return Array.from(instances.values())
}

export async function discoverHomeAssistantInstances() {
  const discovered = new Map<string, HomeAssistantDiscoveredInstance>()

  for (const instance of await discoverZeroconfInstances()) {
    discovered.set(instance.instanceUrl, instance)
  }

  for (const instance of await discoverKnownHostInstances()) {
    if (!discovered.has(instance.instanceUrl)) {
      discovered.set(instance.instanceUrl, instance)
    }
  }

  for (const instance of await discoverLoopbackInstances()) {
    if (!discovered.has(instance.instanceUrl)) {
      discovered.set(instance.instanceUrl, instance)
    }
  }

  return Array.from(discovered.values()).sort((left, right) =>
    left.label.localeCompare(right.label),
  )
}
