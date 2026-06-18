import fs from 'node:fs/promises'
import path from 'node:path'
import {
  DEVICE_PROFILE_DEFINITIONS,
  type DeviceProfileDefinition,
  type DeviceProfileSource,
  mergeDeviceProfiles,
  normalizeDeviceProfileInput,
  validateDeviceProfileDefinition,
} from '@pascal-app/core/lib/device-profile-registry'
import { findRepoRoot } from './generated-assets/manifest'

type ProfileSourceDir = {
  dir: string
  source: DeviceProfileSource
}

export type LoadedDeviceProfiles = {
  profiles: DeviceProfileDefinition[]
  warnings: string[]
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
    } else if (/\.(json|ya?ml)$/i.test(entry.name)) {
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

export async function loadDeviceProfiles(): Promise<LoadedDeviceProfiles> {
  const root = await findRepoRoot()
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
  const merged = mergeDeviceProfiles([
    loaded[1]?.profiles ?? [],
    loaded[0]?.profiles ?? [],
    DEVICE_PROFILE_DEFINITIONS,
    loaded[2]?.profiles ?? [],
  ])
  return {
    profiles: merged.profiles,
    warnings: [...loaded.flatMap((entry) => entry.warnings), ...merged.warnings],
  }
}
