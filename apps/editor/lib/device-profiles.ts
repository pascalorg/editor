import fs from 'node:fs/promises'
import path from 'node:path'
import {
  DEVICE_PROFILE_DEFINITIONS,
  type DeviceProfileDefinition,
  type DeviceProfileSource,
  EDITABLE_SCHEMA_DEFINITIONS,
  type EditableSchemaDefinition,
  mergeDeviceProfiles,
  normalizeDeviceProfileInput,
  resolveEditableSchemaForProfile,
  validateDeviceProfileDefinition,
} from '@pascal-app/core/lib/device-profile-registry'
import { findRepoRoot } from './generated-assets/manifest'
import { enabledProfilePackDirs, validateProfilePackDir } from './profile-packs'

type ProfileSourceDir = {
  dir: string
  source: DeviceProfileSource
}

export type LoadedDeviceProfiles = {
  profiles: DeviceProfileDefinition[]
  warnings: string[]
  knowledgeResources?: {
    layouts: Array<Record<string, unknown>>
    partPresets: Array<Record<string, unknown>>
    qualityRules: Array<Record<string, unknown>>
    editableSchemas: EditableSchemaDefinition[]
    aliases: Array<Record<string, unknown>>
  }
}

export type LoadDeviceProfilesOptions = {
  extraPackDirs?: readonly string[]
}

async function exists(dir: string) {
  try {
    await fs.access(dir)
    return true
  } catch {
    return false
  }
}

async function collectProfileFiles(dir: string): Promise<string[]> {
  if (!(await exists(dir))) return []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectProfileFiles(fullPath)))
    } else if (entry.name !== 'pack.json' && /\.(json|ya?ml)$/i.test(entry.name)) {
      files.push(fullPath)
    }
  }
  return files
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  const number = Number(trimmed)
  if (Number.isFinite(number) && /^-?\d+(?:\.\d+)?$/.test(trimmed)) return number
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((item) => parseScalar(item))
  }
  return trimmed
}

function parseSimpleYaml(text: string): unknown {
  const root: Record<string, unknown> = {}
  let currentObjectKey: string | undefined
  let currentArrayKey: string | undefined
  let currentArrayItem: Record<string, unknown> | undefined

  for (const rawLine of text.split(/\r?\n/)) {
    const withoutComment = rawLine.replace(/\s+#.*$/, '')
    if (!withoutComment.trim()) continue
    const indent = withoutComment.match(/^\s*/)?.[0].length ?? 0
    const line = withoutComment.trim()

    if (indent === 0) {
      currentObjectKey = undefined
      currentArrayKey = undefined
      currentArrayItem = undefined
      const match = /^([^:]+):(?:\s*(.*))?$/.exec(line)
      if (!match) continue
      const key = match[1]?.trim()
      const value = match[2] ?? ''
      if (!key) continue
      if (!value) {
        if (key === 'parts') {
          root[key] = []
          currentArrayKey = key
        } else {
          root[key] = {}
          currentObjectKey = key
        }
      } else {
        root[key] = parseScalar(value)
      }
      continue
    }

    if (currentArrayKey && line.startsWith('- ')) {
      const item: Record<string, unknown> = {}
      ;(root[currentArrayKey] as unknown[]).push(item)
      currentArrayItem = item
      const inline = line.slice(2)
      const match = /^([^:]+):\s*(.*)$/.exec(inline)
      if (match?.[1]) item[match[1].trim()] = parseScalar(match[2] ?? '')
      continue
    }

    const match = /^([^:]+):\s*(.*)$/.exec(line)
    if (!match?.[1]) continue
    const key = match[1].trim()
    const value = parseScalar(match[2] ?? '')
    if (currentArrayItem) {
      currentArrayItem[key] = value
    } else if (currentObjectKey && typeof root[currentObjectKey] === 'object') {
      ;(root[currentObjectKey] as Record<string, unknown>)[key] = value
    }
  }
  return root
}

function parseProfileFile(text: string, filePath: string): unknown {
  if (/\.json$/i.test(filePath)) return JSON.parse(text)
  try {
    return JSON.parse(text)
  } catch {
    return parseSimpleYaml(text)
  }
}

function profilePayload(raw: Record<string, unknown>): Record<string, unknown> {
  if (typeof raw.id === 'string') return raw
  if (typeof raw.profile === 'object' && raw.profile !== null && !Array.isArray(raw.profile)) {
    return raw.profile as Record<string, unknown>
  }
  if (
    typeof raw.draftProfile === 'object' &&
    raw.draftProfile !== null &&
    !Array.isArray(raw.draftProfile)
  ) {
    return raw.draftProfile as Record<string, unknown>
  }
  return raw
}

async function loadProfilesFromDir({
  dir,
  source,
}: ProfileSourceDir): Promise<LoadedDeviceProfiles> {
  const warnings: string[] = []
  const profiles: DeviceProfileDefinition[] = []
  for (const file of await collectProfileFiles(dir)) {
    try {
      const parsed = parseProfileFile(await fs.readFile(file, 'utf8'), file)
      const rawProfiles = Array.isArray(parsed) ? parsed : [parsed]
      for (const raw of rawProfiles) {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
          warnings.push(`Ignored non-object device profile in ${file}.`)
          continue
        }
        const profile = normalizeDeviceProfileInput(profilePayload(raw), source)
        const validation = validateDeviceProfileDefinition(profile)
        if (!validation.ok) {
          warnings.push(
            `Ignored invalid device profile ${profile.id} from ${file}: ${validation.issues.join('; ')}`,
          )
          continue
        }
        warnings.push(...validation.warnings.map((warning) => `${file}: ${warning}`))
        profiles.push(profile)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      warnings.push(`Failed to load device profile ${file}: ${message}`)
    }
  }
  return { profiles, warnings }
}

function resourceId(resource: Record<string, unknown>) {
  return typeof resource.id === 'string' && resource.id.trim() ? resource.id.trim() : undefined
}

function resourceById(resources: readonly Record<string, unknown>[]) {
  return new Map(
    resources.flatMap((resource) => {
      const id = resourceId(resource)
      return id ? [[id, resource] as const] : []
    }),
  )
}

function resolveProfileKnowledgeResources(
  profiles: readonly DeviceProfileDefinition[],
  resources: NonNullable<LoadedDeviceProfiles['knowledgeResources']>,
): DeviceProfileDefinition[] {
  const layouts = resourceById(resources.layouts)
  const partPresets = resourceById(resources.partPresets)
  const qualityRules = resourceById(resources.qualityRules)
  const editableSchemas = [...resources.editableSchemas, ...EDITABLE_SCHEMA_DEFINITIONS]

  return profiles.map((profile) => {
    const layoutTemplate =
      typeof profile.layoutTemplate === 'string' ? layouts.get(profile.layoutTemplate) : undefined
    const resolvedPartPresets = Object.fromEntries(
      Object.values(profile.partPresets ?? {}).flatMap((presetId) => {
        const preset = partPresets.get(presetId)
        return preset ? [[presetId, preset] as const] : []
      }),
    )
    const qualityRule =
      typeof profile.qualityRules === 'string' ? qualityRules.get(profile.qualityRules) : undefined
    const resolvedEditableSchema = resolveEditableSchemaForProfile(profile, editableSchemas)

    return {
      ...profile,
      ...(layoutTemplate
        ? {
            layoutHints: {
              ...(profile.layoutHints ?? {}),
              layoutTemplate,
            },
          }
        : {}),
      ...(Object.keys(resolvedPartPresets).length > 0 ? { resolvedPartPresets } : {}),
      ...(qualityRule ? { qualityRules: qualityRule } : {}),
      ...(resolvedEditableSchema ? { resolvedEditableSchema } : {}),
    }
  })
}

async function loadProfilesFromPackDir(dir: string): Promise<LoadedDeviceProfiles> {
  try {
    const validation = await validateProfilePackDir(dir)
    const profiles = resolveProfileKnowledgeResources(validation.profiles, validation.resources)
    return {
      profiles,
      knowledgeResources: validation.resources,
      warnings: validation.warnings.map((warning) => `${validation.manifest.id}: ${warning}`),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { profiles: [], warnings: [`Failed to load device profile pack ${dir}: ${message}`] }
  }
}

export async function loadDeviceProfiles(
  options: LoadDeviceProfilesOptions = {},
): Promise<LoadedDeviceProfiles> {
  const root = await findRepoRoot()
  const enabledPackDirs = await enabledProfilePackDirs()
  const extraPackDirs = Array.from(
    new Set(
      (options.extraPackDirs ?? [])
        .filter((dir): dir is string => typeof dir === 'string' && dir.trim().length > 0)
        .map((dir) => path.resolve(dir)),
    ),
  )
  const sourceDirs: ProfileSourceDir[] = [
    {
      dir: path.join(root, 'apps', 'editor', 'data', 'device-profile-packs'),
      source: 'imported_pack',
    },
    { dir: path.join(root, 'apps', 'editor', 'data', 'device-profiles'), source: 'workspace' },
    {
      dir: path.join(root, 'apps', 'editor', '.generated', 'device-profile-candidates'),
      source: 'generated_candidate',
    },
  ]
  const loaded = await Promise.all(sourceDirs.map(loadProfilesFromDir))
  const enabledPacks = await Promise.all(
    [...enabledPackDirs, ...extraPackDirs].map(loadProfilesFromPackDir),
  )
  const packResources: NonNullable<LoadedDeviceProfiles['knowledgeResources']> = {
    layouts: enabledPacks.flatMap((entry) => entry.knowledgeResources?.layouts ?? []),
    partPresets: enabledPacks.flatMap((entry) => entry.knowledgeResources?.partPresets ?? []),
    qualityRules: enabledPacks.flatMap((entry) => entry.knowledgeResources?.qualityRules ?? []),
    editableSchemas: enabledPacks.flatMap(
      (entry) => entry.knowledgeResources?.editableSchemas ?? [],
    ),
    aliases: enabledPacks.flatMap((entry) => entry.knowledgeResources?.aliases ?? []),
  }
  const importedProfiles = [
    ...(loaded[0]?.profiles ?? []),
    ...enabledPacks.flatMap((entry) => entry.profiles),
  ]
  const merged = mergeDeviceProfiles([
    loaded[1]?.profiles ?? [],
    importedProfiles,
    DEVICE_PROFILE_DEFINITIONS,
    loaded[2]?.profiles ?? [],
  ])
  return {
    profiles: merged.profiles,
    knowledgeResources: packResources,
    warnings: [
      ...loaded.flatMap((entry) => entry.warnings),
      ...enabledPacks.flatMap((entry) => entry.warnings),
      ...merged.warnings,
    ],
  }
}
