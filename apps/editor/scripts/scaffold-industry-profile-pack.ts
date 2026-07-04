import fs from 'node:fs/promises'
import path from 'node:path'
import { loadPlugin, semanticRecipeRegistry } from '@pascal-app/core'
import { factoryEquipmentPlugin } from '@pascal-app/plugin-factory-equipment'
import { findRepoRoot } from '../lib/generated-assets/manifest'
import {
  annotateProcessTemplatesForV2,
  FACTORY_EQUIPMENT_PLUGIN_ID,
  inferEquipmentBindingsForProfiles,
  withDefaultV2ProfileFields,
} from '../lib/industry-pack-v2-migration'
import {
  auditProfilePackValidation,
  type ProfilePackDependency,
  simulatedProfilePackCloudRoot,
  validateProfilePackDir,
} from '../lib/profile-packs'

type JsonRecord = Record<string, unknown>

export type IndustryPackDeviceSpec = {
  id: string
  name: string
  aliases: string[]
  description?: string
  family?: string
  layoutFamily?: string
  archetypeFamily?: string
  recipeId?: string
  preferredResolver?: 'catalog-item' | 'native-box' | 'native-tank' | 'primitive' | 'profile-parts'
  defaultDimensions?: Record<string, number>
  processPorts?: JsonRecord[]
  equipmentDefaults?: JsonRecord
  recipeParams?: JsonRecord
  parts: Array<JsonRecord & { kind: string; semanticRole: string; required?: boolean }>
  primarySemanticRole: string
  visualCues?: string[]
  forbiddenRoles?: string[]
  shapeCount?: { min?: number; max?: number }
  qualityRuleId?: string
  qualityRequiredRoles?: string[]
}

export type IndustryPackSpec = {
  id?: string
  name?: string
  industry: string
  version?: string
  schemaVersion?: string
  knowledgeSchemaVersion?: string
  appCompatibility?: string
  locale?: string[]
  capabilities?: Array<'factory_creation'>
  description?: string
  dependsOn?: ProfilePackDependency[]
  dependsOnPlugins?: string[]
  devices: IndustryPackDeviceSpec[]
  factoryArchitectures?: JsonRecord[]
  processTemplates?: JsonRecord[]
}

export type IndustryPackAuthoringWarning = {
  deviceId: string
  code: string
  message: string
}

export type ScaffoldIndustryPackOptions = {
  specPath: string
  outputRoot?: string
  force?: boolean
  validate?: boolean
  writeZip?: boolean
}

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

function slug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function profileId(value: string, industry: string) {
  const normalized = slug(value).replace(/-/g, '_')
  return normalized.includes('.')
    ? normalized
    : `${slug(industry).replace(/-/g, '_')}.${normalized}`
}

function packId(industry: string, explicit?: string) {
  return explicit?.trim() || `industry.${slug(industry)}.basic`
}

function qualityRuleId(profileIdValue: string, explicit?: string) {
  return explicit?.trim() || `quality.${profileIdValue}`
}

function preferredResolver(
  value: unknown,
): IndustryPackDeviceSpec['preferredResolver'] | undefined {
  return value === 'catalog-item' ||
    value === 'native-box' ||
    value === 'native-tank' ||
    value === 'primitive' ||
    value === 'profile-parts'
    ? value
    : undefined
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index += 1) {
    let current = index
    for (let bit = 0; bit < 8; bit += 1) {
      current = current & 1 ? 0xedb88320 ^ (current >>> 1) : current >>> 1
    }
    table[index] = current >>> 0
  }
  return table
})()

function crc32(bytes: Buffer) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear())
  const dosTime =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { dosDate, dosTime }
}

function uint16(value: number) {
  const buffer = Buffer.allocUnsafe(2)
  buffer.writeUInt16LE(value, 0)
  return buffer
}

function uint32(value: number) {
  const buffer = Buffer.allocUnsafe(4)
  buffer.writeUInt32LE(value >>> 0, 0)
  return buffer
}

async function collectZipFiles(root: string, dir = root): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) return collectZipFiles(root, file)
      if (!entry.isFile()) return []
      return [path.relative(root, file).replace(/\\/g, '/')]
    }),
  )
  return files.flat().sort((left, right) => left.localeCompare(right))
}

async function writeProfilePackZipFromDir(packDir: string, zipPath: string) {
  const fileNames = await collectZipFiles(packDir)
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  const { dosDate, dosTime } = dosDateTime()

  for (const name of fileNames) {
    const data = await fs.readFile(path.join(packDir, name))
    const nameBytes = Buffer.from(name, 'utf8')
    const checksum = crc32(data)
    const localHeader = Buffer.concat([
      uint32(0x04034b50),
      uint16(20),
      uint16(0x0800),
      uint16(0),
      uint16(dosTime),
      uint16(dosDate),
      uint32(checksum),
      uint32(data.length),
      uint32(data.length),
      uint16(nameBytes.length),
      uint16(0),
      nameBytes,
    ])
    localParts.push(localHeader, data)
    centralParts.push(
      Buffer.concat([
        uint32(0x02014b50),
        uint16(20),
        uint16(20),
        uint16(0x0800),
        uint16(0),
        uint16(dosTime),
        uint16(dosDate),
        uint32(checksum),
        uint32(data.length),
        uint32(data.length),
        uint16(nameBytes.length),
        uint16(0),
        uint16(0),
        uint16(0),
        uint16(0),
        uint32(0),
        uint32(offset),
        nameBytes,
      ]),
    )
    offset += localHeader.length + data.length
  }

  const localData = Buffer.concat(localParts)
  const centralData = Buffer.concat(centralParts)
  const endOfCentralDirectory = Buffer.concat([
    uint32(0x06054b50),
    uint16(0),
    uint16(0),
    uint16(fileNames.length),
    uint16(fileNames.length),
    uint32(centralData.length),
    uint32(localData.length),
    uint16(0),
  ])

  await fs.writeFile(zipPath, Buffer.concat([localData, centralData, endOfCentralDirectory]))
}

function normalizeDevice(raw: unknown, industry: string): IndustryPackDeviceSpec {
  if (!isRecord(raw)) throw new Error('Each devices[] item must be an object.')
  const id = stringValue(raw.id)
  const name = stringValue(raw.name)
  const primarySemanticRole = stringValue(raw.primarySemanticRole)
  if (!id) throw new Error('Device id is required.')
  if (!name) throw new Error(`Device ${id} name is required.`)
  if (!primarySemanticRole) throw new Error(`Device ${id} primarySemanticRole is required.`)
  if (!Array.isArray(raw.parts) || raw.parts.length === 0) {
    throw new Error(`Device ${id} parts must be a non-empty array.`)
  }
  const parts = raw.parts.map((part, index) => {
    if (!isRecord(part)) throw new Error(`Device ${id} parts[${index}] must be an object.`)
    const kind = stringValue(part.kind)
    const semanticRole = stringValue(part.semanticRole)
    if (!kind) throw new Error(`Device ${id} parts[${index}].kind is required.`)
    if (!semanticRole) {
      throw new Error(`Device ${id} parts[${index}].semanticRole is required.`)
    }
    return { ...part, kind, semanticRole }
  })
  const defaultDimensions = isRecord(raw.defaultDimensions)
    ? Object.fromEntries(
        Object.entries(raw.defaultDimensions).filter(
          (entry): entry is [string, number] => typeof entry[1] === 'number',
        ),
      )
    : undefined
  const equipmentDefaults = isRecord(raw.equipmentDefaults)
    ? raw.equipmentDefaults
    : isRecord(raw.recipeParams)
      ? raw.recipeParams
      : undefined
  return {
    id: profileId(id, industry),
    name,
    aliases: stringArray(raw.aliases),
    ...(stringValue(raw.description) ? { description: stringValue(raw.description) } : {}),
    family: stringValue(raw.family) ?? 'generic',
    layoutFamily: stringValue(raw.layoutFamily) ?? 'generic_industrial_layout',
    ...(stringValue(raw.recipeId) ? { recipeId: stringValue(raw.recipeId) } : {}),
    ...(stringValue(raw.archetypeFamily)
      ? { archetypeFamily: stringValue(raw.archetypeFamily) }
      : {}),
    ...(preferredResolver(raw.preferredResolver)
      ? { preferredResolver: preferredResolver(raw.preferredResolver) }
      : {}),
    ...(defaultDimensions ? { defaultDimensions } : {}),
    ...(recordArray(raw.processPorts, `Device ${id} processPorts`)?.length
      ? { processPorts: recordArray(raw.processPorts, `Device ${id} processPorts`) }
      : {}),
    ...(equipmentDefaults ? { equipmentDefaults, recipeParams: equipmentDefaults } : {}),
    parts,
    primarySemanticRole,
    ...(stringArray(raw.visualCues).length ? { visualCues: stringArray(raw.visualCues) } : {}),
    ...(stringArray(raw.forbiddenRoles).length
      ? { forbiddenRoles: stringArray(raw.forbiddenRoles) }
      : {}),
    ...(isRecord(raw.shapeCount)
      ? {
          shapeCount: {
            ...(typeof raw.shapeCount.min === 'number' ? { min: raw.shapeCount.min } : {}),
            ...(typeof raw.shapeCount.max === 'number' ? { max: raw.shapeCount.max } : {}),
          },
        }
      : {}),
    ...(stringValue(raw.qualityRuleId) ? { qualityRuleId: stringValue(raw.qualityRuleId) } : {}),
    ...(stringArray(raw.qualityRequiredRoles).length
      ? { qualityRequiredRoles: stringArray(raw.qualityRequiredRoles) }
      : {}),
  }
}

function recordArray(value: unknown, fieldName: string): JsonRecord[] | undefined {
  if (value == null) return undefined
  if (!Array.isArray(value)) throw new Error(`Spec ${fieldName} must be an array.`)
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`Spec ${fieldName}[${index}] must be an object.`)
    return item
  })
}

const FORBIDDEN_FACTORY_ARCHITECTURE_FIELDS = ['parameters', 'flows']
const FORBIDDEN_FACTORY_MODULE_FIELDS = [
  'countParam',
  'defaultCount',
  'minCount',
  'maxCount',
  'replicatedStationIds',
]

function assertSingleProcessFactoryArchitectures(factoryArchitectures: JsonRecord[] | undefined) {
  for (const [architectureIndex, architecture] of factoryArchitectures?.entries() ?? []) {
    for (const field of FORBIDDEN_FACTORY_ARCHITECTURE_FIELDS) {
      if (field in architecture) {
        throw new Error(
          `Spec factoryArchitectures[${architectureIndex}].${field} is not supported; factory creation uses one process template per request.`,
        )
      }
    }
    const modules = Array.isArray(architecture.modules) ? architecture.modules : []
    for (const [moduleIndex, module] of modules.entries()) {
      if (!isRecord(module)) continue
      for (const field of FORBIDDEN_FACTORY_MODULE_FIELDS) {
        if (field in module) {
          throw new Error(
            `Spec factoryArchitectures[${architectureIndex}].modules[${moduleIndex}].${field} is not supported; model each factory request as one default process line.`,
          )
        }
      }
    }
  }
}

export function normalizeIndustryPackSpec(raw: unknown): IndustryPackSpec {
  if (!isRecord(raw)) throw new Error('Industry pack spec must be an object.')
  const industry = stringValue(raw.industry)
  if (!industry) throw new Error('Spec industry is required.')
  if (!Array.isArray(raw.devices) || raw.devices.length === 0) {
    throw new Error('Spec devices must be a non-empty array.')
  }
  const dependsOn = Array.isArray(raw.dependsOn)
    ? raw.dependsOn
        .map((dependency) => {
          if (!isRecord(dependency)) return undefined
          const id = stringValue(dependency.id)
          if (!id) return undefined
          return {
            id,
            ...(stringValue(dependency.version)
              ? { version: stringValue(dependency.version) }
              : {}),
          }
        })
        .filter((dependency): dependency is ProfilePackDependency => Boolean(dependency))
    : undefined
  const dependsOnPlugins = stringArray(raw.dependsOnPlugins)
  const factoryArchitectures = recordArray(raw.factoryArchitectures, 'factoryArchitectures')
  const processTemplates = recordArray(raw.processTemplates, 'processTemplates')
  assertSingleProcessFactoryArchitectures(factoryArchitectures)
  const capabilities = stringArray(raw.capabilities).filter(
    (capability): capability is 'factory_creation' => capability === 'factory_creation',
  )
  return {
    ...(stringValue(raw.id) ? { id: stringValue(raw.id) } : {}),
    ...(stringValue(raw.name) ? { name: stringValue(raw.name) } : {}),
    industry,
    version: stringValue(raw.version) ?? '0.1.0',
    schemaVersion: stringValue(raw.schemaVersion) ?? '2.0',
    knowledgeSchemaVersion: stringValue(raw.knowledgeSchemaVersion) ?? '1.0',
    appCompatibility: stringValue(raw.appCompatibility) ?? '>=0.8.0',
    locale: stringArray(raw.locale).length ? stringArray(raw.locale) : ['zh-CN', 'en-US'],
    ...(capabilities.length ? { capabilities } : {}),
    ...(stringValue(raw.description) ? { description: stringValue(raw.description) } : {}),
    ...(dependsOn?.length ? { dependsOn } : {}),
    ...(dependsOnPlugins.length ? { dependsOnPlugins } : {}),
    devices: raw.devices.map((device) => normalizeDevice(device, industry)),
    ...(factoryArchitectures?.length ? { factoryArchitectures } : {}),
    ...(processTemplates?.length ? { processTemplates } : {}),
  }
}

function uniqueRoles(device: IndustryPackDeviceSpec) {
  return [
    ...new Set([
      device.primarySemanticRole,
      ...device.parts
        .filter((part) => part.required !== false)
        .map((part) => part.semanticRole)
        .filter(Boolean),
      ...(device.qualityRequiredRoles ?? []),
    ]),
  ]
}

function deviceAuthoringText(device: IndustryPackDeviceSpec) {
  return [
    device.id,
    device.name,
    device.description,
    device.primarySemanticRole,
    device.layoutFamily,
    device.family,
    device.preferredResolver,
    ...device.aliases,
    ...device.parts.flatMap((part) => [part.kind, part.semanticRole]),
    ...(device.visualCues ?? []),
    ...(device.qualityRequiredRoles ?? []),
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase()
}

function hasPartKind(device: IndustryPackDeviceSpec, kind: string) {
  return device.parts.some((part) => part.kind === kind)
}

function hasRoleMatch(device: IndustryPackDeviceSpec, pattern: RegExp) {
  return [
    device.primarySemanticRole,
    ...device.parts.map((part) => part.semanticRole),
    ...(device.qualityRequiredRoles ?? []),
  ].some((role) => pattern.test(role.toLowerCase().replace(/[_-]/g, ' ')))
}

function collectAuthoringWarningsForDevice(
  device: IndustryPackDeviceSpec,
): IndustryPackAuthoringWarning[] {
  const warnings: IndustryPackAuthoringWarning[] = []
  const text = deviceAuthoringText(device)
  const isControlBuilding =
    /\bcontrol[_\s-]?room\b/.test(text) ||
    /\bcontrol[_\s-]?building\b/.test(text) ||
    /\boccupied[_\s-]?building\b/.test(text) ||
    /\bmcc\b/.test(text) ||
    text.includes('中控') ||
    text.includes('控制室')
  const isBoiler = /\bboiler\b/.test(text) || text.includes('锅炉')

  if (isControlBuilding && device.preferredResolver === 'catalog-item') {
    warnings.push({
      deviceId: device.id,
      code: 'control_building_catalog_resolver',
      message:
        'Control rooms and occupied buildings should use profile-parts with body, roof, door, window, and panel roles instead of catalog-item fallback.',
    })
  }

  if (isControlBuilding) {
    const hasBuildingOpenings =
      hasPartKind(device, 'generic_opening') ||
      hasPartKind(device, 'generic_detail_accent') ||
      hasRoleMatch(device, /\b(door|window|opening|roof|parapet|wall|building)\b/)
    if (!hasBuildingOpenings) {
      warnings.push({
        deviceId: device.id,
        code: 'control_building_missing_shell_details',
        message:
          'Control-room-like profiles should include visible building details such as a roof cap/parapet, door, and blast-resistant windows.',
      })
    }
  }

  if (isBoiler) {
    const hasStack =
      hasPartKind(device, 'chimney_stack') || hasRoleMatch(device, /\b(stack|chimney)\b/)
    const hasVisibleSteamBody =
      hasPartKind(device, 'cylindrical_tank') || hasRoleMatch(device, /\b(drum|tube|tube_bank)\b/)
    const hasSteamHeader =
      hasPartKind(device, 'pipe_manifold') || hasRoleMatch(device, /\b(header|manifold|steam)\b/)
    if (!hasStack || !hasVisibleSteamBody || !hasSteamHeader) {
      warnings.push({
        deviceId: device.id,
        code: 'boiler_missing_process_features',
        message:
          'Boiler profiles should show more than a plain box: include a stack, visible steam drum or tube bank, steam header, and control/service details.',
      })
    }
  }

  return warnings
}

function collectAuthoringWarnings(spec: IndustryPackSpec) {
  return spec.devices.flatMap((device) => collectAuthoringWarningsForDevice(device))
}

function profileFromDevice(device: IndustryPackDeviceSpec, industry: string) {
  const ruleId = qualityRuleId(device.id, device.qualityRuleId)
  return withDefaultV2ProfileFields({
    id: device.id,
    name: device.name,
    aliases: device.aliases,
    industry,
    layoutFamily: device.layoutFamily ?? 'generic_industrial_layout',
    ...(device.archetypeFamily ? { archetypeFamily: device.archetypeFamily } : {}),
    ...(device.preferredResolver ? { preferredResolver: device.preferredResolver } : {}),
    ...(device.recipeId ? { recipeId: device.recipeId } : {}),
    family: device.family ?? 'generic',
    ...(device.defaultDimensions ? { defaultDimensions: device.defaultDimensions } : {}),
    ...(device.processPorts?.length ? { processPorts: device.processPorts } : {}),
    ...(device.equipmentDefaults ? { equipmentDefaults: device.equipmentDefaults } : {}),
    ...(device.recipeParams ? { recipeParams: device.recipeParams } : {}),
    parts: device.parts,
    primarySemanticRole: device.primarySemanticRole,
    qualityRules: ruleId,
    ...(device.visualCues ? { visualCues: device.visualCues } : {}),
    status: 'stable',
    source: 'imported_pack',
    ...(device.description ? { description: device.description } : {}),
  })
}

function qualityRuleFromDevice(device: IndustryPackDeviceSpec) {
  const partCount = device.parts.length
  return {
    id: qualityRuleId(device.id, device.qualityRuleId),
    requiredRoles: uniqueRoles(device),
    ...(device.forbiddenRoles?.length ? { forbiddenRoles: device.forbiddenRoles } : {}),
    shapeCount: {
      min: device.shapeCount?.min ?? Math.max(1, Math.floor(partCount * 0.75)),
      max: device.shapeCount?.max ?? Math.max(24, partCount * 8),
    },
  }
}

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function writeReadme(
  file: string,
  spec: IndustryPackSpec,
  authoringWarnings: IndustryPackAuthoringWarning[],
) {
  const title = spec.name ?? `${spec.industry} Profile Pack`
  const factoryCapable = spec.capabilities?.includes('factory_creation') === true
  const lines = [
    `# ${title}`,
    '',
    spec.description ?? `Generated ${spec.industry} industry profile pack.`,
    '',
    '## Devices',
    '',
    ...spec.devices.map((device) => `- ${device.name} (${device.id})`),
    '',
    '## Pack Type',
    '',
    factoryCapable
      ? 'Factory-capable pack: supports factory/process creation through process templates and factory architectures.'
      : 'Device-only pack: provides equipment profiles but does not claim factory/process creation support.',
    ...(factoryCapable
      ? [
          '',
          '## Factory Creation',
          '',
          'Supported whole-factory/process templates:',
          '',
          ...(spec.processTemplates?.length
            ? spec.processTemplates.map(
                (template) =>
                  `- ${stringValue(template.processLabel) ?? stringValue(template.processId) ?? 'Process template'} (${stringValue(template.processId) ?? 'unknown'})`,
              )
            : ['- None declared']),
          '',
          'Supported factory scopes/modules:',
          '',
          ...(spec.factoryArchitectures?.length
            ? spec.factoryArchitectures.flatMap((architecture) =>
                Array.isArray(architecture.scopes) && architecture.scopes.length
                  ? architecture.scopes
                      .filter(isRecord)
                      .map(
                        (scope) =>
                          `- ${stringValue(scope.label) ?? stringValue(scope.id) ?? 'Factory scope'} (${stringValue(scope.id) ?? 'unknown'})`,
                      )
                  : [
                      `- ${stringValue(architecture.label) ?? stringValue(architecture.id) ?? 'Factory architecture'} (${stringValue(architecture.id) ?? 'unknown'})`,
                    ],
              )
            : ['- None declared']),
        ]
      : []),
    ...(spec.factoryArchitectures?.length
      ? [
          '',
          '## Factory Architectures',
          '',
          ...spec.factoryArchitectures.map(
            (architecture) =>
              `- ${stringValue(architecture.label) ?? stringValue(architecture.id) ?? 'Factory architecture'}`,
          ),
        ]
      : []),
    ...(spec.processTemplates?.length
      ? [
          '',
          '## Process Templates',
          '',
          ...spec.processTemplates.map(
            (template) =>
              `- ${stringValue(template.processLabel) ?? stringValue(template.processId) ?? 'Process template'}`,
          ),
        ]
      : []),
    '',
    '## Authoring Review',
    '',
    ...(authoringWarnings.length
      ? authoringWarnings.map(
          (warning) => `- ${warning.deviceId}: ${warning.code} - ${warning.message}`,
        )
      : ['- No scaffold authoring warnings.']),
    '',
    '## Validation',
    '',
    'Run:',
    '',
    '```bash',
    `bun apps/editor/scripts/profile-pack-qa.ts ${packId(spec.industry, spec.id)}@${spec.version ?? '0.1.0'} --validate-only`,
    '```',
    '',
  ]
  await fs.writeFile(file, `${lines.join('\n')}\n`, 'utf8')
}

export async function scaffoldIndustryProfilePack(options: ScaffoldIndustryPackOptions) {
  const raw = JSON.parse((await fs.readFile(options.specPath, 'utf8')).replace(/^\uFEFF/, ''))
  const spec = normalizeIndustryPackSpec(raw)
  const authoringWarnings = collectAuthoringWarnings(spec)
  const repoRoot = await findRepoRoot()
  const id = packId(spec.industry, spec.id)
  const version = spec.version ?? '0.1.0'
  const outputRoot = options.outputRoot ?? simulatedProfilePackCloudRoot(repoRoot)
  const packDir = path.join(outputRoot, `${id}-${version}`)
  const zipPath = path.join(outputRoot, `${id}-${version}.zip`)
  if (!options.force) {
    try {
      await fs.access(packDir)
      throw new Error(`Output directory already exists: ${packDir}. Use --force to replace it.`)
    } catch (error) {
      if (error instanceof Error && !('code' in error)) throw error
    }
    try {
      await fs.access(zipPath)
      throw new Error(`Output zip already exists: ${zipPath}. Use --force to replace it.`)
    } catch (error) {
      if (error instanceof Error && !('code' in error)) throw error
    }
  }
  await fs.rm(packDir, { recursive: true, force: true })
  if (options.writeZip !== false) await fs.rm(zipPath, { force: true })
  await fs.mkdir(packDir, { recursive: true })

  const profileFile = 'profiles/generated.json'
  const qualityFile = 'quality-rules/generated-quality.json'
  const factoryArchitectureFile = spec.factoryArchitectures?.length
    ? 'factory-architectures/generated.json'
    : undefined
  const processTemplateFile = spec.processTemplates?.length
    ? 'process-templates/generated.json'
    : undefined
  if (!semanticRecipeRegistry.has('factory:centrifugal-pump')) {
    await loadPlugin(factoryEquipmentPlugin)
  }
  const profiles = spec.devices.map((device) => profileFromDevice(device, spec.industry))
  const equipmentBindings = inferEquipmentBindingsForProfiles(profiles)
  const processTemplates = spec.processTemplates?.length
    ? annotateProcessTemplatesForV2({
        processTemplates: spec.processTemplates,
        profiles,
        bindings: equipmentBindings,
      })
    : undefined
  const manifest = {
    id,
    name: spec.name ?? `${spec.industry} Basic Equipment Pack`,
    industry: spec.industry,
    version,
    schemaVersion: spec.schemaVersion ?? '2.0',
    knowledgeSchemaVersion: spec.knowledgeSchemaVersion ?? '1.0',
    appCompatibility: spec.appCompatibility ?? '>=0.8.0',
    locale: spec.locale ?? ['zh-CN', 'en-US'],
    ...(spec.capabilities?.length ? { capabilities: spec.capabilities } : {}),
    description: spec.description ?? `Generated ${spec.industry} industry profile pack.`,
    ...(spec.dependsOn?.length ? { dependsOn: spec.dependsOn } : {}),
    dependsOnPlugins: spec.dependsOnPlugins?.length
      ? spec.dependsOnPlugins
      : [FACTORY_EQUIPMENT_PLUGIN_ID],
    profiles: [profileFile],
    equipmentBindings,
    ...(factoryArchitectureFile ? { factoryArchitectures: [factoryArchitectureFile] } : {}),
    ...(processTemplateFile ? { processTemplates: [processTemplateFile] } : {}),
    qualityRules: [qualityFile],
  }

  await writeJson(path.join(packDir, 'pack.json'), manifest)
  await writeJson(path.join(packDir, profileFile), profiles)
  await writeJson(
    path.join(packDir, qualityFile),
    spec.devices.map((device) => qualityRuleFromDevice(device)),
  )
  if (factoryArchitectureFile) {
    await writeJson(path.join(packDir, factoryArchitectureFile), spec.factoryArchitectures)
  }
  if (processTemplateFile) {
    await writeJson(path.join(packDir, processTemplateFile), processTemplates)
  }
  await writeReadme(path.join(packDir, 'README.md'), spec, authoringWarnings)

  const validation = options.validate === false ? undefined : await validateProfilePackDir(packDir)
  const audit = validation ? auditProfilePackValidation(validation) : undefined
  if (audit && !audit.ok) {
    throw new Error(`Generated pack failed audit: ${audit.issues.join('; ')}`)
  }
  if (options.writeZip !== false) {
    await writeProfilePackZipFromDir(packDir, zipPath)
  }
  return {
    packDir,
    zipPath: options.writeZip === false ? undefined : zipPath,
    manifest,
    audit,
    authoringWarnings,
  }
}

function readArgValue(args: string[], name: string) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

async function main() {
  const args = process.argv.slice(2)
  const specPath = readArgValue(args, '--spec')
  if (!specPath) {
    throw new Error(
      'Usage: bun apps/editor/scripts/scaffold-industry-profile-pack.ts --spec <spec.json> [--out <dir>] [--force] [--skip-validate] [--skip-zip]',
    )
  }
  const result = await scaffoldIndustryProfilePack({
    specPath: path.resolve(specPath),
    outputRoot: readArgValue(args, '--out')
      ? path.resolve(readArgValue(args, '--out') ?? '')
      : undefined,
    force: args.includes('--force'),
    validate: !args.includes('--skip-validate'),
    writeZip: !args.includes('--skip-zip'),
  })
  console.log(
    JSON.stringify(
      {
        packDir: result.packDir,
        zipPath: result.zipPath,
        id: result.manifest.id,
        version: result.manifest.version,
        audit: result.audit
          ? {
              ok: result.audit.ok,
              score: result.audit.score,
              issues: result.audit.issues,
              warnings: result.audit.warnings,
              summary: result.audit.summary,
            }
          : undefined,
        authoringWarnings: result.authoringWarnings,
      },
      null,
      2,
    ),
  )
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
