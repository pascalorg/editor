import fs from 'node:fs/promises'
import path from 'node:path'
import { loadPlugin, nodeRegistry } from '@pascal-app/core'
import { factoryEquipmentPlugin } from '@pascal-app/plugin-factory-equipment'
import {
  annotateProcessTemplatesForV2,
  FACTORY_EQUIPMENT_PLUGIN_ID,
  inferEquipmentBindingsForProfiles,
  withDefaultV2ProfileFields,
} from '../lib/industry-pack-v2-migration'
import {
  auditProfilePackValidation,
  isSafeProfilePackPath,
  normalizeProfilePackManifest,
  validateProfilePackDir,
} from '../lib/profile-packs'

type JsonRecord = Record<string, unknown>

export type MigrateIndustryProfilePackV2Options = {
  packDir: string
  outDir: string
  force?: boolean
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw.replace(/^\uFEFF/, ''))
  } catch (error) {
    throw new Error(`Failed to parse ${label}: ${error instanceof Error ? error.message : error}`)
  }
}

async function readJson(file: string): Promise<unknown> {
  return parseJson(await fs.readFile(file, 'utf8'), file)
}

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function resourceArray(raw: unknown): JsonRecord[] {
  const values = Array.isArray(raw) ? raw : [raw]
  return values.filter(isRecord)
}

function safeResolve(root: string, rel: string) {
  if (!isSafeProfilePackPath(rel)) throw new Error(`Unsafe resource path in manifest: ${rel}`)
  const resolvedRoot = path.resolve(root)
  const file = path.resolve(root, rel)
  if (!(file === resolvedRoot || file.startsWith(`${resolvedRoot}${path.sep}`))) {
    throw new Error(`Resource path escapes pack directory: ${rel}`)
  }
  return file
}

function profilePayload(raw: JsonRecord): JsonRecord {
  if (typeof raw.id === 'string') return raw
  if (isRecord(raw.profile)) return raw.profile
  if (isRecord(raw.draftProfile)) return raw.draftProfile
  return raw
}

async function migrateProfiles(packDir: string, profileFiles: string[]): Promise<JsonRecord[]> {
  const profiles: JsonRecord[] = []
  for (const rel of profileFiles) {
    const file = safeResolve(packDir, rel)
    const migrated = resourceArray(await readJson(file)).map((raw) =>
      withDefaultV2ProfileFields(profilePayload(raw)),
    )
    profiles.push(...migrated)
    await writeJson(file, migrated)
  }
  return profiles
}

async function migrateProcessTemplates(input: {
  packDir: string
  processTemplateFiles: string[] | undefined
  profiles: JsonRecord[]
  bindings: ReturnType<typeof inferEquipmentBindingsForProfiles>
}) {
  if (!input.processTemplateFiles?.length) return
  for (const rel of input.processTemplateFiles) {
    const file = safeResolve(input.packDir, rel)
    const templates = annotateProcessTemplatesForV2({
      processTemplates: resourceArray(await readJson(file)),
      profiles: input.profiles,
      bindings: input.bindings,
    })
    await writeJson(file, templates)
  }
}

export async function migrateIndustryProfilePackToV2(
  options: MigrateIndustryProfilePackV2Options,
) {
  const sourceDir = path.resolve(options.packDir)
  const outDir = path.resolve(options.outDir)
  if (sourceDir === outDir) {
    throw new Error('Migration output directory must be different from the source pack directory.')
  }
  try {
    await fs.access(outDir)
    if (!options.force) throw new Error(`Output directory already exists: ${outDir}`)
  } catch (error) {
    if (error instanceof Error && !('code' in error)) throw error
  }

  await fs.rm(outDir, { recursive: true, force: true })
  await fs.cp(sourceDir, outDir, { recursive: true })

  const manifestPath = path.join(outDir, 'pack.json')
  const manifest = normalizeProfilePackManifest(await readJson(manifestPath))
  const profiles = await migrateProfiles(outDir, manifest.profiles)
  const equipmentBindings = inferEquipmentBindingsForProfiles(profiles)
  const nextManifest = {
    ...manifest,
    schemaVersion: '2.0',
    dependsOnPlugins: [FACTORY_EQUIPMENT_PLUGIN_ID],
    equipmentBindings,
  }
  await migrateProcessTemplates({
    packDir: outDir,
    processTemplateFiles: manifest.processTemplates,
    profiles,
    bindings: equipmentBindings,
  })
  await writeJson(manifestPath, nextManifest)

  if (!nodeRegistry.has('factory:pump')) await loadPlugin(factoryEquipmentPlugin)
  const validation = await validateProfilePackDir(outDir)
  const audit = auditProfilePackValidation(validation)
  if (!audit.ok) {
    throw new Error(`Migrated pack failed audit: ${audit.issues.join('; ')}`)
  }
  return { packDir: outDir, manifest: nextManifest, audit }
}

function readArgValue(args: string[], name: string) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

async function main() {
  const args = process.argv.slice(2)
  const packDir = readArgValue(args, '--pack')
  const outDir = readArgValue(args, '--out')
  if (!packDir || !outDir) {
    throw new Error(
      'Usage: bun apps/editor/scripts/migrate-industry-profile-pack-v2.ts --pack <pack-dir> --out <out-dir> [--force]',
    )
  }
  const result = await migrateIndustryProfilePackToV2({
    packDir,
    outDir,
    force: args.includes('--force'),
  })
  console.log(
    JSON.stringify(
      {
        packDir: result.packDir,
        id: result.manifest.id,
        version: result.manifest.version,
        equipmentBindingCount: result.manifest.equipmentBindings.length,
        audit: {
          ok: result.audit.ok,
          score: result.audit.score,
          issues: result.audit.issues,
          warnings: result.audit.warnings,
          summary: result.audit.summary,
        },
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
