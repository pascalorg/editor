import { cp, mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { CliError } from './errors.js'
import { withFileLock } from './file-lock.js'
import { readJsonFile, writeJsonFile } from './json-files.js'
import type { PascalPaths } from './paths.js'

export interface RuntimeManifest {
  schemaVersion: 2
  version: string
  entrypoint: string
}

export interface ActiveRuntime {
  schemaVersion: 1
  version: string
  directory: string
}

export async function readRuntimeManifest(directory: string): Promise<RuntimeManifest> {
  let manifest: RuntimeManifest | null
  try {
    manifest = await readJsonFile<RuntimeManifest>(path.join(directory, 'runtime-manifest.json'))
  } catch {
    throw new CliError('invalid_runtime', `Invalid Pascal runtime at ${directory}.`)
  }
  if (
    manifest?.schemaVersion !== 2 ||
    typeof manifest.version !== 'string' ||
    typeof manifest.entrypoint !== 'string'
  ) {
    throw new CliError('invalid_runtime', `Invalid Pascal runtime at ${directory}.`)
  }
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(manifest.version)) {
    throw new CliError('invalid_runtime', `Invalid runtime version: ${manifest.version}`)
  }
  const entrypoint = path.resolve(directory, manifest.entrypoint)
  if (!entrypoint.startsWith(`${path.resolve(directory)}${path.sep}`)) {
    throw new CliError(
      'invalid_runtime',
      'The runtime entrypoint escapes the installation directory.',
    )
  }
  try {
    if (!(await stat(entrypoint)).isFile()) throw new Error('not a file')
  } catch {
    throw new CliError('invalid_runtime', `Runtime entrypoint is missing: ${entrypoint}`)
  }
  return manifest
}

/**
 * Serializes runtime installation across processes. `ensureWebRuntime` holds this lock for
 * the whole download so a concurrent first run waits for its peer instead of downloading
 * the same archive twice, which is why the timeout is caller-controlled.
 */
export async function withRuntimeInstallLock<T>(
  paths: PascalPaths,
  action: () => Promise<T>,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  return withFileLock(
    path.join(paths.run, 'runtime-install.lock'),
    'install_locked',
    'Another Pascal runtime installation is active.',
    action,
    options,
  )
}

export async function installBundledRuntime(
  paths: PascalPaths,
  sourceDirectory: string,
  options: { activate?: boolean } = {},
): Promise<ActiveRuntime> {
  return withRuntimeInstallLock(paths, () =>
    installRuntimeDirectory(paths, sourceDirectory, options),
  )
}

/** Requires `withRuntimeInstallLock`; call `installBundledRuntime` when no lock is held. */
export async function installRuntimeDirectory(
  paths: PascalPaths,
  sourceDirectory: string,
  options: { activate?: boolean } = {},
): Promise<ActiveRuntime> {
  const sourceManifest = await readRuntimeManifest(sourceDirectory)
  const targetDirectory = path.join(paths.runtime, sourceManifest.version)
  await mkdir(paths.runtime, { recursive: true, mode: 0o700 })
  await removeAbandonedInstallDirectories(paths.runtime)
  const installed = await readInstalledManifest(targetDirectory)
  if (
    installed?.version === sourceManifest.version &&
    (await isRuntimeValid(targetDirectory, sourceManifest.version))
  ) {
    return options.activate === false
      ? runtimeRecord(sourceManifest.version, targetDirectory)
      : activateRuntime(paths, sourceManifest.version, targetDirectory)
  }
  const temporaryDirectory = path.join(
    paths.runtime,
    `.install-${sourceManifest.version}-${process.pid}`,
  )
  await rm(temporaryDirectory, { recursive: true, force: true })
  await cp(sourceDirectory, temporaryDirectory, { recursive: true, dereference: false })
  await readRuntimeManifest(temporaryDirectory)
  await rm(targetDirectory, { recursive: true, force: true })
  await rename(temporaryDirectory, targetDirectory)
  return options.activate === false
    ? runtimeRecord(sourceManifest.version, targetDirectory)
    : activateRuntime(paths, sourceManifest.version, targetDirectory)
}

export async function readActiveRuntime(paths: PascalPaths): Promise<ActiveRuntime | null> {
  let active: ActiveRuntime | null
  try {
    active = await readJsonFile<ActiveRuntime>(paths.currentRuntime)
  } catch {
    throw new CliError('invalid_runtime', 'The active runtime pointer is not valid JSON.')
  }
  if (
    active?.schemaVersion !== 1 ||
    typeof active.version !== 'string' ||
    typeof active.directory !== 'string'
  ) {
    return null
  }
  const resolvedDirectory = path.resolve(active.directory)
  if (!resolvedDirectory.startsWith(`${path.resolve(paths.runtime)}${path.sep}`)) {
    throw new CliError('invalid_runtime', 'The active runtime is outside Pascal runtime storage.')
  }
  const manifest = await readRuntimeManifest(resolvedDirectory)
  if (manifest.version !== active.version) {
    throw new CliError('invalid_runtime', 'The active runtime version does not match its manifest.')
  }
  return active
}

export async function activateRuntime(
  paths: PascalPaths,
  version: string,
  directory: string,
): Promise<ActiveRuntime> {
  const resolvedDirectory = path.resolve(directory)
  if (!resolvedDirectory.startsWith(`${path.resolve(paths.runtime)}${path.sep}`)) {
    throw new CliError('invalid_runtime', 'Cannot activate a runtime outside Pascal storage.')
  }
  const manifest = await readRuntimeManifest(resolvedDirectory)
  if (manifest.version !== version) {
    throw new CliError('invalid_runtime', 'Cannot activate a runtime with a mismatched version.')
  }
  const active: ActiveRuntime = { schemaVersion: 1, version, directory: resolvedDirectory }
  await writeJsonFile(paths.currentRuntime, active)
  return active
}

export async function findInstalledRuntime(
  paths: PascalPaths,
  version: string,
): Promise<ActiveRuntime | null> {
  const directory = path.join(paths.runtime, version)
  return (await isRuntimeValid(directory, version)) ? runtimeRecord(version, directory) : null
}

function runtimeRecord(version: string, directory: string): ActiveRuntime {
  return { schemaVersion: 1, version, directory }
}

async function isRuntimeValid(directory: string, version: string): Promise<boolean> {
  try {
    return (await readRuntimeManifest(directory)).version === version
  } catch {
    return false
  }
}

async function readInstalledManifest(directory: string): Promise<RuntimeManifest | null> {
  try {
    return await readJsonFile<RuntimeManifest>(path.join(directory, 'runtime-manifest.json'))
  } catch {
    return null
  }
}

async function removeAbandonedInstallDirectories(runtimeDirectory: string): Promise<void> {
  const entries = await readdir(runtimeDirectory, { withFileTypes: true })
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('.install-'))
      .map((entry) =>
        rm(path.join(runtimeDirectory, entry.name), { recursive: true, force: true }),
      ),
  )
}
