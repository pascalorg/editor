import { constants } from 'node:fs'
import { access, readdir, stat } from 'node:fs/promises'
import { ensurePascalDirectories, getEditorStatus, pinnedRuntimeVersion } from './editor-process.js'
import { readJsonFile } from './json-files.js'
import { getMcpServiceStatus } from './mcp-service.js'
import type { PascalPaths } from './paths.js'

export interface DiagnosticCheck {
  id: string
  status: 'pass' | 'warn' | 'fail'
  message: string
}

// Mirrors `engines.node` in packages/cli/package.json: ^22.23.4 || ^24.22.1 || >=26.12.1
export function isSupportedNodeVersion(version: string): boolean {
  const [major = 0, minor = 0, patch = 0] = version
    .split('.')
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0)
  const atLeast = (m: number, p: number) => minor > m || (minor === m && patch >= p)
  if (major === 22) return atLeast(23, 4)
  if (major === 24) return atLeast(22, 1)
  if (major === 26) return atLeast(12, 1)
  return major > 26
}

export async function runDoctor(
  paths: PascalPaths,
  options: { runtimeSourceFile?: string } = {},
): Promise<DiagnosticCheck[]> {
  const checks: DiagnosticCheck[] = []
  // Bun reports a Node compatibility version that does not track Node security releases.
  const bun = process.versions.bun
  const nodeSupported = bun !== undefined || isSupportedNodeVersion(process.versions.node)
  checks.push({
    id: 'node',
    status: nodeSupported ? 'pass' : 'fail',
    message: nodeSupported
      ? bun
        ? `Bun ${bun}`
        : `Node ${process.versions.node}`
      : 'Node 22.23.4+ on 22.x, 24.22.1+ on 24.x, or 26.12.1+ is required.',
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
    const [status, mcp, pinned] = await Promise.all([
      getEditorStatus(paths),
      getMcpServiceStatus(paths),
      pinnedRuntimeVersion(options),
    ])
    const outdated = Boolean(status.runtime && pinned && status.runtime.version !== pinned)
    checks.push({
      id: 'runtime',
      status: status.installed && !outdated ? 'pass' : 'warn',
      message: status.runtime
        ? outdated
          ? `Installed web runtime ${status.runtime.version}; this CLI ships ${pinned}. It switches the next time the editor starts ("pascal restart" if it is running, or "pascal update").`
          : `Installed web runtime ${status.runtime.version}`
        : 'No web runtime installed yet. It downloads when the editor first starts.',
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
    checks.push({
      id: 'mcp',
      status: mcp.healthy ? 'pass' : mcp.running ? 'fail' : 'warn',
      message: mcp.healthy
        ? `MCP is healthy on loopback port ${mcp.state?.port}.`
        : mcp.running
          ? 'The managed MCP process is running but unhealthy.'
          : 'MCP is stopped. "pascal mcp connect" starts it on demand.',
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
  const [status, mcp, runtimeVersions, pluginLock] = await Promise.all([
    getEditorStatus(paths),
    getMcpServiceStatus(paths),
    readdir(paths.runtime).catch(() => [] as string[]),
    readJsonFile<{ schemaVersion?: number; plugins?: unknown[] }>(paths.pluginLock),
  ])
  return {
    cli: { node: process.versions.node, platform: process.platform, arch: process.arch },
    editor: status,
    mcp,
    paths,
    runtimes: runtimeVersions.filter((entry) => !entry.startsWith('.')).sort(),
    plugins: pluginLock?.plugins ?? [],
  }
}
