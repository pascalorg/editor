import type {
  EquipmentParamValue,
  SemanticRecipeRegistry,
  Vec3,
} from '@pascal-app/core'
import { semanticRecipeRegistry } from '@pascal-app/core'
import type {
  IndustryPackV2EquipmentBinding,
  IndustryPackV2Manifest,
  IndustryPackV2ValidationProfile,
} from './industry-pack-v2'

export type EquipmentBindingSource = 'prompt' | 'process-station' | 'manual-preset'

export type EquipmentSourceStation = {
  id: string
  label?: string
  profileId?: string
  equipmentProfileId?: string
  equipmentHint?: string
  prompt?: string
}

export type EquipmentSourcePreset = {
  id?: string
  label?: string
  profileId?: string
  recipeId?: string
  params?: Record<string, EquipmentParamValue>
}

export type EquipmentBindingResolverInput = {
  manifest: IndustryPackV2Manifest
  profiles: IndustryPackV2ValidationProfile[]
  source: EquipmentBindingSource
  prompt?: string
  station?: EquipmentSourceStation
  preset?: EquipmentSourcePreset
  registry?: SemanticRecipeRegistry
}

export type EquipmentBindingResolution = {
  binding: IndustryPackV2EquipmentBinding
  profile: IndustryPackV2ValidationProfile
  source: EquipmentBindingSource
  match: 'profile-id' | 'recipe-id' | 'text'
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
  return value.map(stringValue).filter((entry): entry is string => Boolean(entry))
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[_\-./]+/g, ' ').replace(/\s+/g, ' ').trim()
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

function profileAliases(profile: IndustryPackV2ValidationProfile): string[] {
  const aliases = [
    profile.id,
    profile.id.split('.').at(-1),
    stringValue(profile.name),
    stringValue(profile.displayName),
    ...stringArray(profile.aliases),
    ...stringArray(profile.keywords),
  ]
  return aliases.filter((entry): entry is string => Boolean(entry))
}

function profileMatchesText(profile: IndustryPackV2ValidationProfile, text: string): boolean {
  const normalizedText = normalizeText(text)
  if (!normalizedText) return false
  return profileAliases(profile).some((alias) => {
    const normalizedAlias = normalizeText(alias)
    return normalizedAlias.length > 0 && normalizedText.includes(normalizedAlias)
  })
}

function sourceProfileId(input: EquipmentBindingResolverInput): string | undefined {
  return (
    input.preset?.profileId ??
    input.station?.profileId ??
    input.station?.equipmentProfileId ??
    undefined
  )
}

function sourceRecipeId(input: EquipmentBindingResolverInput): string | undefined {
  return input.preset?.recipeId
}

function sourceText(input: EquipmentBindingResolverInput): string {
  return [
    input.prompt,
    input.station?.prompt,
    input.station?.equipmentHint,
    input.station?.label,
    input.preset?.label,
    input.preset?.id,
  ]
    .filter((entry): entry is string => Boolean(stringValue(entry)))
    .join(' ')
}

export function resolveEquipmentBinding(
  input: EquipmentBindingResolverInput,
): EquipmentBindingResolution | null {
  const registry = input.registry ?? semanticRecipeRegistry
  const profilesById = new Map(input.profiles.map((profile) => [profile.id, profile]))
  const bindings = input.manifest.equipmentBindings.filter((binding) => registry.has(binding.recipeId))

  const profileId = sourceProfileId(input)
  if (profileId) {
    const binding = bindings.find((candidate) => candidate.profileId === profileId)
    const profile = profilesById.get(profileId)
    if (binding && profile) return { binding, profile, source: input.source, match: 'profile-id' }
  }

  const recipeId = sourceRecipeId(input)
  if (recipeId) {
    const binding = bindings.find((candidate) => candidate.recipeId === recipeId)
    const profile = binding ? profilesById.get(binding.profileId) : undefined
    if (binding && profile) return { binding, profile, source: input.source, match: 'recipe-id' }
  }

  const text = sourceText(input)
  const textMatchedProfile = input.profiles.find((profile) => profileMatchesText(profile, text))
  if (textMatchedProfile) {
    const binding = bindings.find((candidate) => candidate.profileId === textMatchedProfile.id)
    if (binding) {
      return { binding, profile: textMatchedProfile, source: input.source, match: 'text' }
    }
  }

  return null
}

export type SemanticEquipmentSpec = {
  recipeId: string
  profileId: string
  params: Record<string, EquipmentParamValue>
  position?: Vec3
  rotation?: Vec3
  metadata?: Record<string, EquipmentParamValue>
}

export function createEquipmentSpecFromV2Binding(input: {
  resolution: EquipmentBindingResolution
  position?: Vec3
  rotation?: Vec3
  paramOverrides?: Record<string, EquipmentParamValue>
  metadata?: Record<string, EquipmentParamValue>
}): SemanticEquipmentSpec | null {
  const params: Record<string, EquipmentParamValue> = {}
  for (const [sourcePath, targetField] of Object.entries(input.resolution.binding.paramMap)) {
    const value = readPath(input.resolution.profile, sourcePath)
    if (!isEquipmentParamValue(value)) return null
    params[targetField] = value
  }

  const spec: SemanticEquipmentSpec = {
    recipeId: input.resolution.binding.recipeId,
    profileId: input.resolution.binding.profileId,
    params: { ...params, ...(input.paramOverrides ?? {}) },
    metadata: {
      compilerSource: input.resolution.source,
      equipmentProfileId: input.resolution.binding.profileId,
      equipmentBindingMatch: input.resolution.match,
      ...(input.metadata ?? {}),
    },
  }
  if (input.position) spec.position = input.position
  if (input.rotation) spec.rotation = input.rotation
  return spec
}
