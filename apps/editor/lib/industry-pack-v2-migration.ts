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

function recipeIdForProfile(profile: JsonRecord): string | undefined {
  const explicit = stringValue(profile.recipeId)
  if (explicit) return explicit
  const text = profileText(profile)
  if (/pump|centrifugal|metering|positive[_\s-]?displacement|\u6cf5/.test(text)) {
    return 'factory:centrifugal-pump'
  }
  if (/tank|vessel|storage|silo|\u50a8\u7f50|\u7f50|\u5bb9\u5668|\u6599\u4ed3/.test(text)) {
    return 'factory:storage-tank'
  }
  return undefined
}

function processPorts(profile: JsonRecord): JsonRecord[] {
  return Array.isArray(profile.processPorts) ? profile.processPorts.filter(isRecord) : []
}

function portId(port: JsonRecord) {
  return stringValue(port.id)
}

function equipmentDefaults(profile: JsonRecord): JsonRecord {
  return isRecord(profile.equipmentDefaults) ? profile.equipmentDefaults : {}
}

function refineryAuxiliaryVariant(profile: JsonRecord): 'flare' | 'boiler' | 'pipe-rack' {
  const explicit = stringValue(equipmentDefaults(profile).variant)
  if (explicit === 'flare' || explicit === 'boiler' || explicit === 'pipe-rack') return explicit
  const text = profileText(profile)
  if (/flare/.test(text)) return 'flare'
  if (/boiler|steam/.test(text)) return 'boiler'
  return 'pipe-rack'
}

function defaultRecipePorts(recipeId: string, profile: JsonRecord) {
  const text = profileText(profile)
  if (recipeId === 'factory:distillation-unit') {
    return {
      inlet: 'feed_inlet',
      outlet: 'overhead_product_outlet',
      ports: [
        { id: 'feed_inlet', medium: 'material', side: 'left', diameter: 0.24 },
        { id: 'overhead_product_outlet', medium: 'material', side: 'top', diameter: 0.18 },
        { id: 'bottoms_outlet', medium: 'material', side: 'right', diameter: 0.22 },
      ],
    }
  }
  if (recipeId === 'factory:refinery-reactor-unit') {
    if (/fcc|catalytic[_\s-]?cracking|fluid[_\s-]?catalytic/.test(text)) {
      return {
        inlet: 'vacuum_gas_oil_in',
        outlet: 'cracked_product_out',
        ports: [
          { id: 'vacuum_gas_oil_in', medium: 'material', side: 'left', diameter: 0.2 },
          { id: 'cracked_product_out', medium: 'material', side: 'right', diameter: 0.18 },
          { id: 'rich_gas_out', medium: 'gas', side: 'top', diameter: 0.16 },
        ],
      }
    }
    if (/reformer|reforming/.test(text)) {
      return {
        inlet: 'naphtha_in',
        outlet: 'reformate_out',
        ports: [
          { id: 'naphtha_in', medium: 'material', side: 'left', diameter: 0.16 },
          { id: 'reformate_out', medium: 'material', side: 'right', diameter: 0.16 },
        ],
      }
    }
    if (/sulfur|claus|acid[_\s-]?gas/.test(text)) {
      return {
        inlet: 'acid_gas_in',
        outlet: 'sulfur_out',
        ports: [
          { id: 'acid_gas_in', medium: 'gas', side: 'left', diameter: 0.16 },
          { id: 'sulfur_out', medium: 'material', side: 'right', diameter: 0.12 },
        ],
      }
    }
    return {
      inlet: 'hydrotreater_feed_in',
      outlet: 'treated_product_out',
      ports: [
        { id: 'hydrotreater_feed_in', medium: 'material', side: 'left', diameter: 0.18 },
        { id: 'hydrogen_in', medium: 'hydrogen', side: 'back', diameter: 0.12 },
        { id: 'treated_product_out', medium: 'material', side: 'right', diameter: 0.16 },
      ],
    }
  }
  if (recipeId === 'factory:refinery-auxiliary-unit') {
    const variant = refineryAuxiliaryVariant(profile)
    if (variant === 'flare') {
      return {
        inlet: 'relief_gas_in',
        outlet: 'flare_tip',
        ports: [
          { id: 'relief_gas_in', medium: 'gas', side: 'left', diameter: 0.18 },
          { id: 'flare_tip', medium: 'gas', side: 'top', diameter: 0.12 },
        ],
      }
    }
    if (variant === 'boiler') {
      return {
        inlet: 'fuel_gas_in',
        outlet: 'steam_out',
        ports: [
          { id: 'fuel_gas_in', medium: 'gas', side: 'left', diameter: 0.14 },
          { id: 'steam_out', medium: 'gas', side: 'right', diameter: 0.16 },
        ],
      }
    }
    return {
      inlet: 'rack_in',
      outlet: 'rack_out',
      ports: [
        { id: 'rack_in', medium: 'material', side: 'left', diameter: 0.18 },
        { id: 'rack_out', medium: 'material', side: 'right', diameter: 0.18 },
      ],
    }
  }
  return {
    inlet: 'inlet',
    outlet: 'outlet',
    ports: [
      {
        id: 'inlet',
        medium: 'material',
        side: recipeId === 'factory:storage-tank' ? 'top' : 'left',
        diameter: recipeId === 'factory:centrifugal-pump' ? 0.18 : 0.16,
      },
      {
        id: 'outlet',
        medium: 'material',
        side: recipeId === 'factory:storage-tank' ? 'front' : 'right',
        diameter: recipeId === 'factory:centrifugal-pump' ? 0.12 : 0.12,
      },
    ],
  }
}

function portMapForProfile(profile: JsonRecord, recipeId: string): Record<string, string> {
  const ports = processPorts(profile)
  const defaults = defaultRecipePorts(recipeId, profile)
  const defaultNodePorts = new Set(defaults.ports.map((port) => String(port.id)))
  const result: Record<string, string> = {}
  for (const port of ports) {
    const id = portId(port)
    if (!id) continue
    if (defaultNodePorts.has(id)) {
      result[id] = id
      continue
    }
    const text = [id, port.role, port.kind, port.semanticRole, port.side, port.direction]
      .filter((value): value is string => typeof value === 'string')
      .join(' ')
      .toLowerCase()
    if (
      /overhead|top|gas|vapor|vapour/.test(text) &&
      defaultNodePorts.has('overhead_product_outlet')
    ) {
      result[id] = 'overhead_product_outlet'
    } else if (/bottom|residue|bottoms/.test(text) && defaultNodePorts.has('bottoms_outlet')) {
      result[id] = 'bottoms_outlet'
    } else if (/out|discharge/.test(text)) result[id] = defaults.outlet
    else result[id] = defaults.inlet
  }
  if (!Object.keys(result).length) {
    for (const port of defaults.ports) {
      const id = String(port.id)
      result[id] = id
    }
  }
  return result
}

export function legacyPortMapForProfile(
  profile: JsonRecord,
  recipeId: string,
): Record<string, string> {
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
  if (recipeId === 'factory:storage-tank') {
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
  recipeId: string,
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

  if (recipeId === 'factory:centrifugal-pump' || recipeId === 'factory:storage-tank') {
    for (const [profilePortId, nodePortId] of Object.entries(portMap)) {
      const source = `processPorts.${profilePortId}.diameter`
      if (hasPath(profile, source)) {
        map[source] = nodePortId === 'outlet' ? 'outletDiameter' : 'inletDiameter'
      }
    }
  }

  if (recipeId === 'factory:centrifugal-pump') {
    for (const [source, target] of [
      ['equipmentDefaults.pumpType', 'pumpType'],
      ['equipmentDefaults.flowRate', 'flowRate'],
      ['equipmentDefaults.motorPower', 'motorPower'],
      ['equipmentDefaults.skidMounted', 'skidMounted'],
    ] as const) {
      if (hasPath(profile, source)) map[source] = target
    }
  }

  if (recipeId === 'factory:storage-tank') {
    for (const [source, target] of [
      ['equipmentDefaults.orientation', 'orientation'],
      ['equipmentDefaults.capacity', 'capacity'],
      ['equipmentDefaults.liquidLevel', 'liquidLevel'],
    ] as const) {
      if (hasPath(profile, source)) map[source] = target
    }
  }

  if (recipeId === 'factory:distillation-unit') {
    for (const [source, target] of [
      ['equipmentDefaults.columnKind', 'columnKind'],
      ['equipmentDefaults.columnHeight', 'columnHeight'],
      ['equipmentDefaults.columnRadius', 'columnRadius'],
    ] as const) {
      if (hasPath(profile, source)) map[source] = target
    }
  }

  if (recipeId === 'factory:refinery-reactor-unit') {
    for (const [source, target] of [
      ['equipmentDefaults.variant', 'variant'],
      ['equipmentDefaults.reactorHeight', 'reactorHeight'],
      ['equipmentDefaults.regeneratorHeight', 'regeneratorHeight'],
    ] as const) {
      if (hasPath(profile, source)) map[source] = target
    }
  }

  if (recipeId === 'factory:refinery-auxiliary-unit') {
    for (const [source, target] of [
      ['equipmentDefaults.variant', 'variant'],
      ['equipmentDefaults.stackHeight', 'stackHeight'],
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
  const recipeId = profileId ? recipeIdForProfile(profile) : undefined
  if (!profileId || !recipeId) return null
  const portMap = portMapForProfile(profile, recipeId)
  const paramMap = paramMapForProfile(profile, recipeId, portMap)
  if (!Object.keys(paramMap).length || !Object.keys(portMap).length) return null
  return { profileId, recipeId, paramMap, portMap }
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

function isSemanticProfilePartsProfile(profile: JsonRecord | undefined) {
  if (!profile) return false
  if (stringValue(profile.preferredResolver) !== 'profile-parts') return false
  const parts = Array.isArray(profile.parts) ? profile.parts.filter(isRecord) : []
  return parts.some((part) => stringValue(part.kind) && stringValue(part.semanticRole))
}

function matchingProfileForStation(station: JsonRecord, profiles: JsonRecord[]) {
  return profiles.find((profile) => profileMatchesStation(profile, station))
}

function isGeneratedMigrationFallback(station: JsonRecord) {
  if (!isRecord(station.genericFallback)) return false
  const reason = stringValue(station.genericFallback.reason)
  return (
    reason === 'No matching equipment profile binding was inferred for this station.' ||
    /^Profile ".*" has no registered factory equipment binding\.$/.test(reason ?? '')
  )
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
        if (stringValue(station.profileId)) return station
        if (isRecord(station.genericFallback) && !isGeneratedMigrationFallback(station)) {
          return station
        }
        const profile = matchingProfileForStation(station, input.profiles)
        const profileId = profile ? stringValue(profile.id) : undefined
        if (profileId && (boundProfileIds.has(profileId) || isSemanticProfilePartsProfile(profile))) {
          const rest = { ...station }
          delete rest.genericFallback
          return { ...rest, profileId }
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
  const parts = Array.isArray(profile.parts) ? profile.parts.filter(isRecord) : []
  const hasSemanticParts = parts.some((part) => stringValue(part.kind) && stringValue(part.semanticRole))
  const base: JsonRecord =
    hasSemanticParts && stringValue(profile.preferredResolver) == null
      ? { ...profile, preferredResolver: 'profile-parts' }
      : profile
  const recipeId = recipeIdForProfile(base)
  if (!recipeId) return base
  const next: JsonRecord = { ...base }
  const dimensions = isRecord(next.defaultDimensions) ? next.defaultDimensions : {}
  if (!Object.keys(dimensions).length) {
    next.defaultDimensions =
      recipeId === 'factory:centrifugal-pump'
        ? { length: 2.6, width: 1.1, height: 1.4 }
        : { length: 2.4, width: 2.4, height: 3.2 }
  }
  if (!processPorts(next).length) {
    next.processPorts = defaultRecipePorts(recipeId, next).ports
  }
  if (!isRecord(next.equipmentDefaults)) {
    if (recipeId === 'factory:centrifugal-pump') {
      next.equipmentDefaults = {
        pumpType: /metering|\u8ba1\u91cf/i.test(profileText(next)) ? 'metering' : 'centrifugal',
        flowRate: 120,
        motorPower: 15,
        skidMounted: true,
      }
    } else if (recipeId === 'factory:storage-tank') {
      next.equipmentDefaults = {
        orientation: /horizontal|\u5367\u5f0f/i.test(profileText(next)) ? 'horizontal' : 'vertical',
        capacity: 10,
        liquidLevel: 0.5,
      }
    } else if (recipeId === 'factory:distillation-unit') {
      next.equipmentDefaults = {
        columnKind: /vacuum/i.test(profileText(next)) ? 'vacuum' : 'atmospheric',
      }
    } else if (recipeId === 'factory:refinery-reactor-unit') {
      next.equipmentDefaults = {
        variant: /fcc|catalytic[_\s-]?cracking|fluid[_\s-]?catalytic/i.test(profileText(next))
          ? 'fcc'
          : /reformer|reforming/i.test(profileText(next))
            ? 'reformer'
            : /sulfur|claus|acid[_\s-]?gas/i.test(profileText(next))
              ? 'sulfur'
              : 'hydrotreating',
      }
    } else if (recipeId === 'factory:refinery-auxiliary-unit') {
      next.equipmentDefaults = {
        variant: /flare/i.test(profileText(next))
          ? 'flare'
          : /boiler|steam/i.test(profileText(next))
            ? 'boiler'
            : 'pipe-rack',
      }
    }
  }
  return next
}
