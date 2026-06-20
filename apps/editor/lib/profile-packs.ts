import fs from 'node:fs/promises'
import path from 'node:path'
import { inflateRawSync } from 'node:zlib'
import {
  type DeviceProfileDefinition,
  EDITABLE_SCHEMA_DEFINITIONS,
  type EditableSchemaDefinition,
  normalizeDeviceProfileInput,
  normalizeEditableSchemaInput,
  validateDeviceProfileDefinition,
} from '@pascal-app/core/lib/device-profile-registry'
import { exists, findRepoRoot, sanitizeSegment } from './generated-assets/manifest'

export type ProfilePackManifest = {
  id: string
  name: string
  industry: string
  version: string
  schemaVersion: string
  knowledgeSchemaVersion?: string
  appCompatibility?: string
  locale?: string[]
  description?: string
  profiles: string[]
  layouts?: string[]
  partPresets?: string[]
  qualityRules?: string[]
  editableSchemas?: string[]
  aliases?: string[]
  factoryArchitectures?: string[]
  processTemplates?: string[]
  equipmentContracts?: string[]
  catalogBindings?: string[]
  dependsOn?: ProfilePackDependency[]
}

export type ProfilePackDependency = {
  id: string
  version?: string
}

export type InstalledProfilePack = {
  id: string
  name: string
  industry: string
  version: string
  schemaVersion: string
  description?: string
  profileCount: number
  layoutCount?: number
  partPresetCount?: number
  qualityRuleCount?: number
  dependsOn?: ProfilePackDependency[]
  enabled: boolean
  path: string
  installedAt?: string
  dependedOnBy?: Array<{ id: string; version: string; path: string }>
}

export type CloudProfilePack = {
  id: string
  name: string
  industry: string
  version: string
  schemaVersion: string
  description?: string
  profileCount: number
  layoutCount?: number
  partPresetCount?: number
  qualityRuleCount?: number
  dependsOn?: ProfilePackDependency[]
  fileName: string
  source: 'local_simulated_cloud'
  installed: boolean
  enabled: boolean
  auditScore: number
  publishStatus: ProfilePackPublishStatus
  packType: ProfilePackType
  releaseChannel: ProfilePackReleaseChannel
  dependencyStatus: ProfilePackDependencyStatus
  governanceIssues: string[]
  governanceWarnings: string[]
}

export type ProfilePackPublishStatus = 'publishable' | 'needs_review' | 'blocked'
export type ProfilePackType = 'basic' | 'extension'
export type ProfilePackReleaseChannel = 'stable' | 'preview'
export type ProfilePackDependencyStatus = 'none' | 'satisfied' | 'missing'

export type CloudProfilePackCatalog = {
  packs: CloudProfilePack[]
  industries: Array<{
    id: string
    packCount: number
    profileCount: number
    publishableCount: number
    blockedCount: number
  }>
  summary: {
    packCount: number
    industryCount: number
    profileCount: number
    installedCount: number
    publishableCount: number
    needsReviewCount: number
    blockedCount: number
  }
  issues: string[]
  warnings: string[]
}

export type ProfilePackValidationResult = {
  manifest: ProfilePackManifest
  profiles: DeviceProfileDefinition[]
  resources: {
    layouts: Array<Record<string, unknown>>
    partPresets: Array<Record<string, unknown>>
    qualityRules: Array<Record<string, unknown>>
    editableSchemas: EditableSchemaDefinition[]
    aliases: Array<Record<string, unknown>>
  }
  warnings: string[]
}

export type ProfilePackAuditResult = {
  ok: boolean
  score: number
  issues: string[]
  warnings: string[]
  summary: {
    profileCount: number
    layoutCount: number
    partPresetCount: number
    qualityRuleCount: number
    editableSchemaCount: number
  }
}

type EnabledPackIndex = {
  enabledPacks: Array<{
    id: string
    version: string
    path: string
    enabled: boolean
    installedAt: string
  }>
}

type ZipEntry = {
  name: string
  bytes: Buffer
}

const MAX_PROFILE_PACK_BYTES = 8 * 1024 * 1024
const PACK_ID_PATTERN = /^industry\.[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

function isRecord(value: unknown): value is Record<string, unknown> {
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

function dependencyArray(value: unknown): ProfilePackDependency[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (typeof item === 'string' && item.trim()) return { id: item.trim() }
      if (!isRecord(item)) return undefined
      const id = stringValue(item.id)
      if (!id) return undefined
      return {
        id,
        ...(stringValue(item.version) ? { version: stringValue(item.version) } : {}),
      }
    })
    .filter((item): item is ProfilePackDependency => Boolean(item))
}

function versionSatisfies(version: string, requirement?: string) {
  const normalized = requirement?.trim()
  if (!normalized) return true
  if (normalized.startsWith('>=')) return compareSemver(version, normalized.slice(2).trim()) >= 0
  if (normalized.startsWith('=')) return version === normalized.slice(1).trim()
  return version === normalized
}

function compareSemver(left: string, right: string) {
  const l = left.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const r = right.split('.').map((part) => Number.parseInt(part, 10) || 0)
  for (let i = 0; i < Math.max(l.length, r.length); i += 1) {
    const delta = (l[i] ?? 0) - (r[i] ?? 0)
    if (delta !== 0) return delta
  }
  return 0
}

export function normalizeProfilePackManifest(value: unknown): ProfilePackManifest {
  if (!isRecord(value)) throw new Error('pack.json must be an object.')
  const id = stringValue(value.id)
  const name = stringValue(value.name)
  const industry = stringValue(value.industry)
  const version = stringValue(value.version)
  const schemaVersion = stringValue(value.schemaVersion)
  const profiles = stringArray(value.profiles)
  if (!id) throw new Error('pack.json id is required.')
  if (!name) throw new Error('pack.json name is required.')
  if (!industry) throw new Error('pack.json industry is required.')
  if (!version) throw new Error('pack.json version is required.')
  if (!schemaVersion) throw new Error('pack.json schemaVersion is required.')
  if (profiles.length === 0) throw new Error('pack.json profiles must be a non-empty array.')
  return {
    id,
    name,
    industry,
    version,
    schemaVersion,
    ...(stringValue(value.knowledgeSchemaVersion)
      ? { knowledgeSchemaVersion: stringValue(value.knowledgeSchemaVersion) }
      : {}),
    ...(stringValue(value.appCompatibility)
      ? { appCompatibility: stringValue(value.appCompatibility) }
      : {}),
    ...(stringArray(value.locale).length > 0 ? { locale: stringArray(value.locale) } : {}),
    ...(stringValue(value.description) ? { description: stringValue(value.description) } : {}),
    profiles,
    ...(stringArray(value.layouts).length > 0 ? { layouts: stringArray(value.layouts) } : {}),
    ...(stringArray(value.partPresets).length > 0
      ? { partPresets: stringArray(value.partPresets) }
      : {}),
    ...(stringArray(value.qualityRules).length > 0
      ? { qualityRules: stringArray(value.qualityRules) }
      : {}),
    ...(stringArray(value.editableSchemas).length > 0
      ? { editableSchemas: stringArray(value.editableSchemas) }
      : {}),
    ...(stringArray(value.aliases).length > 0 ? { aliases: stringArray(value.aliases) } : {}),
    ...(stringArray(value.factoryArchitectures).length > 0
      ? { factoryArchitectures: stringArray(value.factoryArchitectures) }
      : {}),
    ...(stringArray(value.processTemplates).length > 0
      ? { processTemplates: stringArray(value.processTemplates) }
      : {}),
    ...(stringArray(value.equipmentContracts).length > 0
      ? { equipmentContracts: stringArray(value.equipmentContracts) }
      : {}),
    ...(stringArray(value.catalogBindings).length > 0
      ? { catalogBindings: stringArray(value.catalogBindings) }
      : {}),
    ...(dependencyArray(value.dependsOn).length > 0
      ? { dependsOn: dependencyArray(value.dependsOn) }
      : {}),
  }
}

export function isSafeProfilePackPath(value: string) {
  const normalized = value.replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) return false
  return normalized.split('/').every((segment) => segment && segment !== '.' && segment !== '..')
}

function safeInstallDirName(manifest: ProfilePackManifest) {
  const id = sanitizeSegment(manifest.id, 'profile-pack')
  const version = sanitizeSegment(manifest.version, '0.0.0')
  return `${id}@${version}`
}

export function profilePackStoreRoot(repoRoot: string) {
  return path.join(repoRoot, 'apps', 'editor', '.local', 'device-profile-packs')
}

export function profilePackIndexPath(repoRoot: string) {
  return path.join(profilePackStoreRoot(repoRoot), 'enabled-packs.json')
}

export function simulatedProfilePackCloudRoot(repoRoot: string) {
  return path.join(repoRoot, 'apps', 'editor', 'data', 'profile-pack-cloud')
}

async function readEnabledPackIndex(repoRoot: string): Promise<EnabledPackIndex> {
  try {
    const parsed = JSON.parse(await fs.readFile(profilePackIndexPath(repoRoot), 'utf8'))
    if (!isRecord(parsed) || !Array.isArray(parsed.enabledPacks)) return { enabledPacks: [] }
    return {
      enabledPacks: parsed.enabledPacks.filter(isRecord).map((entry) => ({
        id: stringValue(entry.id) ?? '',
        version: stringValue(entry.version) ?? '',
        path: stringValue(entry.path) ?? '',
        enabled: entry.enabled !== false,
        installedAt: stringValue(entry.installedAt) ?? new Date(0).toISOString(),
      })),
    }
  } catch {
    return { enabledPacks: [] }
  }
}

async function writeEnabledPackIndex(repoRoot: string, index: EnabledPackIndex) {
  const file = profilePackIndexPath(repoRoot)
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
  await fs.rename(tmp, file)
}

function zipEntries(buffer: Buffer): ZipEntry[] {
  if (buffer.length > MAX_PROFILE_PACK_BYTES) throw new Error('Profile pack zip is too large.')
  let eocdOffset = -1
  for (
    let offset = buffer.length - 22;
    offset >= Math.max(0, buffer.length - 65_557);
    offset -= 1
  ) {
    if (buffer.readUInt32LE(offset) === 0x0605_4b50) {
      eocdOffset = offset
      break
    }
  }
  if (eocdOffset < 0) throw new Error('Invalid zip: end of central directory not found.')
  const entryCount = buffer.readUInt16LE(eocdOffset + 10)
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16)
  const entries: ZipEntry[] = []
  let cursor = centralDirectoryOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x0201_4b50) {
      throw new Error('Invalid zip: central directory entry is corrupt.')
    }
    const method = buffer.readUInt16LE(cursor + 10)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const uncompressedSize = buffer.readUInt32LE(cursor + 24)
    const fileNameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer
      .subarray(cursor + 46, cursor + 46 + fileNameLength)
      .toString('utf8')
      .replace(/\\/g, '/')
    cursor += 46 + fileNameLength + extraLength + commentLength
    if (!name || name.endsWith('/')) continue
    if (!isSafeProfilePackPath(name)) throw new Error(`Unsafe zip entry path: ${name}`)
    if (buffer.readUInt32LE(localHeaderOffset) !== 0x0403_4b50) {
      throw new Error(`Invalid zip: local header missing for ${name}.`)
    }
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28)
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize)
    let bytes: Buffer
    if (method === 0) {
      bytes = Buffer.from(compressed)
    } else if (method === 8) {
      bytes = Buffer.from(inflateRawSync(compressed))
    } else {
      throw new Error(`Unsupported zip compression method ${method} for ${name}.`)
    }
    if (bytes.length !== uncompressedSize) {
      throw new Error(`Invalid zip entry size for ${name}.`)
    }
    entries.push({ name, bytes })
  }
  return entries
}

function profilePayload(raw: Record<string, unknown>): Record<string, unknown> {
  if (typeof raw.id === 'string') return raw
  if (isRecord(raw.profile)) return raw.profile
  if (isRecord(raw.draftProfile)) return raw.draftProfile
  return raw
}

function parseProfileJson(bytes: Buffer, fileName: string) {
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to parse ${fileName}: ${message}`)
  }
}

function resourceArray(raw: unknown, fileName: string): Array<Record<string, unknown>> {
  const values = Array.isArray(raw) ? raw : [raw]
  return values.map((value, index) => {
    if (!isRecord(value)) {
      throw new Error(`Resource ${fileName}[${index}] must be an object.`)
    }
    return value
  })
}

function withPackMetadata(
  profile: DeviceProfileDefinition,
  manifest: ProfilePackManifest,
): DeviceProfileDefinition {
  return {
    ...profile,
    industry: profile.industry ?? manifest.industry,
    sourcePack: {
      id: manifest.id,
      version: manifest.version,
      industry: manifest.industry,
    },
  }
}

function resourceId(value: Record<string, unknown>) {
  return stringValue(value.id)
}

function resourceIds(resources: Array<Record<string, unknown>>) {
  return new Set(resources.map(resourceId).filter((id): id is string => Boolean(id)))
}

function duplicateIds(values: readonly string[]) {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }
  return [...duplicates]
}

function ruleReferenceId(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value.trim()
  return isRecord(value) ? stringValue(value.id) : undefined
}

function qualityRuleRequiredRoles(value: unknown): string[] {
  if (!isRecord(value)) return []
  return stringArray(value.requiredRoles)
}

export function auditProfilePackValidation(
  validation: ProfilePackValidationResult,
): ProfilePackAuditResult {
  const issues: string[] = []
  const warnings = [...validation.warnings]
  const { manifest, profiles, resources } = validation

  if (!PACK_ID_PATTERN.test(manifest.id)) {
    issues.push(`pack.json id "${manifest.id}" should match industry.{industry}.{basic|extension}.`)
  }
  if (!SEMVER_PATTERN.test(manifest.version)) {
    issues.push(`pack.json version "${manifest.version}" must be semver.`)
  }
  if (manifest.schemaVersion !== '1.1') {
    warnings.push(`pack.json schemaVersion "${manifest.schemaVersion}" is not the current 1.1.`)
  }
  if (!manifest.description?.trim()) {
    warnings.push('pack.json description is recommended for cloud publishing.')
  }
  if (!manifest.locale?.length) {
    warnings.push('pack.json locale is recommended for cloud publishing.')
  }

  const profileIds = profiles.map((profile) => profile.id)
  for (const duplicate of duplicateIds(profileIds)) {
    issues.push(`Duplicate profile id "${duplicate}" in package.`)
  }

  const layoutResourceIds = resources.layouts
    .map(resourceId)
    .filter((id): id is string => Boolean(id))
  const partPresetResourceIds = resources.partPresets
    .map(resourceId)
    .filter((id): id is string => Boolean(id))
  const qualityRuleResourceIds = resources.qualityRules
    .map(resourceId)
    .filter((id): id is string => Boolean(id))
  const layoutIds = new Set(layoutResourceIds)
  const partPresetIds = new Set(partPresetResourceIds)
  const qualityRuleIds = new Set(qualityRuleResourceIds)
  const editableSchemaIds = new Set([
    ...resources.editableSchemas.map((schema) => schema.id),
    ...EDITABLE_SCHEMA_DEFINITIONS.map((schema) => schema.id),
  ])

  for (const [kind, values] of [
    ['layout', layoutResourceIds],
    ['part preset', partPresetResourceIds],
    ['quality rule', qualityRuleResourceIds],
    ['editable schema', resources.editableSchemas.map((schema) => schema.id)],
  ] as const) {
    for (const duplicate of duplicateIds(values)) {
      issues.push(`Duplicate ${kind} id "${duplicate}" in package.`)
    }
  }

  for (const profile of profiles) {
    if (!profile.aliases.length) {
      warnings.push(`Profile ${profile.id} should declare aliases for inference.`)
    }
    if (profile.industry && profile.industry !== manifest.industry) {
      warnings.push(
        `Profile ${profile.id} industry "${profile.industry}" differs from package industry "${manifest.industry}".`,
      )
    }
    if (profile.layoutTemplate && !layoutIds.has(profile.layoutTemplate)) {
      issues.push(
        `Profile ${profile.id} references missing layoutTemplate "${profile.layoutTemplate}".`,
      )
    }
    if (profile.editableSchemaRef && !editableSchemaIds.has(profile.editableSchemaRef)) {
      issues.push(
        `Profile ${profile.id} references missing editableSchemaRef "${profile.editableSchemaRef}".`,
      )
    }
    if (profile.partPresets) {
      for (const [role, presetId] of Object.entries(profile.partPresets)) {
        if (!partPresetIds.has(presetId)) {
          issues.push(
            `Profile ${profile.id} partPresets.${role} references missing preset "${presetId}".`,
          )
        }
      }
    }

    const qualityRuleId = ruleReferenceId(profile.qualityRules)
    const qualityRule = qualityRuleId
      ? resources.qualityRules.find((rule) => resourceId(rule) === qualityRuleId)
      : undefined
    if (!qualityRuleId) {
      issues.push(`Stable profile ${profile.id} must reference qualityRules.`)
    } else if (!qualityRuleIds.has(qualityRuleId)) {
      issues.push(`Profile ${profile.id} references missing qualityRules "${qualityRuleId}".`)
    } else {
      const requiredRoles = qualityRuleRequiredRoles(qualityRule)
      if (!requiredRoles.length) {
        warnings.push(`Quality rule ${qualityRuleId} should declare requiredRoles.`)
      } else if (!requiredRoles.includes(profile.primarySemanticRole)) {
        warnings.push(
          `Quality rule ${qualityRuleId} does not explicitly include primarySemanticRole "${profile.primarySemanticRole}".`,
        )
      }
    }
  }

  const maxDeductions = Math.min(0.95, issues.length * 0.12 + warnings.length * 0.025)
  return {
    ok: issues.length === 0,
    score: Math.max(0, Number((1 - maxDeductions).toFixed(3))),
    issues,
    warnings,
    summary: {
      profileCount: profiles.length,
      layoutCount: resources.layouts.length,
      partPresetCount: resources.partPresets.length,
      qualityRuleCount: resources.qualityRules.length,
      editableSchemaCount: resources.editableSchemas.length,
    },
  }
}

async function loadPackResourcesFromDir(
  dir: string,
  manifest: ProfilePackManifest,
): Promise<ProfilePackValidationResult['resources']> {
  const resources: ProfilePackValidationResult['resources'] = {
    layouts: [],
    partPresets: [],
    qualityRules: [],
    editableSchemas: [],
    aliases: [],
  }
  const groups = [
    ['layouts', manifest.layouts ?? []],
    ['partPresets', manifest.partPresets ?? []],
    ['qualityRules', manifest.qualityRules ?? []],
    ['editableSchemas', manifest.editableSchemas ?? []],
    ['aliases', manifest.aliases ?? []],
  ] as const
  const resolvedDir = path.resolve(dir)
  for (const [key, files] of groups) {
    for (const rel of files) {
      if (!isSafeProfilePackPath(rel)) throw new Error(`Unsafe resource path in manifest: ${rel}`)
      const file = path.resolve(dir, rel)
      if (!(file === resolvedDir || file.startsWith(`${resolvedDir}${path.sep}`))) {
        throw new Error(`Resource path escapes pack directory: ${rel}`)
      }
      const records = resourceArray(parseProfileJson(await fs.readFile(file), rel), rel)
      if (key === 'editableSchemas') {
        for (const record of records) {
          const schema = normalizeEditableSchemaInput(record)
          if (!schema) throw new Error(`Invalid editable schema resource: ${rel}`)
          resources.editableSchemas.push(schema)
        }
      } else {
        resources[key].push(...records)
      }
    }
  }
  return resources
}

function loadPackResourcesFromZip(
  entryMap: Map<string, Buffer>,
  manifest: ProfilePackManifest,
): ProfilePackValidationResult['resources'] {
  const resources: ProfilePackValidationResult['resources'] = {
    layouts: [],
    partPresets: [],
    qualityRules: [],
    editableSchemas: [],
    aliases: [],
  }
  const groups = [
    ['layouts', manifest.layouts ?? []],
    ['partPresets', manifest.partPresets ?? []],
    ['qualityRules', manifest.qualityRules ?? []],
    ['editableSchemas', manifest.editableSchemas ?? []],
    ['aliases', manifest.aliases ?? []],
  ] as const
  for (const [key, files] of groups) {
    for (const rel of files) {
      if (!isSafeProfilePackPath(rel)) throw new Error(`Unsafe resource path in manifest: ${rel}`)
      const bytes = entryMap.get(rel)
      if (!bytes) throw new Error(`Resource file listed in manifest is missing: ${rel}`)
      const records = resourceArray(parseProfileJson(bytes, rel), rel)
      if (key === 'editableSchemas') {
        for (const record of records) {
          const schema = normalizeEditableSchemaInput(record)
          if (!schema) throw new Error(`Invalid editable schema resource: ${rel}`)
          resources.editableSchemas.push(schema)
        }
      } else {
        resources[key].push(...records)
      }
    }
  }
  return resources
}

export async function validateProfilePackDir(dir: string): Promise<ProfilePackValidationResult> {
  const manifest = normalizeProfilePackManifest(
    JSON.parse(await fs.readFile(path.join(dir, 'pack.json'), 'utf8')),
  )
  const warnings: string[] = []
  const profiles: DeviceProfileDefinition[] = []
  const resources = await loadPackResourcesFromDir(dir, manifest)
  for (const rel of manifest.profiles) {
    if (!isSafeProfilePackPath(rel)) throw new Error(`Unsafe profile path in manifest: ${rel}`)
    const file = path.resolve(dir, rel)
    const resolvedDir = path.resolve(dir)
    if (!(file === resolvedDir || file.startsWith(`${resolvedDir}${path.sep}`))) {
      throw new Error(`Profile path escapes pack directory: ${rel}`)
    }
    const parsed = parseProfileJson(await fs.readFile(file), rel)
    const rawProfiles = Array.isArray(parsed) ? parsed : [parsed]
    for (const raw of rawProfiles) {
      if (!isRecord(raw)) {
        warnings.push(`Ignored non-object profile in ${rel}.`)
        continue
      }
      const profile = withPackMetadata(
        normalizeDeviceProfileInput(profilePayload(raw), 'imported_pack', 'stable'),
        manifest,
      )
      const validation = validateDeviceProfileDefinition(profile)
      if (!validation.ok) {
        throw new Error(`Invalid profile ${profile.id}: ${validation.issues.join('; ')}`)
      }
      warnings.push(...validation.warnings.map((warning) => `${rel}: ${warning}`))
      profiles.push(profile)
    }
  }
  return { manifest, profiles, resources, warnings }
}

export function validateProfilePackZip(buffer: Buffer): ProfilePackValidationResult {
  const entries = zipEntries(buffer)
  const entryMap = new Map(entries.map((entry) => [entry.name, entry.bytes]))
  const manifestBytes = entryMap.get('pack.json')
  if (!manifestBytes) throw new Error('pack.json is missing from the zip root.')
  const manifest = normalizeProfilePackManifest(parseProfileJson(manifestBytes, 'pack.json'))
  const warnings: string[] = []
  const profiles: DeviceProfileDefinition[] = []
  const resources = loadPackResourcesFromZip(entryMap, manifest)
  for (const rel of manifest.profiles) {
    if (!isSafeProfilePackPath(rel)) throw new Error(`Unsafe profile path in manifest: ${rel}`)
    const bytes = entryMap.get(rel)
    if (!bytes) throw new Error(`Profile file listed in manifest is missing: ${rel}`)
    const parsed = parseProfileJson(bytes, rel)
    const rawProfiles = Array.isArray(parsed) ? parsed : [parsed]
    for (const raw of rawProfiles) {
      if (!isRecord(raw)) {
        warnings.push(`Ignored non-object profile in ${rel}.`)
        continue
      }
      const profile = withPackMetadata(
        normalizeDeviceProfileInput(profilePayload(raw), 'imported_pack', 'stable'),
        manifest,
      )
      const validation = validateDeviceProfileDefinition(profile)
      if (!validation.ok) {
        throw new Error(`Invalid profile ${profile.id}: ${validation.issues.join('; ')}`)
      }
      warnings.push(...validation.warnings.map((warning) => `${rel}: ${warning}`))
      profiles.push(profile)
    }
  }
  return { manifest, profiles, resources, warnings }
}

export async function installProfilePackZip(buffer: Buffer) {
  const repoRoot = await findRepoRoot()
  const validation = validateProfilePackZip(buffer)
  const entries = zipEntries(buffer)
  const installDirName = safeInstallDirName(validation.manifest)
  const storeRoot = profilePackStoreRoot(repoRoot)
  const installDir = path.join(storeRoot, installDirName)
  await fs.rm(installDir, { recursive: true, force: true })
  await fs.mkdir(installDir, { recursive: true })
  for (const entry of entries) {
    if (!isSafeProfilePackPath(entry.name)) throw new Error(`Unsafe zip entry path: ${entry.name}`)
    const target = path.resolve(installDir, entry.name)
    if (!target.startsWith(`${path.resolve(installDir)}${path.sep}`)) {
      throw new Error(`Zip entry escapes install directory: ${entry.name}`)
    }
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, entry.bytes)
  }

  const index = await readEnabledPackIndex(repoRoot)
  const installedAt = new Date().toISOString()
  const nextEntry = {
    id: validation.manifest.id,
    version: validation.manifest.version,
    path: installDirName,
    enabled: true,
    installedAt,
  }
  await writeEnabledPackIndex(repoRoot, {
    enabledPacks: [
      nextEntry,
      ...index.enabledPacks.filter(
        (entry) => !(entry.id === nextEntry.id && entry.version === nextEntry.version),
      ),
    ],
  })

  return {
    pack: {
      id: validation.manifest.id,
      name: validation.manifest.name,
      industry: validation.manifest.industry,
      version: validation.manifest.version,
      schemaVersion: validation.manifest.schemaVersion,
      description: validation.manifest.description,
      profileCount: validation.profiles.length,
      layoutCount: validation.resources.layouts.length,
      partPresetCount: validation.resources.partPresets.length,
      qualityRuleCount: validation.resources.qualityRules.length,
      dependsOn: validation.manifest.dependsOn,
      enabled: true,
      path: installDirName,
      installedAt,
    } satisfies InstalledProfilePack,
    warnings: validation.warnings,
  }
}

function profilePackType(manifest: ProfilePackManifest): ProfilePackType {
  return manifest.dependsOn?.length ? 'extension' : 'basic'
}

function releaseChannel(version: string): ProfilePackReleaseChannel {
  return version.includes('-') ? 'preview' : 'stable'
}

function publishStatusFromGovernance(
  audit: ProfilePackAuditResult,
  dependencyIssues: readonly string[],
): ProfilePackPublishStatus {
  if (!audit.ok || dependencyIssues.length > 0) return 'blocked'
  return audit.score >= 0.85 ? 'publishable' : 'needs_review'
}

export async function listCloudProfilePacks(): Promise<CloudProfilePack[]> {
  const repoRoot = await findRepoRoot()
  const cloudRoot = simulatedProfilePackCloudRoot(repoRoot)
  const installed = await listInstalledProfilePacks()
  const installedByIdVersion = new Map(
    installed.map((pack) => [`${pack.id}@${pack.version}`, pack]),
  )
  if (!(await exists(cloudRoot))) return []
  const entries = await fs.readdir(cloudRoot, { withFileTypes: true })
  const packs: CloudProfilePack[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.zip')) continue
    try {
      const zipPath = path.join(cloudRoot, entry.name)
      const validation = validateProfilePackZip(await fs.readFile(zipPath))
      const audit = auditProfilePackValidation(validation)
      const installedPack = installedByIdVersion.get(
        `${validation.manifest.id}@${validation.manifest.version}`,
      )
      packs.push({
        id: validation.manifest.id,
        name: validation.manifest.name,
        industry: validation.manifest.industry,
        version: validation.manifest.version,
        schemaVersion: validation.manifest.schemaVersion,
        description: validation.manifest.description,
        profileCount: validation.profiles.length,
        layoutCount: validation.resources.layouts.length,
        partPresetCount: validation.resources.partPresets.length,
        qualityRuleCount: validation.resources.qualityRules.length,
        dependsOn: validation.manifest.dependsOn,
        fileName: entry.name,
        source: 'local_simulated_cloud',
        installed: Boolean(installedPack),
        enabled: installedPack?.enabled === true,
        auditScore: audit.score,
        publishStatus: publishStatusFromGovernance(audit, []),
        packType: profilePackType(validation.manifest),
        releaseChannel: releaseChannel(validation.manifest.version),
        dependencyStatus: validation.manifest.dependsOn?.length ? 'missing' : 'none',
        governanceIssues: audit.issues,
        governanceWarnings: audit.warnings,
      })
    } catch {}
  }
  for (const pack of packs) {
    const dependencyIssues: string[] = []
    for (const dependency of pack.dependsOn ?? []) {
      if (!matchingDependencyPack(packs, dependency)) {
        dependencyIssues.push(
          `Missing dependency ${dependency.id}${dependency.version ? ` ${dependency.version}` : ''}.`,
        )
      }
    }
    pack.dependencyStatus =
      (pack.dependsOn ?? []).length === 0
        ? 'none'
        : dependencyIssues.length === 0
          ? 'satisfied'
          : 'missing'
    pack.governanceIssues = [...pack.governanceIssues, ...dependencyIssues]
    pack.publishStatus = publishStatusFromGovernance(
      {
        ok: pack.governanceIssues.length === 0,
        score: pack.auditScore,
        issues: pack.governanceIssues,
        warnings: pack.governanceWarnings,
        summary: {
          profileCount: pack.profileCount,
          layoutCount: pack.layoutCount ?? 0,
          partPresetCount: pack.partPresetCount ?? 0,
          qualityRuleCount: pack.qualityRuleCount ?? 0,
          editableSchemaCount: 0,
        },
      },
      dependencyIssues,
    )
  }
  return packs.sort((left, right) => left.name.localeCompare(right.name))
}

function matchingDependencyPack(
  packs: CloudProfilePack[],
  dependency: ProfilePackDependency,
): CloudProfilePack | undefined {
  return packs
    .filter(
      (pack) => pack.id === dependency.id && versionSatisfies(pack.version, dependency.version),
    )
    .sort((left, right) => compareSemver(right.version, left.version))[0]
}

export async function listCloudProfilePackCatalog(): Promise<CloudProfilePackCatalog> {
  const repoRoot = await findRepoRoot()
  const cloudRoot = simulatedProfilePackCloudRoot(repoRoot)
  const packs = await listCloudProfilePacks()
  const issues: string[] = []
  const warnings: string[] = []

  if (await exists(cloudRoot)) {
    const entries = await fs.readdir(cloudRoot, { withFileTypes: true })
    const zipNames = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name))
    const sourceDirs = new Map<string, ProfilePackManifest>()

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const manifestPath = path.join(cloudRoot, entry.name, 'pack.json')
      if (!(await exists(manifestPath))) continue
      try {
        const manifest = normalizeProfilePackManifest(
          parseProfileJson(await fs.readFile(manifestPath), `${entry.name}/pack.json`),
        )
        sourceDirs.set(`${manifest.id}@${manifest.version}`, manifest)
        const expectedZip = `${manifest.id}-${manifest.version}.zip`
        if (!zipNames.has(expectedZip)) {
          warnings.push(
            `Source package ${manifest.id}@${manifest.version} has no matching ${expectedZip}.`,
          )
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        issues.push(`Invalid source package ${entry.name}: ${message}`)
      }
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.zip')) continue
      try {
        const validation = validateProfilePackZip(
          await fs.readFile(path.join(cloudRoot, entry.name)),
        )
        if (!sourceDirs.has(`${validation.manifest.id}@${validation.manifest.version}`)) {
          warnings.push(
            `Cloud zip ${entry.name} has no matching source directory for ${validation.manifest.id}@${validation.manifest.version}.`,
          )
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        issues.push(`Invalid cloud zip ${entry.name}: ${message}`)
      }
    }
  }

  const industryMap = new Map<string, CloudProfilePackCatalog['industries'][number]>()
  for (const pack of packs) {
    const current = industryMap.get(pack.industry) ?? {
      id: pack.industry,
      packCount: 0,
      profileCount: 0,
      publishableCount: 0,
      blockedCount: 0,
    }
    current.packCount += 1
    current.profileCount += pack.profileCount
    if (pack.publishStatus === 'publishable') current.publishableCount += 1
    if (pack.publishStatus === 'blocked') current.blockedCount += 1
    industryMap.set(pack.industry, current)
  }
  const industries = [...industryMap.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  )

  return {
    packs,
    industries,
    summary: {
      packCount: packs.length,
      industryCount: industries.length,
      profileCount: packs.reduce((sum, pack) => sum + pack.profileCount, 0),
      installedCount: packs.filter((pack) => pack.installed).length,
      publishableCount: packs.filter((pack) => pack.publishStatus === 'publishable').length,
      needsReviewCount: packs.filter((pack) => pack.publishStatus === 'needs_review').length,
      blockedCount: packs.filter((pack) => pack.publishStatus === 'blocked').length,
    },
    issues,
    warnings,
  }
}

async function installCloudProfilePackInternal(
  id: string,
  version: string | undefined,
  installing: Set<string>,
): Promise<
  Awaited<ReturnType<typeof installProfilePackZip>> & {
    installedDependencies: InstalledProfilePack[]
  }
> {
  const repoRoot = await findRepoRoot()
  const cloudRoot = simulatedProfilePackCloudRoot(repoRoot)
  const packs = await listCloudProfilePacks()
  const pack = packs.find(
    (candidate) => candidate.id === id && (version == null || candidate.version === version),
  )
  if (!pack) throw new Error('Cloud profile pack not found.')
  if (pack.publishStatus === 'blocked') {
    throw new Error(
      `Cloud profile pack is blocked by governance checks: ${pack.governanceIssues.join('; ')}`,
    )
  }
  const installKey = `${pack.id}@${pack.version}`
  if (installing.has(installKey)) {
    throw new Error(`Profile pack dependency cycle detected at ${installKey}.`)
  }
  installing.add(installKey)
  try {
    const installedDependencies: InstalledProfilePack[] = []
    for (const dependency of pack.dependsOn ?? []) {
      const dependencyPack = matchingDependencyPack(packs, dependency)
      if (!dependencyPack) {
        throw new Error(
          `Required profile pack dependency not found: ${dependency.id}${dependency.version ? ` ${dependency.version}` : ''}.`,
        )
      }
      const installed = await installCloudProfilePackInternal(
        dependencyPack.id,
        dependencyPack.version,
        installing,
      )
      installedDependencies.push(...installed.installedDependencies, installed.pack)
    }
    if (!isSafeProfilePackPath(pack.fileName) || !pack.fileName.endsWith('.zip')) {
      throw new Error('Invalid cloud profile pack filename.')
    }
    const zipPath = path.resolve(cloudRoot, pack.fileName)
    if (!zipPath.startsWith(`${path.resolve(cloudRoot)}${path.sep}`)) {
      throw new Error('Cloud profile pack path escapes cloud root.')
    }
    const result = await installProfilePackZip(await fs.readFile(zipPath))
    return { ...result, installedDependencies }
  } finally {
    installing.delete(installKey)
  }
}

export async function installCloudProfilePack(id: string, version?: string) {
  return installCloudProfilePackInternal(id, version, new Set())
}

export async function listInstalledProfilePacks(): Promise<InstalledProfilePack[]> {
  const repoRoot = await findRepoRoot()
  const storeRoot = profilePackStoreRoot(repoRoot)
  if (!(await exists(storeRoot))) return []
  const index = await readEnabledPackIndex(repoRoot)
  const enabledByPath = new Map(index.enabledPacks.map((entry) => [entry.path, entry]))
  const entries = await fs.readdir(storeRoot, { withFileTypes: true })
  const packs: InstalledProfilePack[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = path.join(storeRoot, entry.name)
    const manifestPath = path.join(dir, 'pack.json')
    if (!(await exists(manifestPath))) continue
    try {
      const validation = await validateProfilePackDir(dir)
      const enabledEntry = enabledByPath.get(entry.name)
      packs.push({
        id: validation.manifest.id,
        name: validation.manifest.name,
        industry: validation.manifest.industry,
        version: validation.manifest.version,
        schemaVersion: validation.manifest.schemaVersion,
        description: validation.manifest.description,
        profileCount: validation.profiles.length,
        layoutCount: validation.resources.layouts.length,
        partPresetCount: validation.resources.partPresets.length,
        qualityRuleCount: validation.resources.qualityRules.length,
        dependsOn: validation.manifest.dependsOn,
        enabled: enabledEntry?.enabled !== false,
        path: entry.name,
        installedAt: enabledEntry?.installedAt,
      })
    } catch {}
  }
  for (const pack of packs) {
    pack.dependedOnBy = packs
      .filter((candidate) =>
        (candidate.dependsOn ?? []).some(
          (dependency) =>
            dependency.id === pack.id && versionSatisfies(pack.version, dependency.version),
        ),
      )
      .map((candidate) => ({
        id: candidate.id,
        version: candidate.version,
        path: candidate.path,
      }))
  }
  return packs.sort((left, right) => left.name.localeCompare(right.name))
}

export async function enabledProfilePackDirs(): Promise<string[]> {
  const repoRoot = await findRepoRoot()
  const storeRoot = profilePackStoreRoot(repoRoot)
  const packs = await listInstalledProfilePacks()
  return packs.filter((pack) => pack.enabled).map((pack) => path.join(storeRoot, pack.path))
}

export async function setProfilePackEnabled(packPath: string, enabled: boolean) {
  if (!isSafeProfilePackPath(packPath)) throw new Error('Invalid pack path.')
  const repoRoot = await findRepoRoot()
  const packs = await listInstalledProfilePacks()
  const pack = packs.find((candidate) => candidate.path === packPath)
  if (!pack) throw new Error('Profile pack not found.')
  if (!enabled) {
    const enabledDependents = (pack.dependedOnBy ?? [])
      .map((dependent) => packs.find((candidate) => candidate.path === dependent.path))
      .filter((dependent): dependent is InstalledProfilePack => Boolean(dependent?.enabled))
    if (enabledDependents.length > 0) {
      throw new Error(
        `Profile pack is required by enabled pack(s): ${enabledDependents
          .map((dependent) => dependent.name)
          .join(', ')}.`,
      )
    }
  }
  const index = await readEnabledPackIndex(repoRoot)
  const installedAt = pack.installedAt ?? new Date().toISOString()
  await writeEnabledPackIndex(repoRoot, {
    enabledPacks: [
      {
        id: pack.id,
        version: pack.version,
        path: pack.path,
        enabled,
        installedAt,
      },
      ...index.enabledPacks.filter((entry) => entry.path !== pack.path),
    ],
  })
  return { ...pack, enabled, installedAt }
}

export async function removeProfilePack(packPath: string) {
  if (!isSafeProfilePackPath(packPath)) throw new Error('Invalid pack path.')
  const repoRoot = await findRepoRoot()
  const packs = await listInstalledProfilePacks()
  const pack = packs.find((candidate) => candidate.path === packPath)
  if (!pack) throw new Error('Profile pack not found.')
  const enabledDependents = (pack.dependedOnBy ?? [])
    .map((dependent) => packs.find((candidate) => candidate.path === dependent.path))
    .filter((dependent): dependent is InstalledProfilePack => Boolean(dependent?.enabled))
  if (enabledDependents.length > 0) {
    throw new Error(
      `Profile pack is required by enabled pack(s): ${enabledDependents
        .map((dependent) => dependent.name)
        .join(', ')}.`,
    )
  }
  const storeRoot = profilePackStoreRoot(repoRoot)
  const target = path.resolve(storeRoot, packPath)
  if (!target.startsWith(`${path.resolve(storeRoot)}${path.sep}`)) {
    throw new Error('Profile pack path escapes store root.')
  }
  await fs.rm(target, { recursive: true, force: true })
  const index = await readEnabledPackIndex(repoRoot)
  await writeEnabledPackIndex(repoRoot, {
    enabledPacks: index.enabledPacks.filter((entry) => entry.path !== packPath),
  })
}
