import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CliError } from './errors.js'
import { downloadToFile } from './http-download.js'
import { readJsonFile } from './json-files.js'
import type { PascalPaths } from './paths.js'
import {
  type ActiveRuntime,
  activateRuntime,
  findInstalledRuntime,
  installBundledRuntime,
  installRuntimeDirectory,
  withRuntimeInstallLock,
} from './runtime.js'
import { extractTarGzip } from './tar.js'

/** A peer process may be downloading the same archive; wait for it instead of duplicating it. */
const DOWNLOAD_LOCK_TIMEOUT_MS = 20 * 60_000

export interface RuntimeSource {
  version: string
  url: string
  sha256: string
  size: number
}

export interface WebRuntimeResult {
  runtime: ActiveRuntime
  installed: boolean
}

export type RuntimeProvisionProgress =
  | { step: 'runtime-downloading'; url: string; received: number; total: number | null }
  | { step: 'runtime-verifying' }
  | { step: 'runtime-extracting' }
  | { step: 'runtime-installing' }

export interface EnsureWebRuntimeOptions {
  paths: PascalPaths
  /** A directory or `.tar.gz` archive from `--runtime`; archives are digest-verified. */
  runtimeSource?: string
  /** `false` installs the runtime without pointing the active runtime at it (used by updates). */
  activate?: boolean
  environment?: NodeJS.ProcessEnv
  sourceFile?: string
  onProgress?: (event: RuntimeProvisionProgress) => void
}

/**
 * Resolves the web runtime for the commands that start the Next server. The npm package
 * ships the CLI and the MCP service only; the runtime is downloaded once per version and
 * verified against the digest committed in `dist/runtime-source.json`.
 */
export async function ensureWebRuntime(
  options: EnsureWebRuntimeOptions,
): Promise<WebRuntimeResult> {
  const { paths } = options
  const environment = options.environment ?? process.env
  const override = options.runtimeSource ?? environment.PASCAL_BUNDLED_RUNTIME_DIR
  if (override) return installOverride(paths, override, options)

  const source = await readRuntimeSource(options.sourceFile)
  const existing = await findInstalledRuntime(paths, source.version)
  if (existing) return { runtime: await useInstalled(paths, existing, options), installed: false }
  return withRuntimeInstallLock(
    paths,
    async () => {
      const peerInstalled = await findInstalledRuntime(paths, source.version)
      if (peerInstalled) {
        return { runtime: await useInstalled(paths, peerInstalled, options), installed: false }
      }
      return withWorkDirectory(paths, async (workDirectory) => {
        const archiveFile = path.join(workDirectory, `pascal-web-runtime-${source.version}.tar.gz`)
        await download(source, archiveFile, options)
        options.onProgress?.({ step: 'runtime-verifying' })
        await verifyArchiveDigest(archiveFile, source.sha256, { deleteOnMismatch: true })
        return {
          runtime: await extractAndInstall(archiveFile, workDirectory, options, (directory) =>
            installRuntimeDirectory(paths, directory, { activate: options.activate }),
          ),
          installed: true,
        }
      })
    },
    { timeoutMs: DOWNLOAD_LOCK_TIMEOUT_MS },
  )
}

export function resolveRuntimeSourceFile(): string {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
  return path.basename(moduleDirectory) === 'dist'
    ? path.join(moduleDirectory, 'runtime-source.json')
    : path.resolve(moduleDirectory, '../dist/runtime-source.json')
}

export async function readRuntimeSource(sourceFile?: string): Promise<RuntimeSource> {
  const file = sourceFile ?? resolveRuntimeSourceFile()
  let source: RuntimeSource | null
  try {
    source = await readJsonFile<RuntimeSource>(file)
  } catch {
    source = null
  }
  if (
    !source ||
    typeof source.version !== 'string' ||
    !/^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(source.version) ||
    typeof source.url !== 'string' ||
    !source.url.startsWith('https://') ||
    typeof source.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(source.sha256) ||
    !Number.isSafeInteger(source.size) ||
    source.size <= 0
  ) {
    throw new CliError(
      'invalid_runtime_source',
      `This CLI cannot resolve the Pascal web runtime it was published with (${file}). Reinstall @pascal-app/cli, or pass "--runtime <directory-or-archive>".`,
    )
  }
  return { version: source.version, url: source.url, sha256: source.sha256, size: source.size }
}

export async function fileSha256(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

export async function verifyArchiveDigest(
  archiveFile: string,
  expectedSha256: string,
  options: { deleteOnMismatch?: boolean } = {},
): Promise<void> {
  const actual = await fileSha256(archiveFile)
  if (actual === expectedSha256.toLowerCase()) return
  if (options.deleteOnMismatch) await rm(archiveFile, { force: true })
  throw new CliError(
    'runtime_digest_mismatch',
    [
      'The Pascal web runtime archive does not match the digest published with this CLI.',
      `  archive:  ${archiveFile}`,
      `  expected: ${expectedSha256}`,
      `  actual:   ${actual}`,
      'The archive was not installed. Download it again from the Pascal release page.',
    ].join('\n'),
  )
}

async function installOverride(
  paths: PascalPaths,
  override: string,
  options: EnsureWebRuntimeOptions,
): Promise<WebRuntimeResult> {
  const resolved = path.resolve(override)
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(resolved)
  } catch {
    throw new CliError('runtime_source_missing', `No Pascal web runtime exists at ${resolved}.`)
  }
  if (info.isDirectory()) {
    options.onProgress?.({ step: 'runtime-installing' })
    return {
      runtime: await installBundledRuntime(paths, resolved, { activate: options.activate }),
      installed: true,
    }
  }
  const source = await readRuntimeSource(options.sourceFile)
  options.onProgress?.({ step: 'runtime-verifying' })
  await verifyArchiveDigest(resolved, source.sha256)
  return {
    runtime: await withWorkDirectory(paths, (workDirectory) =>
      extractAndInstall(resolved, workDirectory, options, (directory) =>
        installBundledRuntime(paths, directory, { activate: options.activate }),
      ),
    ),
    installed: true,
  }
}

async function useInstalled(
  paths: PascalPaths,
  runtime: ActiveRuntime,
  options: EnsureWebRuntimeOptions,
): Promise<ActiveRuntime> {
  return options.activate === false
    ? runtime
    : activateRuntime(paths, runtime.version, runtime.directory)
}

async function extractAndInstall(
  archiveFile: string,
  workDirectory: string,
  options: EnsureWebRuntimeOptions,
  install: (directory: string) => Promise<ActiveRuntime>,
): Promise<ActiveRuntime> {
  const extracted = path.join(workDirectory, 'runtime')
  options.onProgress?.({ step: 'runtime-extracting' })
  await extractTarGzip(archiveFile, extracted)
  options.onProgress?.({ step: 'runtime-installing' })
  return install(extracted)
}

async function download(
  source: RuntimeSource,
  archiveFile: string,
  options: EnsureWebRuntimeOptions,
): Promise<void> {
  options.onProgress?.({ step: 'runtime-downloading', url: source.url, received: 0, total: null })
  try {
    await downloadToFile(source.url, archiveFile, {
      environment: options.environment ?? process.env,
      onProgress: ({ received, total }) =>
        options.onProgress?.({
          step: 'runtime-downloading',
          url: source.url,
          received,
          total: total ?? source.size,
        }),
    })
  } catch (error) {
    await rm(archiveFile, { force: true })
    throw new CliError(
      'runtime_download_failed',
      [
        `Unable to download the Pascal web runtime ${source.version}.`,
        `  archive: ${source.url}`,
        `  sha256:  ${source.sha256}`,
        `  reason:  ${error instanceof Error ? error.message : String(error)}`,
        'Download that archive on a connected machine, copy it over, then run:',
        `  pascal editor --runtime /path/to/pascal-web-runtime-${source.version}.tar.gz`,
        'HTTPS_PROXY and NO_PROXY are honoured. "pascal mcp connect" needs no web runtime.',
      ].join('\n'),
    )
  }
}

/**
 * Downloads and extraction stay out of `runtime/`: `installRuntimeDirectory` deletes every
 * `.install-*` directory there before it copies, which would race a partial extraction.
 */
async function withWorkDirectory<T>(
  paths: PascalPaths,
  action: (directory: string) => Promise<T>,
): Promise<T> {
  await mkdir(paths.tmp, { recursive: true, mode: 0o700 })
  const workDirectory = await mkdtemp(path.join(paths.tmp, 'runtime-'))
  try {
    return await action(workDirectory)
  } finally {
    await rm(workDirectory, { recursive: true, force: true })
  }
}
