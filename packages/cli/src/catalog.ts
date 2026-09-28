import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { CliError } from './errors.js'
import { withFileLock } from './file-lock.js'
import { writeJsonFile } from './json-files.js'
import { resolveMcpServicePath } from './mcp-service.js'
import type { PascalPaths } from './paths.js'

export interface CatalogPreference {
  schemaVersion: 1
  online: boolean
}

export interface CliCatalogStatus {
  enabled: boolean
  mode: 'bundled' | 'online' | 'unavailable'
  accountLinked: false
  accountRequired: false
  bundledCount?: number
  onlineCount?: number
  excludedCount?: number
  message: string
  connectCommand?: string
  disconnectCommand?: string
}

export async function readCatalogPreference(paths: PascalPaths): Promise<CatalogPreference> {
  let value: unknown
  try {
    const configPath = path.join(paths.data, 'catalog.json')
    const info = await stat(configPath)
    if (!info.isFile() || info.size > 4096) throw new Error('Invalid catalog setting')
    const raw = await readFile(configPath, 'utf8')
    if (Buffer.byteLength(raw) > 4096) throw new Error('Invalid catalog setting')
    value = JSON.parse(raw)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { schemaVersion: 1, online: false }
    throw new CliError(
      'invalid_catalog_setting',
      'The catalog setting is unreadable. Run "pascal catalog disconnect" to reset it.',
    )
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => key !== 'schemaVersion' && key !== 'online') ||
    (value as Partial<CatalogPreference>).schemaVersion !== 1 ||
    typeof (value as Partial<CatalogPreference>).online !== 'boolean'
  )
    throw new CliError(
      'invalid_catalog_setting',
      'The catalog setting is invalid. Run "pascal catalog disconnect" to reset it.',
    )
  return value as CatalogPreference
}

export async function setCatalogPreference(paths: PascalPaths, online: boolean): Promise<void> {
  await withFileLock(
    path.join(paths.data, 'catalog.lock'),
    'catalog_busy',
    'Another catalog command is updating the preference. Retry shortly.',
    () => writeJsonFile(path.join(paths.data, 'catalog.json'), { schemaVersion: 1, online }),
  )
}

export async function getCatalogStatus(
  paths: PascalPaths,
  options: { probe?: (dataDir: string) => Promise<unknown> } = {},
): Promise<CliCatalogStatus> {
  const setting = await readCatalogPreference(paths)
  if (!setting.online) return bundledStatus()
  try {
    const result = await (options.probe ?? probeBundledCatalog)(paths.data)
    // A simultaneous disconnect must win over this command's in-flight probe.
    if (!(await readCatalogPreference(paths)).online) return bundledStatus()
    if (!isCatalogStatus(result)) throw new Error('Invalid catalog status')
    return {
      enabled: true,
      mode: result.mode,
      accountLinked: false,
      accountRequired: false,
      message: result.message,
      ...(result.bundledCount === undefined ? {} : { bundledCount: result.bundledCount }),
      ...(result.onlineCount === undefined ? {} : { onlineCount: result.onlineCount }),
      ...(result.excludedCount === undefined ? {} : { excludedCount: result.excludedCount }),
      ...(result.connectCommand === undefined ? {} : { connectCommand: result.connectCommand }),
      ...(result.disconnectCommand === undefined
        ? {}
        : { disconnectCommand: result.disconnectCommand }),
    }
  } catch {
    if (!(await readCatalogPreference(paths)).online) return bundledStatus()
    return {
      enabled: true,
      mode: 'unavailable',
      accountLinked: false,
      accountRequired: false,
      message:
        'Online catalog access is enabled, but availability could not be verified. Bundled items remain available. Retry "pascal catalog status" or disconnect.',
      disconnectCommand: 'pascal catalog disconnect',
    }
  }
}

function bundledStatus(): CliCatalogStatus {
  return {
    enabled: false,
    mode: 'bundled',
    accountLinked: false,
    accountRequired: false,
    message:
      'Using bundled items. Optionally run "pascal catalog connect" for the free public online catalog. No account is required; generation uses separate credits.',
    connectCommand: 'pascal catalog connect',
  }
}

async function probeBundledCatalog(dataDir: string): Promise<unknown> {
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'production', PASCAL_DATA_DIR: dataDir }
  for (const name of [
    'PATH',
    'SystemRoot',
    'SYSTEMROOT',
    'TMPDIR',
    'TMP',
    'TEMP',
    'PASCAL_ALLOWED_ASSET_ORIGINS',
  ]) {
    if (process.env[name]) env[name] = process.env[name]
  }
  const { stdout } = await promisify(execFile)(
    process.env.PASCAL_NODE_BINARY || 'node',
    [resolveMcpServicePath(), '--catalog-status'],
    { env, timeout: 20_000, maxBuffer: 32 * 1024 },
  )
  return JSON.parse(stdout)
}

function isCatalogStatus(value: unknown): value is Omit<CliCatalogStatus, 'enabled'> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return (
    ['bundled', 'online', 'unavailable'].includes(String(row.mode)) &&
    row.accountLinked === false &&
    row.accountRequired === false &&
    typeof row.message === 'string' &&
    row.message.length <= 2048 &&
    [...row.message].every(
      (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
    ) &&
    ['bundledCount', 'onlineCount', 'excludedCount'].every(
      (key) => row[key] === undefined || (Number.isSafeInteger(row[key]) && Number(row[key]) >= 0),
    ) &&
    (row.connectCommand === undefined || row.connectCommand === 'pascal catalog connect') &&
    (row.disconnectCommand === undefined || row.disconnectCommand === 'pascal catalog disconnect')
  )
}
