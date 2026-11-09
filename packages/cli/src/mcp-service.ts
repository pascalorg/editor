import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { closeSync, openSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CliError } from './errors.js'
import { withFileLock } from './file-lock.js'
import { readJsonFile, writeJsonFile } from './json-files.js'
import type { PascalPaths } from './paths.js'
import {
  findAvailablePort,
  isProcessRunning,
  processCommand,
  terminateProcess,
  waitForSpawn,
} from './process-control.js'
import { version } from './version.js'

export interface McpServiceState {
  schemaVersion: 1
  pid: number
  port: number
  host: '127.0.0.1'
  url: string
  version: string
  instanceId: string
  servicePath: string
  editorOrigin: string | null
  startedAt: string
}

export interface McpServiceStatus {
  running: boolean
  healthy: boolean
  state: McpServiceState | null
}

export type McpStartProgress =
  | { step: 'mcp-port-ready'; port: number }
  | { step: 'mcp-starting'; port: number }
  | { step: 'mcp-health-checking'; port: number }
  | { step: 'mcp-ready'; port: number }
  | { step: 'mcp-already-running'; port: number }

export interface EnsureMcpServiceOptions {
  paths: PascalPaths
  /**
   * The editor origin the MCP service should format `editorUrl` values against. Omit it when
   * the caller does not run the web editor: a recorded origin is then kept as it is.
   */
  editorOrigin?: string
  foreground?: boolean
  onProgress?: (event: McpStartProgress) => void
}

export interface McpServiceResult {
  state: McpServiceState
  alreadyRunning: boolean
  child?: ChildProcess
}

/**
 * The MCP service is bundled with the CLI itself, not with the downloaded web runtime, so
 * agent tools work before (and without) any editor runtime being installed.
 */
export function resolveMcpServicePath(environment: NodeJS.ProcessEnv = process.env): string {
  if (environment.PASCAL_MCP_SERVICE_PATH) {
    return path.resolve(environment.PASCAL_MCP_SERVICE_PATH)
  }
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
  return path.basename(moduleDirectory) === 'dist'
    ? path.join(moduleDirectory, 'services/pascal-mcp.mjs')
    : path.resolve(moduleDirectory, '../dist/services/pascal-mcp.mjs')
}

export async function getMcpServiceStatus(paths: PascalPaths): Promise<McpServiceStatus> {
  const state = await readJsonFile<McpServiceState>(paths.mcpState)
  if (state?.schemaVersion !== 1 || typeof state.pid !== 'number') {
    return { running: false, healthy: false, state: null }
  }
  const running = isProcessRunning(state.pid)
  return { running, healthy: running ? await checkMcpHealth(paths, state) : false, state }
}

export async function ensureMcpService(
  options: EnsureMcpServiceOptions,
): Promise<McpServiceResult> {
  return withMcpLifecycleLock(options.paths, () => ensureMcpServiceUnlocked(options))
}

export async function stopMcpService(
  paths: PascalPaths,
  options: { force?: boolean } = {},
): Promise<boolean> {
  return withMcpLifecycleLock(paths, () => stopMcpServiceUnlocked(paths, options))
}

async function ensureMcpServiceUnlocked(
  options: EnsureMcpServiceOptions,
): Promise<McpServiceResult> {
  const { paths } = options
  const status = await getMcpServiceStatus(paths)
  if (status.healthy && status.state) {
    const originMatches =
      options.editorOrigin === undefined || options.editorOrigin === status.state.editorOrigin
    if (originMatches) {
      options.onProgress?.({ step: 'mcp-already-running', port: status.state.port })
      return { state: status.state, alreadyRunning: true }
    }
  }
  if (status.running && status.state) {
    if (!(status.healthy || (await matchesRecordedMcpProcess(status.state)))) {
      throw new CliError(
        'state_conflict',
        'A recorded Pascal MCP process is running but its identity could not be verified. Inspect "pascal mcp status --json", then use "pascal stop --force" only if the recorded command is trusted.',
      )
    }
    await terminateProcess(status.state.pid)
  }
  await rm(paths.mcpState, { force: true })
  await rm(paths.mcpToken, { force: true })

  const servicePath = resolveMcpServicePath()
  const port = await findAvailablePort(0)
  const instanceId = randomUUID()
  const token = randomBytes(32).toString('base64url')
  const state: McpServiceState = {
    schemaVersion: 1,
    pid: 0,
    port,
    host: '127.0.0.1',
    url: `http://127.0.0.1:${port}/mcp`,
    version,
    instanceId,
    servicePath,
    editorOrigin: options.editorOrigin ?? null,
    startedAt: new Date().toISOString(),
  }
  options.onProgress?.({ step: 'mcp-port-ready', port })
  await Promise.all(
    [paths.run, paths.logs, paths.data].map((directory) =>
      mkdir(directory, { recursive: true, mode: 0o700 }),
    ),
  )
  await writeFile(paths.mcpToken, `${token}\n`, { mode: 0o600 })

  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    PASCAL_DATA_DIR: paths.data,
    PASCAL_INSTANCE_ID: instanceId,
    PASCAL_RUNTIME_VERSION: version,
    PASCAL_MCP_HTTP_TOKEN: token,
    ...(state.editorOrigin ? { PASCAL_EDITOR_ORIGIN: state.editorOrigin } : {}),
  }
  const nodeBinary = process.env.PASCAL_NODE_BINARY || 'node'
  const logDescriptor = options.foreground ? undefined : openSync(paths.editorLog, 'a', 0o600)
  options.onProgress?.({ step: 'mcp-starting', port })
  const child = spawn(
    nodeBinary,
    [servicePath, '--http', '--host', state.host, '--port', String(port)],
    {
      cwd: path.dirname(servicePath),
      env: environment,
      detached: !options.foreground,
      stdio: options.foreground
        ? ['ignore', 'inherit', 'inherit']
        : ['ignore', logDescriptor!, logDescriptor!],
    },
  )
  if (logDescriptor !== undefined) closeSync(logDescriptor)
  try {
    await waitForSpawn(child, nodeBinary)
    if (!child.pid) throw new CliError('start_failed', 'The Pascal MCP process did not start.')
    state.pid = child.pid
    await writeJsonFile(paths.mcpState, state)
    if (!options.foreground) child.unref()
    options.onProgress?.({ step: 'mcp-health-checking', port })
    await waitForMcpHealth(paths, state, 20_000)
    options.onProgress?.({ step: 'mcp-ready', port })
  } catch (error) {
    if (child.pid) await terminateProcess(child.pid)
    await rm(paths.mcpState, { force: true })
    await rm(paths.mcpToken, { force: true })
    throw error
  }
  return { state, alreadyRunning: false, child: options.foreground ? child : undefined }
}

async function stopMcpServiceUnlocked(
  paths: PascalPaths,
  options: { force?: boolean },
): Promise<boolean> {
  const status = await getMcpServiceStatus(paths)
  if (!status.state || !status.running) {
    await rm(paths.mcpState, { force: true })
    await rm(paths.mcpToken, { force: true })
    return false
  }
  if (!(status.healthy || (options.force && (await matchesRecordedMcpProcess(status.state))))) {
    throw new CliError(
      'state_conflict',
      options.force
        ? 'Refusing to stop a process whose health identity and operating-system command do not match the recorded Pascal MCP service.'
        : 'The Pascal MCP identity is unavailable. Inspect "pascal mcp status --json", then use "pascal stop --force" only if the recorded command is trusted.',
    )
  }
  await terminateProcess(status.state.pid)
  await rm(paths.mcpState, { force: true })
  await rm(paths.mcpToken, { force: true })
  return true
}

export async function checkMcpHealth(paths: PascalPaths, state: McpServiceState): Promise<boolean> {
  return (await probeMcpHealth(paths, state)) === 'healthy'
}

async function probeMcpHealth(
  paths: PascalPaths,
  state: McpServiceState,
): Promise<'healthy' | 'foreign' | 'unreachable'> {
  let token: string
  try {
    token = (await readFile(paths.mcpToken, 'utf8')).trim()
  } catch {
    return 'unreachable'
  }
  if (!token) return 'unreachable'
  try {
    const response = await fetch(`http://127.0.0.1:${state.port}/health`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(1_000),
    })
    if (!response.ok) return 'foreign'
    const body = (await response.json()) as {
      status?: string
      app?: string
      version?: string
      instanceId?: string
    }
    return body.status === 'ok' &&
      body.app === 'mcp' &&
      body.version === state.version &&
      body.instanceId === state.instanceId
      ? 'healthy'
      : 'foreign'
  } catch {
    return 'unreachable'
  }
}

async function waitForMcpHealth(
  paths: PascalPaths,
  state: McpServiceState,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const health = await probeMcpHealth(paths, state)
    if (health === 'healthy') return
    if (health === 'foreign') {
      throw new CliError(
        'port_conflict',
        `Port ${state.port} is responding as another application. Run the command again to choose another port.`,
      )
    }
    if (!isProcessRunning(state.pid)) {
      throw new CliError('start_failed', 'Pascal MCP exited before becoming healthy.')
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new CliError('health_timeout', `Pascal MCP did not become healthy within ${timeoutMs}ms.`)
}

async function matchesRecordedMcpProcess(state: McpServiceState): Promise<boolean> {
  if (process.platform === 'win32') return false
  const servicePath = path.resolve(state.servicePath)
  if (path.basename(servicePath) !== 'pascal-mcp.mjs') return false
  return (await processCommand(state.pid)).includes(servicePath)
}

async function withMcpLifecycleLock<T>(paths: PascalPaths, action: () => Promise<T>): Promise<T> {
  return withFileLock(
    path.join(paths.run, 'mcp-lifecycle.lock'),
    'mcp_locked',
    'Another Pascal MCP lifecycle operation is active.',
    action,
    { timeoutMs: 30_000 },
  )
}
