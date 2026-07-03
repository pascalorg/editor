export type EquipmentPortSide = 'left' | 'right' | 'front' | 'back' | 'top' | 'bottom'

export type EquipmentConnectionMedium =
  | 'water'
  | 'hydrogen'
  | 'oxygen'
  | 'power'
  | 'cooling'
  | 'material'
  | 'gas'
  | 'molten_metal'
  | 'utility'
  | (string & {})

export type EquipmentEnvelopeOrigin =
  | 'profile'
  | 'station_profile'
  | 'user'
  | 'vendor'
  | 'vendor_profile'
  | 'generated'

export type EquipmentEnvelope = {
  length: number
  width: number
  height: number
  origin: EquipmentEnvelopeOrigin
  tolerance?: number
}

export type EquipmentPort = {
  id: string
  medium: EquipmentConnectionMedium
  side: EquipmentPortSide
  height: number
  offset?: number
  diameter?: number
  direction?: readonly [number, number, number]
}

export type EquipmentSourcePackRef = {
  id: string
  version?: string
  industry?: string
}

export type EquipmentContract = {
  profileId: string
  equipmentFamily: string
  scaleClass: string
  envelope: EquipmentEnvelope
  ports: EquipmentPort[]
  requiredRoles?: string[]
  primarySemanticRole?: string
  sourcePack?: EquipmentSourcePackRef
  nodeBinding?: EquipmentNodeBinding
}

export type EquipmentParamValue =
  | string
  | number
  | boolean
  | null
  | EquipmentParamValue[]
  | { readonly [key: string]: EquipmentParamValue }

export type EquipmentParamMapping =
  | { source: 'contract'; path: string; fallback?: EquipmentParamValue }
  | { source: 'literal'; value: EquipmentParamValue }

export type EquipmentNodeBinding = {
  profileId: string
  nodeKind: string
  paramMap: Record<string, EquipmentParamMapping>
  portMap?: Record<string, string>
  fallbackNodeKind?: string
  requiredPluginId?: string
}

export type EquipmentSpec = {
  nodeKind: string
  profileId: string
  params: Record<string, EquipmentParamValue>
  position?: readonly [number, number, number]
  rotation?: readonly [number, number, number]
  metadata?: Record<string, EquipmentParamValue>
}

export type EquipmentNodeDescriptor = {
  family: string
  label?: string
  acceptsProfiles?: readonly string[]
  defaultPorts?: readonly EquipmentPort[]
}

export type IndustryPluginPackManifest = {
  id: string
  name: string
  industry: string
  version: string
  schemaVersion: 1
  pluginApiVersion?: 1
  dependsOnPlugins?: string[]
  equipmentBindings?: EquipmentNodeBinding[]
}

type UnknownRecord = Record<string, unknown>

const EQUIPMENT_ENVELOPE_ORIGINS: readonly EquipmentEnvelopeOrigin[] = [
  'profile',
  'station_profile',
  'user',
  'vendor',
  'vendor_profile',
  'generated',
]

const EQUIPMENT_PORT_SIDES: readonly EquipmentPortSide[] = [
  'left',
  'right',
  'front',
  'back',
  'top',
  'bottom',
]

export function isRecord(input: unknown): input is UnknownRecord {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function nonEmptyString(input: unknown): string | null {
  return typeof input === 'string' && input.trim().length > 0 ? input.trim() : null
}

function finiteNumber(input: unknown): number | null {
  return typeof input === 'number' && Number.isFinite(input) ? input : null
}

function isEquipmentEnvelopeOrigin(input: string): input is EquipmentEnvelopeOrigin {
  return EQUIPMENT_ENVELOPE_ORIGINS.includes(input as EquipmentEnvelopeOrigin)
}

function isEquipmentPortSide(input: string): input is EquipmentPortSide {
  return EQUIPMENT_PORT_SIDES.includes(input as EquipmentPortSide)
}

function positiveNumber(input: unknown): number | null {
  const value = finiteNumber(input)
  return value !== null && value > 0 ? value : null
}

function normalizeStringArray(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined
  const values = input.map(nonEmptyString)
  return values.every((value): value is string => value !== null) ? values : undefined
}

function normalizeStringRecord(input: unknown): Record<string, string> | undefined {
  if (!isRecord(input)) return undefined
  const entries = Object.entries(input).map(([key, value]) => [key, nonEmptyString(value)] as const)
  if (entries.some(([, value]) => value === null)) return undefined
  return Object.fromEntries(entries) as Record<string, string>
}

function isEquipmentParamValue(input: unknown): input is EquipmentParamValue {
  if (input === null) return true
  if (typeof input === 'string' || typeof input === 'boolean') return true
  if (typeof input === 'number') return Number.isFinite(input)
  if (Array.isArray(input)) return input.every(isEquipmentParamValue)
  if (!isRecord(input)) return false
  return Object.values(input).every(isEquipmentParamValue)
}

function normalizeParamMapping(input: unknown): EquipmentParamMapping | null {
  if (typeof input === 'string') {
    const path = nonEmptyString(input)
    return path ? { source: 'contract', path } : null
  }
  if (!isRecord(input)) return null
  if (input.source === 'literal') {
    return isEquipmentParamValue(input.value) ? { source: 'literal', value: input.value } : null
  }
  if (input.source === 'contract') {
    const path = nonEmptyString(input.path)
    if (!path) return null
    const mapping: EquipmentParamMapping = { source: 'contract', path }
    if ('fallback' in input) {
      if (!isEquipmentParamValue(input.fallback)) return null
      mapping.fallback = input.fallback
    }
    return mapping
  }
  return null
}

function normalizeParamMap(input: unknown): Record<string, EquipmentParamMapping> | null {
  if (!isRecord(input)) return null
  const result: Record<string, EquipmentParamMapping> = {}
  for (const [key, value] of Object.entries(input)) {
    const paramKey = nonEmptyString(key)
    const mapping = normalizeParamMapping(value)
    if (!paramKey || !mapping) return null
    result[paramKey] = mapping
  }
  return result
}

function normalizeVec3(input: unknown): readonly [number, number, number] | undefined {
  if (!Array.isArray(input) || input.length !== 3) return undefined
  const x = finiteNumber(input[0])
  const y = finiteNumber(input[1])
  const z = finiteNumber(input[2])
  return x !== null && y !== null && z !== null ? [x, y, z] : undefined
}

export function normalizeEquipmentEnvelope(input: unknown): EquipmentEnvelope | null {
  if (!isRecord(input)) return null
  const length = positiveNumber(input.length)
  const width = positiveNumber(input.width)
  const height = positiveNumber(input.height)
  const origin = nonEmptyString(input.origin)
  if (
    length === null ||
    width === null ||
    height === null ||
    origin === null ||
    !isEquipmentEnvelopeOrigin(origin)
  ) {
    return null
  }

  const envelope: EquipmentEnvelope = { length, width, height, origin }
  if ('tolerance' in input) {
    const tolerance = finiteNumber(input.tolerance)
    if (tolerance === null || tolerance < 0) return null
    envelope.tolerance = tolerance
  }
  return envelope
}

export function normalizeEquipmentPort(input: unknown): EquipmentPort | null {
  if (!isRecord(input)) return null
  const id = nonEmptyString(input.id)
  const medium = nonEmptyString(input.medium)
  const side = nonEmptyString(input.side)
  const height = finiteNumber(input.height)
  if (!id || !medium || !side || !isEquipmentPortSide(side) || height === null) return null

  const port: EquipmentPort = { id, medium, side, height }
  if ('offset' in input) {
    const offset = finiteNumber(input.offset)
    if (offset === null) return null
    port.offset = offset
  }
  if ('diameter' in input) {
    const diameter = positiveNumber(input.diameter)
    if (diameter === null) return null
    port.diameter = diameter
  }
  if ('direction' in input) {
    const direction = normalizeVec3(input.direction)
    if (!direction) return null
    port.direction = direction
  }
  return port
}

export function normalizeEquipmentNodeBinding(input: unknown): EquipmentNodeBinding | null {
  if (!isRecord(input)) return null
  const profileId = nonEmptyString(input.profileId)
  const nodeKind = nonEmptyString(input.nodeKind)
  const paramMap = normalizeParamMap(input.paramMap)
  if (!profileId || !nodeKind || !paramMap) return null

  const binding: EquipmentNodeBinding = { profileId, nodeKind, paramMap }
  const portMap = normalizeStringRecord(input.portMap)
  if ('portMap' in input && !portMap) return null
  if (portMap) binding.portMap = portMap

  const fallbackNodeKind = nonEmptyString(input.fallbackNodeKind)
  if (fallbackNodeKind) binding.fallbackNodeKind = fallbackNodeKind

  const requiredPluginId = nonEmptyString(input.requiredPluginId)
  if (requiredPluginId) binding.requiredPluginId = requiredPluginId

  return binding
}

export function normalizeEquipmentContract(input: unknown): EquipmentContract | null {
  if (!isRecord(input)) return null
  const profileId = nonEmptyString(input.profileId)
  const equipmentFamily = nonEmptyString(input.equipmentFamily)
  const scaleClass = nonEmptyString(input.scaleClass)
  const envelope = normalizeEquipmentEnvelope(input.envelope)
  if (!profileId || !equipmentFamily || !scaleClass || !envelope || !Array.isArray(input.ports)) {
    return null
  }

  const ports = input.ports.map(normalizeEquipmentPort)
  if (!ports.every((port): port is EquipmentPort => port !== null)) return null

  const contract: EquipmentContract = { profileId, equipmentFamily, scaleClass, envelope, ports }
  const requiredRoles = normalizeStringArray(input.requiredRoles)
  if ('requiredRoles' in input && !requiredRoles) return null
  if (requiredRoles) contract.requiredRoles = requiredRoles

  const primarySemanticRole = nonEmptyString(input.primarySemanticRole)
  if (primarySemanticRole) contract.primarySemanticRole = primarySemanticRole

  if ('sourcePack' in input) {
    if (!isRecord(input.sourcePack)) return null
    const id = nonEmptyString(input.sourcePack.id)
    if (!id) return null
    contract.sourcePack = { id }
    const version = nonEmptyString(input.sourcePack.version)
    const industry = nonEmptyString(input.sourcePack.industry)
    if (version) contract.sourcePack.version = version
    if (industry) contract.sourcePack.industry = industry
  }

  if ('nodeBinding' in input) {
    const nodeBinding = normalizeEquipmentNodeBinding(input.nodeBinding)
    if (!nodeBinding) return null
    contract.nodeBinding = nodeBinding
  }

  return contract
}

export function normalizeIndustryPluginPackManifest(
  input: unknown,
): IndustryPluginPackManifest | null {
  if (!isRecord(input)) return null
  const id = nonEmptyString(input.id)
  const name = nonEmptyString(input.name)
  const industry = nonEmptyString(input.industry)
  const version = nonEmptyString(input.version)
  if (!id || !name || !industry || !version || input.schemaVersion !== 1) return null

  const manifest: IndustryPluginPackManifest = { id, name, industry, version, schemaVersion: 1 }
  if ('pluginApiVersion' in input) {
    if (input.pluginApiVersion !== 1) return null
    manifest.pluginApiVersion = 1
  }

  const dependsOnPlugins = normalizeStringArray(input.dependsOnPlugins)
  if ('dependsOnPlugins' in input && !dependsOnPlugins) return null
  if (dependsOnPlugins) manifest.dependsOnPlugins = dependsOnPlugins

  if ('equipmentBindings' in input) {
    if (!Array.isArray(input.equipmentBindings)) return null
    const equipmentBindings = input.equipmentBindings.map(normalizeEquipmentNodeBinding)
    if (!equipmentBindings.every((binding): binding is EquipmentNodeBinding => binding !== null)) {
      return null
    }
    manifest.equipmentBindings = equipmentBindings
  }

  return manifest
}

export function equipmentPortKey(profileId: string, portId: string): string {
  return `${profileId}:${portId}`
}

function readPath(input: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current === undefined || current === null) return undefined
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (Number.isInteger(index)) return current[index]
      return current.find((item) => isRecord(item) && item.id === segment)
    }
    return isRecord(current) ? current[segment] : undefined
  }, input)
}

export function createEquipmentSpecFromBinding(input: {
  contract: EquipmentContract
  binding?: EquipmentNodeBinding
  defaults?: Record<string, EquipmentParamValue>
  position?: readonly [number, number, number]
  rotation?: readonly [number, number, number]
  metadata?: Record<string, EquipmentParamValue>
}): EquipmentSpec | null {
  const binding = input.binding ?? input.contract.nodeBinding
  if (!binding || binding.profileId !== input.contract.profileId) return null

  const params: Record<string, EquipmentParamValue> = { ...(input.defaults ?? {}) }
  for (const [key, mapping] of Object.entries(binding.paramMap)) {
    if (mapping.source === 'literal') {
      params[key] = mapping.value
      continue
    }
    const value = readPath(input.contract, mapping.path)
    if (isEquipmentParamValue(value)) {
      params[key] = value
    } else if ('fallback' in mapping) {
      params[key] = mapping.fallback ?? null
    } else {
      return null
    }
  }

  const spec: EquipmentSpec = {
    nodeKind: binding.nodeKind,
    profileId: input.contract.profileId,
    params,
  }
  if (input.position) spec.position = input.position
  if (input.rotation) spec.rotation = input.rotation
  if (input.metadata) spec.metadata = input.metadata
  return spec
}
