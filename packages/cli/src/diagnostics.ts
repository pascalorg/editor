import { constants } from 'node:fs'
import { access, readdir, stat } from 'node:fs/promises'
import { ensurePascalDirectories, getEditorStatus } from './editor-process.js'
import { readJsonFile } from './json-files.js'
import type { PascalPaths } from './paths.js'

export interface DiagnosticCheck {
  id: string
  status: 'pass' | 'warn' | 'fail'
  message: string
}

export async function runDoctor(paths: PascalPaths): Promise<DiagnosticCheck[]> {
  const checks: DiagnosticCheck[] = []
  const [major = 0, minor = 0] = process.versions.node
    .split('.')
    .slice(0, 2)
    .map((part) => Number.parseInt(part, 10))
  const nodeSupported = major > 22 || (major === 22 && minor >= 13)
  checks.push({
    id: 'node',
    status: nodeSupported ? 'pass' : 'fail',
    message: nodeSupported ? `Node ${process.versions.node}` : 'Node 22.13 or newer is required.',
  })
  try {
    await ensurePascalDirectories(paths)
    await access(paths.root, constants.R_OK | constants.W_OK)
    checks.push({ id: 'storage', status: 'pass', message: `Writable: ${paths.root}` })
    const exposed = []
    for (const directory of [paths.root, paths.data, paths.run, paths.logs]) {
      if (((await stat(directory)).mode & 0o077) !== 0) exposed.push(directory)
    }
    checks.push({
      id: 'permissions',
      status: exposed.length === 0 ? 'pass' : 'warn',
      message:
        exposed.length === 0
          ? 'Local storage is private to the current user.'
          : `Group or other users can access: ${exposed.join(', ')}`,
    })
  } catch (error) {
    checks.push({
      id: 'storage',
      status: 'fail',
      message: error instanceof Error ? error.message : 'Pascal storage is not writable.',
    })
  }
  try {
    const status = await getEditorStatus(paths)
    checks.push({
      id: 'runtime',
      status: status.installed ? 'pass' : 'warn',
      message: status.runtime
        ? `Installed runtime ${status.runtime.version}`
        : 'No runtime installed yet.',
    })
    checks.push({
      id: 'editor',
      status: status.healthy ? 'pass' : status.running ? 'fail' : 'warn',
      message: status.healthy
        ? `Healthy at ${status.state?.url}`
        : status.running
          ? 'A recorded editor process is running but unhealthy.'
          : 'The editor is stopped.',
    })
    const runtimeVersions = (await readdir(paths.runtime, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
    checks.push({
      id: 'runtime-retention',
      status: runtimeVersions.length > 3 ? 'warn' : 'pass',
      message:
        runtimeVersions.length > 3
          ? `${runtimeVersions.length} runtime versions are retained. Review inactive versions if disk space is constrained.`
          : `${runtimeVersions.length} runtime version(s) retained for updates and rollback.`,
    })
  } catch (error) {
    checks.push({
      id: 'runtime',
      status: 'fail',
      message: `Runtime or process state is invalid: ${errorMessage(error)}`,
    })
  }
  try {
    const pluginLock = await readJsonFile<{ plugins?: unknown[] }>(paths.pluginLock)
    checks.push({
      id: 'plugins',
      status: pluginLock && !Array.isArray(pluginLock.plugins) ? 'fail' : 'pass',
      message: pluginLock
        ? `${Array.isArray(pluginLock.plugins) ? pluginLock.plugins.length : 0} plugin(s) in lock.`
        : 'No local plugins installed.',
    })
  } catch (error) {
    checks.push({
      id: 'plugins',
      status: 'fail',
      message: `Plugin state is invalid: ${errorMessage(error)}`,
    })
  }
  return checks
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function collectInfo(paths: PascalPaths) {
  await ensurePascalDirectories(paths)
  const [status, runtimeVersions, pluginLock] = await Promise.all([
    getEditorStatus(paths),
    readdir(paths.runtime).catch(() => [] as string[]),
    readJsonFile<{ schemaVersion?: number; plugins?: unknown[] }>(paths.pluginLock),
  ])
  return {
    cli: { node: process.versions.node, platform: process.platform, arch: process.arch },
    editor: status,
    paths,
    runtimes: runtimeVersions.filter((entry) => !entry.startsWith('.')).sort(),
    plugins: pluginLock?.plugins ?? [],
  }
}
