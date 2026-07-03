import type { IndustryPackV2EquipmentBinding } from './industry-pack-v2'

type JsonRecord = Record<string, unknown>

export const FACTORY_EQUIPMENT_PLUGIN_ID = 'pascal:factory-equipment'

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function profileText(profile: JsonRecord) {
  return [
    profile.id,
    profile.name,
    profile.family,
    profile.layoutFamily,
    profile.primarySemanticRole,
    profile.description,
    ...stringArray(profile.aliases),
    ...stringArray(profile.visualCues),
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .toLowerCase()
}

function nodeKindForProfile(profile: JsonRecord): string | undefined {
  const explicit = stringValue(profile.nodeKind)
  if (explicit === 'factory:pump' || explicit === 'factory:tank') return explicit
  const text = profileText(profile)
  if (/pump|centrifugal|metering|positive[_\s-]?displacement|\u6cf5/.test(text)) {
    return 'factory:pump'
  }
  if (/tank|vessel|storage|silo|\u50a8\u7f50|\u7f50|\u5bb9\u5668|\u6599\u4ed3/.test(text)) {
    return 'factory:tank'
  }
  return undefined
}

function processPorts(profile: JsonRecord): JsonRecord[] {
  return Array.isArray(profile.processPorts) ? profile.processPorts.filter(isRecord) : []
}

function portId(port: JsonRecord) {
  return stringValue(port.id)
}

function portMapForProfile(profile: JsonRecord, nodeKind: string): Record<string, string> {
  const ports = processPorts(profile)
  const result: Record<string, string> = {}
  for (const port of ports) {
    const id = portId(port)
    if (!id) continue
    const text = [id, port.role, port.kind, port.semanticRole, port.side, port.direction]
      .filter((value): value is string => typeof value === 'string')
      .join(' ')
      .toLowerCase()
    if (/out|discharge|出口|出料|排出/.test(text)) result[id] = 'outlet'
    else result[id] = 'inlet'
  }
  if (!Object.keys(result).length) {
    result.inlet = 'inlet'
    result.outlet = 'outlet'
  }
  if (nodeKind === 'factory:tank') {
    return result
  }
  return result
}

function hasPath(profile: JsonRecord, path: string) {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current == null) return undefined
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (Number.isInteger(index)) return current[index]
      return current.find((item) => isRecord(item) && item.id === segment)
    }
    return isRecord(current) ? current[segment] : undefined
  }, profile) !== undefined
}

function paramMapForProfile(
  profile: JsonRecord,
  nodeKind: string,
  portMap: Record<string, string>,
): Record<string, string> {
  const map: Record<string, string> = {}
  for (const key of ['length', 'width', 'height']) {
    const path = `defaultDimensions.${key}`
    if (hasPath(profile, path)) map[path] = key
  }
  if (hasPath(profile, 'defaultDimensions.diameter')) {
    if (!map['defaultDimensions.length']) map['defaultDimensions.diameter'] = 'length'
  }

  for (const [profilePortId, nodePortId] of Object.entries(portMap)) {
    const source = `processPorts.${profilePortId}.diameter`
    if (hasPath(profile, source)) {
      map[source] = nodePortId === 'outlet' ? 'outletDiameter' : 'inletDiameter'
    }
  }

  if (nodeKind === 'factory:pump') {
    for (const [source, target] of [
      ['equipmentDefaults.pumpType', 'pumpType'],
      ['equipmentDefaults.flowRate', 'flowRate'],
      ['equipmentDefaults.motorPower', 'motorPower'],
      ['equipmentDefaults.skidMounted', 'skidMounted'],
    ] as const) {
      if (hasPath(profile, source)) map[source] = target
    }
  }

  if (nodeKind === 'factory:tank') {
    for (const [source, target] of [
      ['equipmentDefaults.orientation', 'orientation'],
      ['equipmentDefaults.capacity', 'capacity'],
      ['equipmentDefaults.liquidLevel', 'liquidLevel'],
    ] as const) {
      if (hasPath(profile, source)) map[source] = target
    }
  }

  return map
}

export function inferEquipmentBindingForProfile(
  profile: JsonRecord,
): IndustryPackV2EquipmentBinding | null {
  const profileId = stringValue(profile.id)
  const nodeKind = profileId ? nodeKindForProfile(profile) : undefined
  if (!profileId || !nodeKind) return null
  const portMap = portMapForProfile(profile, nodeKind)
  const paramMap = paramMapForProfile(profile, nodeKind, portMap)
  if (!Object.keys(paramMap).length || !Object.keys(portMap).length) return null
  return { profileId, nodeKind, paramMap, portMap }
}

export function inferEquipmentBindingsForProfiles(
  profiles: JsonRecord[],
): IndustryPackV2EquipmentBinding[] {
  const bindings = profiles
    .map(inferEquipmentBindingForProfile)
    .filter((binding): binding is IndustryPackV2EquipmentBinding => Boolean(binding))
  const seen = new Set<string>()
  return bindings.filter((binding) => {
    if (seen.has(binding.profileId)) return false
    seen.add(binding.profileId)
    return true
  })
}

function stationText(station: JsonRecord) {
  return [
    station.id,
    station.role,
    station.label,
    station.displayLabel,
    station.equipmentHint,
    ...stringArray(station.safetyTags),
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .toLowerCase()
}

function profileMatchesStation(profile: JsonRecord, station: JsonRecord) {
  const text = stationText(station)
  const profileId = stringValue(profile.id)
  const profileIdTail = profileId?.split('.').at(-1)
  const candidates = [
    profileId,
    profileIdTail,
    stringValue(profile.name),
    stringValue(profile.primarySemanticRole),
    ...stringArray(profile.aliases),
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase().replace(/[_\s-]+/g, ' '))
  const normalizedText = text.replace(/[_\s-]+/g, ' ')
  return candidates.some((candidate) => candidate.length > 1 && normalizedText.includes(candidate))
}

function matchingProfileForStation(station: JsonRecord, profiles: JsonRecord[]) {
  return profiles.find((profile) => profileMatchesStation(profile, station))
}

export function annotateProcessTemplatesForV2(input: {
  processTemplates: JsonRecord[]
  profiles: JsonRecord[]
  bindings: IndustryPackV2EquipmentBinding[]
}): JsonRecord[] {
  const boundProfileIds = new Set(input.bindings.map((binding) => binding.profileId))
  return input.processTemplates.map((template) => {
    const stations = Array.isArray(template.stations) ? template.stations : []
    return {
      ...template,
      stations: stations.map((station) => {
        if (!isRecord(station)) return station
        if (stringValue(station.profileId) || isRecord(station.genericFallback)) return station
        const profile = matchingProfileForStation(station, input.profiles)
        const profileId = profile ? stringValue(profile.id) : undefined
        if (profileId && boundProfileIds.has(profileId)) {
          return { ...station, profileId }
        }
        return {
          ...station,
          genericFallback: {
            reason: profileId
              ? `Profile "${profileId}" has no registered factory equipment binding.`
              : 'No matching equipment profile binding was inferred for this station.',
          },
        }
      }),
    }
  })
}

export function withDefaultV2ProfileFields(profile: JsonRecord): JsonRecord {
  const nodeKind = nodeKindForProfile(profile)
  if (!nodeKind) return profile
  const next: JsonRecord = { ...profile }
  const dimensions = isRecord(next.defaultDimensions) ? next.defaultDimensions : {}
  if (!Object.keys(dimensions).length) {
    next.defaultDimensions =
      nodeKind === 'factory:pump'
        ? { length: 2.6, width: 1.1, height: 1.4 }
        : { length: 2.4, width: 2.4, height: 3.2 }
  }
  if (!processPorts(next).length) {
    next.processPorts = [
      {
        id: 'inlet',
        medium: 'material',
        side: nodeKind === 'factory:tank' ? 'top' : 'left',
        diameter: nodeKind === 'factory:pump' ? 0.18 : 0.16,
      },
      {
        id: 'outlet',
        medium: 'material',
        side: nodeKind === 'factory:tank' ? 'front' : 'right',
        diameter: nodeKind === 'factory:pump' ? 0.12 : 0.12,
      },
    ]
  }
  if (!isRecord(next.equipmentDefaults)) {
    next.equipmentDefaults =
      nodeKind === 'factory:pump'
        ? {
            pumpType: /metering|\u8ba1\u91cf/i.test(profileText(next)) ? 'metering' : 'centrifugal',
            flowRate: 120,
            motorPower: 15,
            skidMounted: true,
          }
        : {
            orientation: /horizontal|\u5367\u5f0f/i.test(profileText(next))
              ? 'horizontal'
              : 'vertical',
            capacity: 10,
            liquidLevel: 0.5,
          }
  }
  return next
}
