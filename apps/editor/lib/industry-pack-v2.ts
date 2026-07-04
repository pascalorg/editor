import type {
  EquipmentParamValue,
  SemanticRecipeDefinition,
  SemanticRecipeEnvelope,
  SemanticRecipeRegistry,
} from '@pascal-app/core'
import { semanticRecipeRegistry, validateSemanticRecipeComposeResult } from '@pascal-app/core'

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
  recipeId: string
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
      recipeId: string
      mode: 'semantic-assembly'
    }
  | {
      stationId: string
      profileId: string
      mode: 'profile-parts'
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
  const recipeId = stringValue(value.recipeId)
  const paramMap = nonEmptyStringRecord(value.paramMap)
  const portMap = nonEmptyStringRecord(value.portMap)
  if (!profileId || !recipeId || !paramMap || !portMap) return undefined
  return { profileId, recipeId, paramMap, portMap }
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

  if (!Array.isArray(value.equipmentBindings)) {
    throw new Error('Industry pack v2 equipmentBindings must be an array.')
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

function recipeParamFields(recipe: SemanticRecipeDefinition): Set<string> {
  const schema = recipe.paramSchema
  if (isRecord(schema) && Array.isArray(schema.fields)) {
    return new Set(schema.fields.map(stringValue).filter((field): field is string => Boolean(field)))
  }
  return new Set(['length', 'width', 'height'])
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

function isEquipmentParamValue(value: unknown): value is EquipmentParamValue {
  if (value === null) return true
  if (typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isEquipmentParamValue)
  if (!isRecord(value)) return false
  return Object.values(value).every(isEquipmentParamValue)
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function profilePortIds(profile: IndustryPackV2ValidationProfile | undefined): string[] {
  return (profile?.processPorts ?? [])
    .map((port) => stringValue(port.id))
    .filter((id): id is string => Boolean(id))
}

function isSemanticProfilePartsProfile(profile: IndustryPackV2ValidationProfile | undefined): boolean {
  if (!profile) return false
  if (profile.preferredResolver !== 'profile-parts') return false
  const parts = Array.isArray(profile.parts) ? profile.parts : []
  return parts.some(
    (part) =>
      isRecord(part) &&
      typeof part.kind === 'string' &&
      typeof part.semanticRole === 'string' &&
      part.semanticRole.trim().length > 0,
  )
}

function composeEnvelope(
  recipe: SemanticRecipeDefinition,
  profile: IndustryPackV2ValidationProfile,
  params: Record<string, EquipmentParamValue>,
): Partial<SemanticRecipeEnvelope> | undefined {
  const dimensions = isRecord(profile.defaultDimensions) ? profile.defaultDimensions : {}
  const length = positiveNumber(params.length) ?? positiveNumber(dimensions.length) ?? recipe.defaultEnvelope?.length
  const width =
    positiveNumber(params.width) ??
    positiveNumber(params.diameter) ??
    positiveNumber(dimensions.width) ??
    positiveNumber(dimensions.diameter) ??
    recipe.defaultEnvelope?.width
  const height = positiveNumber(params.height) ?? positiveNumber(dimensions.height) ?? recipe.defaultEnvelope?.height
  if (length == null && width == null && height == null) return undefined
  return {
    ...(length != null ? { length } : {}),
    ...(width != null ? { width } : {}),
    ...(height != null ? { height } : {}),
  }
}

function profileMedium(profile: IndustryPackV2ValidationProfile): string | undefined {
  return stringValue(profile.processPorts?.find((port) => stringValue(port.medium))?.medium)
}

function bindingParams(input: {
  binding: IndustryPackV2EquipmentBinding
  profile: IndustryPackV2ValidationProfile
  issues: string[]
}): Record<string, EquipmentParamValue> {
  const params: Record<string, EquipmentParamValue> = {}
  for (const [sourcePath, targetField] of Object.entries(input.binding.paramMap)) {
    const value = readPath(input.profile, sourcePath)
    if (value === undefined) continue
    if (!isEquipmentParamValue(value)) {
      input.issues.push(
        `Binding ${input.binding.profileId} paramMap source "${sourcePath}" is not a valid recipe parameter value.`,
      )
      continue
    }
    params[targetField] = value
  }
  return params
}

function recipePortIds(input: {
  recipe: SemanticRecipeDefinition
  binding: IndustryPackV2EquipmentBinding
  profile: IndustryPackV2ValidationProfile
  params: Record<string, EquipmentParamValue>
}): { ports: Set<string>; issues: string[] } {
  const result = input.recipe.compose({
    params: input.params,
    profileId: input.binding.profileId,
    envelope: composeEnvelope(input.recipe, input.profile, input.params),
    medium: profileMedium(input.profile),
  })
  const composeIssues = validateSemanticRecipeComposeResult(input.recipe, result).map(
    (issue) =>
      `Binding ${input.binding.profileId} recipe "${input.binding.recipeId}" compose issue: ${issue.code} at ${issue.path}: ${issue.message}`,
  )
  return {
    ports: new Set((result.ports ?? []).map((port) => port.id)),
    issues: composeIssues,
  }
}

function stationProfileId(station: IndustryPackV2FactoryStation): string | undefined {
  return station.profileId ?? station.equipmentProfileId
}

function resolveStations(input: {
  bindingsByProfileId: Map<string, IndustryPackV2EquipmentBinding>
  profilesById: Map<string, IndustryPackV2ValidationProfile>
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
            recipeId: binding.recipeId,
            mode: 'semantic-assembly' as const,
          }
        }
        if (isSemanticProfilePartsProfile(input.profilesById.get(profileId))) {
          return {
            stationId: station.id,
            profileId,
            mode: 'profile-parts' as const,
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
  registry?: SemanticRecipeRegistry
}): IndustryPackV2ValidationResult {
  const registry = input.registry ?? semanticRecipeRegistry
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

    const recipe = registry.get(binding.recipeId)
    if (!recipe) {
      issues.push(
        `Equipment binding ${binding.profileId} references unregistered recipeId "${binding.recipeId}".`,
      )
      continue
    }

    const fields = recipeParamFields(recipe)
    for (const [sourcePath, targetField] of Object.entries(binding.paramMap)) {
      if (readPath(profile, sourcePath) === undefined) {
        issues.push(`Binding ${binding.profileId} paramMap source "${sourcePath}" is missing.`)
      }
      if (!fields.has(targetField)) {
        issues.push(
          `Binding ${binding.profileId} paramMap target "${targetField}" is not in recipe "${binding.recipeId}".`,
        )
      }
    }
    const params = bindingParams({ binding, profile, issues })

    const sourcePorts = profilePortIds(profile)
    for (const portId of sourcePorts) {
      if (!binding.portMap[portId]) {
        issues.push(`Binding ${binding.profileId} is missing portMap for profile port "${portId}".`)
      }
    }
    const recipePorts = recipePortIds({ recipe, binding, profile, params })
    issues.push(...recipePorts.issues)
    for (const [profilePortId, nodePortId] of Object.entries(binding.portMap)) {
      if (!sourcePorts.includes(profilePortId)) {
        issues.push(`Binding ${binding.profileId} maps unknown profile port "${profilePortId}".`)
      }
      if (!recipePorts.ports.has(nodePortId)) {
        issues.push(
          `Binding ${binding.profileId} maps profile port "${profilePortId}" to missing recipe port "${nodePortId}".`,
        )
      }
    }
  }

  for (const profile of input.profiles) {
    if (!bindingsByProfileId.has(profile.id) && !isSemanticProfilePartsProfile(profile)) {
      warnings.push(`Profile ${profile.id} has no equipment binding.`)
    }
  }

  const stationResolutions = resolveStations({
    bindingsByProfileId,
    profilesById,
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
