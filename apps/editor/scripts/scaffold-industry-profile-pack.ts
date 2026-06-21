import fs from 'node:fs/promises'
import path from 'node:path'
import { findRepoRoot } from '../lib/generated-assets/manifest'
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
  preferredResolver?: 'catalog-item' | 'native-box' | 'native-tank' | 'primitive' | 'profile-parts'
  defaultDimensions?: Record<string, number>
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
  devices: IndustryPackDeviceSpec[]
  factoryArchitectures?: JsonRecord[]
  processTemplates?: JsonRecord[]
}

export type ScaffoldIndustryPackOptions = {
  specPath: string
  outputRoot?: string
  force?: boolean
  validate?: boolean
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
  return {
    id: profileId(id, industry),
    name,
    aliases: stringArray(raw.aliases),
    ...(stringValue(raw.description) ? { description: stringValue(raw.description) } : {}),
    family: stringValue(raw.family) ?? 'generic',
    layoutFamily: stringValue(raw.layoutFamily) ?? 'generic_industrial_layout',
    ...(stringValue(raw.archetypeFamily)
      ? { archetypeFamily: stringValue(raw.archetypeFamily) }
      : {}),
    ...(preferredResolver(raw.preferredResolver)
      ? { preferredResolver: preferredResolver(raw.preferredResolver) }
      : {}),
    ...(defaultDimensions ? { defaultDimensions } : {}),
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
    schemaVersion: stringValue(raw.schemaVersion) ?? '1.1',
    knowledgeSchemaVersion: stringValue(raw.knowledgeSchemaVersion) ?? '1.0',
    appCompatibility: stringValue(raw.appCompatibility) ?? '>=0.8.0',
    locale: stringArray(raw.locale).length ? stringArray(raw.locale) : ['zh-CN', 'en-US'],
    ...(capabilities.length ? { capabilities } : {}),
    ...(stringValue(raw.description) ? { description: stringValue(raw.description) } : {}),
    ...(dependsOn?.length ? { dependsOn } : {}),
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

function profileFromDevice(device: IndustryPackDeviceSpec, industry: string) {
  const ruleId = qualityRuleId(device.id, device.qualityRuleId)
  return {
    id: device.id,
    name: device.name,
    aliases: device.aliases,
    industry,
    layoutFamily: device.layoutFamily ?? 'generic_industrial_layout',
    ...(device.archetypeFamily ? { archetypeFamily: device.archetypeFamily } : {}),
    ...(device.preferredResolver ? { preferredResolver: device.preferredResolver } : {}),
    family: device.family ?? 'generic',
    ...(device.defaultDimensions ? { defaultDimensions: device.defaultDimensions } : {}),
    parts: device.parts,
    primarySemanticRole: device.primarySemanticRole,
    qualityRules: ruleId,
    ...(device.visualCues ? { visualCues: device.visualCues } : {}),
    status: 'stable',
    source: 'imported_pack',
    ...(device.description ? { description: device.description } : {}),
  }
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

async function writeReadme(file: string, spec: IndustryPackSpec) {
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
  const repoRoot = await findRepoRoot()
  const id = packId(spec.industry, spec.id)
  const version = spec.version ?? '0.1.0'
  const outputRoot = options.outputRoot ?? simulatedProfilePackCloudRoot(repoRoot)
  const packDir = path.join(outputRoot, `${id}-${version}`)
  if (!options.force) {
    try {
      await fs.access(packDir)
      throw new Error(`Output directory already exists: ${packDir}. Use --force to replace it.`)
    } catch (error) {
      if (error instanceof Error && !('code' in error)) throw error
    }
  }
  await fs.rm(packDir, { recursive: true, force: true })
  await fs.mkdir(packDir, { recursive: true })

  const profileFile = 'profiles/generated.json'
  const qualityFile = 'quality-rules/generated-quality.json'
  const factoryArchitectureFile = spec.factoryArchitectures?.length
    ? 'factory-architectures/generated.json'
    : undefined
  const processTemplateFile = spec.processTemplates?.length
    ? 'process-templates/generated.json'
    : undefined
  const manifest = {
    id,
    name: spec.name ?? `${spec.industry} Basic Equipment Pack`,
    industry: spec.industry,
    version,
    schemaVersion: spec.schemaVersion ?? '1.1',
    knowledgeSchemaVersion: spec.knowledgeSchemaVersion ?? '1.0',
    appCompatibility: spec.appCompatibility ?? '>=0.8.0',
    locale: spec.locale ?? ['zh-CN', 'en-US'],
    ...(spec.capabilities?.length ? { capabilities: spec.capabilities } : {}),
    description: spec.description ?? `Generated ${spec.industry} industry profile pack.`,
    ...(spec.dependsOn?.length ? { dependsOn: spec.dependsOn } : {}),
    profiles: [profileFile],
    ...(factoryArchitectureFile ? { factoryArchitectures: [factoryArchitectureFile] } : {}),
    ...(processTemplateFile ? { processTemplates: [processTemplateFile] } : {}),
    qualityRules: [qualityFile],
  }

  await writeJson(path.join(packDir, 'pack.json'), manifest)
  await writeJson(
    path.join(packDir, profileFile),
    spec.devices.map((device) => profileFromDevice(device, spec.industry)),
  )
  await writeJson(
    path.join(packDir, qualityFile),
    spec.devices.map((device) => qualityRuleFromDevice(device)),
  )
  if (factoryArchitectureFile) {
    await writeJson(path.join(packDir, factoryArchitectureFile), spec.factoryArchitectures)
  }
  if (processTemplateFile) {
    await writeJson(path.join(packDir, processTemplateFile), spec.processTemplates)
  }
  await writeReadme(path.join(packDir, 'README.md'), spec)

  const validation = options.validate === false ? undefined : await validateProfilePackDir(packDir)
  const audit = validation ? auditProfilePackValidation(validation) : undefined
  if (audit && !audit.ok) {
    throw new Error(`Generated pack failed audit: ${audit.issues.join('; ')}`)
  }
  return {
    packDir,
    manifest,
    audit,
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
      'Usage: bun apps/editor/scripts/scaffold-industry-profile-pack.ts --spec <spec.json> [--out <dir>] [--force] [--skip-validate]',
    )
  }
  const result = await scaffoldIndustryProfilePack({
    specPath: path.resolve(specPath),
    outputRoot: readArgValue(args, '--out')
      ? path.resolve(readArgValue(args, '--out') ?? '')
      : undefined,
    force: args.includes('--force'),
    validate: !args.includes('--skip-validate'),
  })
  console.log(
    JSON.stringify(
      {
        packDir: result.packDir,
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
