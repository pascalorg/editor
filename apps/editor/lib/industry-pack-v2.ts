import type { AnyNodeDefinition, EquipmentPort, NodeRegistry } from '@pascal-app/core'
import { nodeRegistry } from '@pascal-app/core'

export type IndustryPackV2Manifest = {
  id: string
  name: string
  industry: string
  version: string
  schemaVersion: '2.0'
  dependsOnPlugins: string[]
  profiles: string[]
  equipmentBindings: IndustryPackV2EquipmentBinding[]
  processTemplates?: string[]
}

export type IndustryPackV2EquipmentBinding = {
  profileId: string
  nodeKind: string
  paramMap: Record<string, string>
  portMap: Record<string, string>
}

export type IndustryPackV2ValidationProfile = {
  id: string
  defaultDimensions?: Record<string, unknown>
  processPorts?: Array<Record<string, unknown>>
  [key: string]: unknown
}

export type IndustryPackV2ProcessTemplate = {
  processId: string
  stations: IndustryPackV2FactoryStation[]
}

export type IndustryPackV2FactoryStation = {
  id: string
  label?: string
  profileId?: string
  equipmentProfileId?: string
  genericFallback?: { reason: string }
}

export type IndustryPackV2StationResolution =
  | {
      stationId: string
      profileId: string
      nodeKind: string
      mode: 'equipment-node'
    }
  | {
      stationId: string
      mode: 'generic-fallback'
      reason: string
    }
  | {
      stationId: string
      mode: 'unresolved'
      reason: string
    }

export type IndustryPackV2ValidationResult = {
  ok: boolean
  manifest: IndustryPackV2Manifest
  issues: string[]
  warnings: string[]
  stationResolutions: IndustryPackV2StationResolution[]
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(stringValue).filter((value): value is string => Boolean(value))
}

function nonEmptyStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const result: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value)) {
    const from = stringValue(key)
    const to = stringValue(raw)
    if (!from || !to) return undefined
    result[from] = to
  }
  return result
}

function normalizeEquipmentBinding(value: unknown): IndustryPackV2EquipmentBinding | undefined {
  if (!isRecord(value)) return undefined
  const profileId = stringValue(value.profileId)
  const nodeKind = stringValue(value.nodeKind)
  const paramMap = nonEmptyStringRecord(value.paramMap)
  const portMap = nonEmptyStringRecord(value.portMap)
  if (!profileId || !nodeKind || !paramMap || !portMap) return undefined
  return { profileId, nodeKind, paramMap, portMap }
}

export function normalizeIndustryPackV2Manifest(value: unknown): IndustryPackV2Manifest {
  if (!isRecord(value)) throw new Error('Industry pack v2 manifest must be an object.')
  const id = stringValue(value.id)
  const name = stringValue(value.name)
  const industry = stringValue(value.industry)
  const version = stringValue(value.version)
  if (!id) throw new Error('Industry pack v2 id is required.')
  if (!name) throw new Error('Industry pack v2 name is required.')
  if (!industry) throw new Error('Industry pack v2 industry is required.')
  if (!version) throw new Error('Industry pack v2 version is required.')
  if (value.schemaVersion !== '2.0') {
    throw new Error('Industry pack v2 requires schemaVersion "2.0".')
  }

  const dependsOnPlugins = stringArray(value.dependsOnPlugins)
  if (dependsOnPlugins.length === 0) {
    throw new Error('Industry pack v2 dependsOnPlugins must be a non-empty array.')
  }

  const profiles = stringArray(value.profiles)
  if (profiles.length === 0) {
    throw new Error('Industry pack v2 profiles must be a non-empty array.')
  }

  if (!Array.isArray(value.equipmentBindings) || value.equipmentBindings.length === 0) {
    throw new Error('Industry pack v2 equipmentBindings must be a non-empty array.')
  }
  const equipmentBindings = value.equipmentBindings.map(normalizeEquipmentBinding)
  const invalidIndex = equipmentBindings.findIndex((binding) => !binding)
  if (invalidIndex >= 0) {
    throw new Error(`Invalid equipmentBindings[${invalidIndex}] in industry pack v2 manifest.`)
  }

  return {
    id,
    name,
    industry,
    version,
    schemaVersion: '2.0',
    dependsOnPlugins,
    profiles,
    equipmentBindings: equipmentBindings as IndustryPackV2EquipmentBinding[],
    ...(stringArray(value.processTemplates).length
      ? { processTemplates: stringArray(value.processTemplates) }
      : {}),
  }
}

function nodeSchemaFields(def: AnyNodeDefinition): Set<string> {
  const shape = (def.schema as { shape?: unknown }).shape
  if (!isRecord(shape)) return new Set()
  return new Set(Object.keys(shape))
}

function readPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current == null) return undefined
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (Number.isInteger(index)) return current[index]
      return current.find((item) => isRecord(item) && item.id === segment)
    }
    return isRecord(current) ? current[segment] : undefined
  }, value)
}

function profilePortIds(profile: IndustryPackV2ValidationProfile | undefined): string[] {
  return (profile?.processPorts ?? [])
    .map((port) => stringValue(port.id))
    .filter((id): id is string => Boolean(id))
}

function defaultNodeFor(def: AnyNodeDefinition): unknown {
  return def.schema.parse(def.defaults())
}

function nodePortIds(def: AnyNodeDefinition): Set<string> {
  if (!def.ports) return new Set()
  const node = defaultNodeFor(def) as never
  const ports = def.ports(node, {
    resolve: () => undefined,
    children: [],
    siblings: [],
    parent: null,
  })
  return new Set((ports as EquipmentPort[]).map((port) => port.id))
}

function stationProfileId(station: IndustryPackV2FactoryStation): string | undefined {
  return station.profileId ?? station.equipmentProfileId
}

function resolveStations(input: {
  bindingsByProfileId: Map<string, IndustryPackV2EquipmentBinding>
  processTemplates: IndustryPackV2ProcessTemplate[]
}): IndustryPackV2StationResolution[] {
  return input.processTemplates.flatMap((template) =>
    template.stations.map((station) => {
      const profileId = stationProfileId(station)
      if (profileId) {
        const binding = input.bindingsByProfileId.get(profileId)
        if (binding) {
          return {
            stationId: station.id,
            profileId,
            nodeKind: binding.nodeKind,
            mode: 'equipment-node' as const,
          }
        }
        return {
          stationId: station.id,
          mode: 'unresolved' as const,
          reason: `No equipment binding for profile "${profileId}".`,
        }
      }
      if (station.genericFallback?.reason) {
        return {
          stationId: station.id,
          mode: 'generic-fallback' as const,
          reason: station.genericFallback.reason,
        }
      }
      return {
        stationId: station.id,
        mode: 'unresolved' as const,
        reason: 'Station has no profileId and no explicit genericFallback.',
      }
    }),
  )
}

export function validateIndustryPackV2(input: {
  manifest: IndustryPackV2Manifest
  profiles: IndustryPackV2ValidationProfile[]
  processTemplates?: IndustryPackV2ProcessTemplate[]
  registry?: NodeRegistry
}): IndustryPackV2ValidationResult {
  const registry = input.registry ?? nodeRegistry
  const issues: string[] = []
  const warnings: string[] = []
  const profilesById = new Map(input.profiles.map((profile) => [profile.id, profile]))
  const bindingsByProfileId = new Map<string, IndustryPackV2EquipmentBinding>()

  for (const binding of input.manifest.equipmentBindings) {
    const duplicate = bindingsByProfileId.get(binding.profileId)
    if (duplicate) {
      issues.push(`Duplicate equipment binding for profile "${binding.profileId}".`)
    }
    bindingsByProfileId.set(binding.profileId, binding)

    const profile = profilesById.get(binding.profileId)
    if (!profile) {
      issues.push(`Equipment binding references missing profile "${binding.profileId}".`)
      continue
    }

    const def = registry.get(binding.nodeKind)
    if (!def) {
      issues.push(
        `Equipment binding ${binding.profileId} references unregistered nodeKind "${binding.nodeKind}".`,
      )
      continue
    }

    const fields = nodeSchemaFields(def)
    for (const [sourcePath, targetField] of Object.entries(binding.paramMap)) {
      if (readPath(profile, sourcePath) === undefined) {
        issues.push(`Binding ${binding.profileId} paramMap source "${sourcePath}" is missing.`)
      }
      if (!fields.has(targetField)) {
        issues.push(
          `Binding ${binding.profileId} paramMap target "${targetField}" is not in nodeKind "${binding.nodeKind}".`,
        )
      }
    }

    const sourcePorts = profilePortIds(profile)
    for (const portId of sourcePorts) {
      if (!binding.portMap[portId]) {
        issues.push(`Binding ${binding.profileId} is missing portMap for profile port "${portId}".`)
      }
    }
    const nodePorts = nodePortIds(def)
    for (const [profilePortId, nodePortId] of Object.entries(binding.portMap)) {
      if (!sourcePorts.includes(profilePortId)) {
        issues.push(`Binding ${binding.profileId} maps unknown profile port "${profilePortId}".`)
      }
      if (!nodePorts.has(nodePortId)) {
        issues.push(
          `Binding ${binding.profileId} maps profile port "${profilePortId}" to missing node port "${nodePortId}".`,
        )
      }
    }
  }

  for (const profile of input.profiles) {
    if (!bindingsByProfileId.has(profile.id)) {
      warnings.push(`Profile ${profile.id} has no equipment binding.`)
    }
  }

  const stationResolutions = resolveStations({
    bindingsByProfileId,
    processTemplates: input.processTemplates ?? [],
  })
  for (const resolution of stationResolutions) {
    if (resolution.mode === 'unresolved') {
      issues.push(`Factory station ${resolution.stationId} is unresolved: ${resolution.reason}`)
    }
  }

  return {
    ok: issues.length === 0,
    manifest: input.manifest,
    issues,
    warnings,
    stationResolutions,
  }
}
