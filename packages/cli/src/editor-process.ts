import { type ChildProcess, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, openSync } from 'node:fs'
import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { CliError } from './errors.js'
import { withFileLock } from './file-lock.js'
import { readJsonFile, writeJsonFile } from './json-files.js'
import {
  ensureMcpService,
  type McpServiceState,
  type McpStartProgress,
  stopMcpService,
} from './mcp-service.js'
import type { PascalPaths } from './paths.js'
import {
  errorMessage,
  findAvailablePort,
  isProcessRunning,
  processCommand,
  terminateProcess,
  waitForSpawn,
} from './process-control.js'
import {
  type ActiveRuntime,
  activateRuntime,
  readActiveRuntime,
  readRuntimeManifest,
} from './runtime.js'
import { ensureWebRuntime, type RuntimeProvisionProgress } from './runtime-download.js'

export interface EditorState {
  schemaVersion: 1
  pid: number
  version: string
  port: number
  host: '127.0.0.1'
  url: string
  instanceId: string
  runtimeDirectory: string
  startedAt: string
}

export interface EditorStatus {
  installed: boolean
  running: boolean
  healthy: boolean
  state: EditorState | null
  runtime: ActiveRuntime | null
}

export interface StartEditorOptions {
  paths: PascalPaths
  port?: number
  foreground?: boolean
  /** A web-runtime directory or `.tar.gz` archive to install instead of downloading one. */
  runtimeSource?: string
  onProgress?: (event: EditorStartProgress) => void
}

export type EditorStartProgress =
  | { step: 'storage-ready'; dataDirectory: string }
  | { step: 'runtime-ready'; version: string; installed: boolean }
  | { step: 'port-ready'; port: number; preferredPort: number }
  | { step: 'process-starting'; port: number }
  | { step: 'health-checking'; port: number }
  | { step: 'ready'; port: number }
  | { step: 'already-running'; port: number }
  | RuntimeProvisionProgress
  | McpStartProgress

export interface StartEditorResult {
  state: EditorState
  mcp: McpServiceState
  alreadyRunning: boolean
  child?: ChildProcess
}

export interface StopEditorOptions {
  force?: boolean
}

export interface RuntimeActivationResult {
  runtime: ActiveRuntime
  restarted: boolean
}

export async function ensurePascalDirectories(paths: PascalPaths): Promise<void> {
  await Promise.all(
    [paths.root, paths.runtime, paths.data, paths.plugins, paths.run, paths.logs, paths.tmp].map(
      (directory) => mkdir(directory, { recursive: true, mode: 0o700 }),
    ),
  )
}

export async function getEditorStatus(paths: PascalPaths): Promise<EditorStatus> {
  const [runtime, state] = await Promise.all([
    readActiveRuntime(paths),
    readJsonFile<EditorState>(paths.state),
  ])
  if (state?.schemaVersion !== 1 || typeof state.pid !== 'number') {
    return { installed: Boolean(runtime), running: false, healthy: false, state: null, runtime }
  }
  const running = isProcessRunning(state.pid)
  return {
    installed: Boolean(runtime),
    running,
    healthy: running ? await checkHealth(state) : false,
    state,
    runtime,
  }
}

export async function startEditor(options: StartEditorOptions): Promise<StartEditorResult> {
  return withEditorLifecycleLock(options.paths, () => startEditorUnlocked(options))
}

async function startEditorUnlocked(options: StartEditorOptions): Promise<StartEditorResult> {
  await ensurePascalDirectories(options.paths)
  options.onProgress?.({ step: 'storage-ready', dataDirectory: options.paths.data })
  let currentStatus: EditorStatus
  try {
    currentStatus = await getEditorStatus(options.paths)
  } catch (error) {
    if (!(error instanceof CliError) || error.code !== 'invalid_runtime') throw error
    await stopEditorUnlocked(options.paths, { force: true })
    await rm(options.paths.currentRuntime, { force: true })
    currentStatus = await getEditorStatus(options.paths)
  }
  if (currentStatus.healthy && currentStatus.state) {
    const mcp = await ensureMcpService({
      paths: options.paths,
      editorOrigin: currentStatus.state.url,
      onProgress: options.onProgress,
    })
    options.onProgress?.({ step: 'already-running', port: currentStatus.state.port })
    return { state: currentStatus.state, mcp: mcp.state, alreadyRunning: true }
  }
  if (currentStatus.running) {
    throw new CliError(
      'state_conflict',
      'A recorded Pascal editor process is running but its identity could not be verified. Inspect "pascal status --json", then use "pascal stop --force" only if the recorded command is trusted.',
    )
  }
  await rm(options.paths.state, { force: true })

  let runtime = await readActiveRuntime(options.paths)
  let installedRuntime = false
  if (!runtime || options.runtimeSource) {
    const provisioned = await ensureWebRuntime({
      paths: options.paths,
      runtimeSource: options.runtimeSource,
      onProgress: options.onProgress,
    })
    runtime = provisioned.runtime
    installedRuntime = provisioned.installed
  }
  options.onProgress?.({
    step: 'runtime-ready',
    version: runtime.version,
    installed: installedRuntime,
  })
  const manifest = await readRuntimeManifest(runtime.directory)
  const serverPath = path.resolve(runtime.directory, manifest.entrypoint)
  const preferredPort = options.port ?? 0
  const port = await findAvailablePort(preferredPort)
  options.onProgress?.({ step: 'port-ready', port, preferredPort })
  const instanceId = randomUUID()
  const state: EditorState = {
    schemaVersion: 1,
    pid: 0,
    version: runtime.version,
    port,
    host: '127.0.0.1',
    url: `http://pascal.localhost:${port}`,
    instanceId,
    runtimeDirectory: runtime.directory,
    startedAt: new Date().toISOString(),
  }

  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    HOSTNAME: state.host,
    PORT: String(port),
    PASCAL_DATA_DIR: options.paths.data,
    PASCAL_INSTANCE_ID: instanceId,
    PASCAL_RUNTIME_VERSION: runtime.version,
    MINT_PASCAL_HOST_ORIGIN: process.env.MINT_PASCAL_HOST_ORIGIN || state.url,
  }
  const nodeBinary = process.env.PASCAL_NODE_BINARY || 'node'
  if (!options.foreground) await rotateEditorLog(options.paths.editorLog)
  const logDescriptor = options.foreground
    ? undefined
    : openSync(options.paths.editorLog, 'a', 0o600)
  options.onProgress?.({ step: 'process-starting', port })
  const child = spawn(nodeBinary, [serverPath], {
    cwd: path.dirname(serverPath),
    env: environment,
    detached: !options.foreground,
    stdio: options.foreground ? 'inherit' : ['ignore', logDescriptor!, logDescriptor!],
  })
  if (logDescriptor !== undefined) closeSync(logDescriptor)

  let mcp: McpServiceState
  try {
    await waitForSpawn(child, nodeBinary)
    if (!child.pid) throw new CliError('start_failed', 'The Pascal editor process did not start.')
    state.pid = child.pid
    await writeJsonFile(options.paths.state, state)
    if (!options.foreground) child.unref()
    options.onProgress?.({ step: 'health-checking', port })
    await waitForHealth(state, 30_000)
    mcp = (
      await ensureMcpService({
        paths: options.paths,
        editorOrigin: state.url,
        foreground: options.foreground,
        onProgress: options.onProgress,
      })
    ).state
    options.onProgress?.({ step: 'ready', port })
  } catch (error) {
    if (child.pid) await terminateProcess(child.pid)
    await rm(options.paths.state, { force: true })
    throw error
  }
  return { state, mcp, alreadyRunning: false, child: options.foreground ? child : undefined }
}

export async function stopEditor(
  paths: PascalPaths,
  options: StopEditorOptions = {},
): Promise<boolean> {
  const editorStopped = await withEditorLifecycleLock(paths, () =>
    stopEditorUnlocked(paths, options),
  )
  const mcpStopped = await stopMcpService(paths, options)
  return editorStopped || mcpStopped
}

async function stopEditorUnlocked(
  paths: PascalPaths,
  options: StopEditorOptions = {},
): Promise<boolean> {
  const state = await readJsonFile<EditorState>(paths.state)
  if (!state || !isProcessRunning(state.pid)) {
    await rm(paths.state, { force: true })
    return false
  }
  const identified =
    (await checkHealth(state)) ||
    (options.force && (await matchesRecordedEditorProcess(paths, state)))
  if (!identified) {
    throw new CliError(
      'state_conflict',
      options.force
        ? 'Refusing to stop a process whose health identity and operating-system command do not match the recorded Pascal runtime.'
        : 'The Pascal editor identity is unavailable. Inspect "pascal status --json", then use "pascal stop --force" only if the recorded command is trusted.',
    )
  }
  await terminateProcess(state.pid)
  await rm(paths.state, { force: true })
  return true
}

export async function restartEditor(paths: PascalPaths): Promise<StartEditorResult> {
  return withEditorLifecycleLock(paths, async () => {
    const previousPort = (await readJsonFile<EditorState>(paths.state))?.port
    await stopEditorUnlocked(paths)
    return startEditorUnlocked({ paths, port: previousPort })
  })
}

export async function activateEditorRuntime(
  paths: PascalPaths,
  candidate: ActiveRuntime,
): Promise<RuntimeActivationResult> {
  return withEditorLifecycleLock(paths, async () => {
    let previousRuntime: ActiveRuntime | null = null
    let previousRuntimeWasInvalid = false
    try {
      previousRuntime = await readActiveRuntime(paths)
    } catch (error) {
      if (!(error instanceof CliError) || error.code !== 'invalid_runtime') throw error
      previousRuntimeWasInvalid = true
    }
    let previousStatus: EditorStatus
    if (previousRuntimeWasInvalid) {
      const state = await readJsonFile<EditorState>(paths.state)
      const running = Boolean(state && isProcessRunning(state.pid))
      previousStatus = {
        installed: false,
        running,
        healthy: Boolean(state && running && (await checkHealth(state))),
        state: state ?? null,
        runtime: null,
      }
    } else {
      previousStatus = await getEditorStatus(paths)
    }
    if (previousStatus.running && !previousStatus.healthy) {
      throw new CliError(
        'state_conflict',
        'A recorded Pascal editor process is running but its identity could not be verified. Recover or stop it before updating.',
      )
    }
    if (
      previousRuntime?.version === candidate.version &&
      previousRuntime.directory === candidate.directory
    ) {
      return { runtime: previousRuntime, restarted: false }
    }

    const wasRunning = previousStatus.running
    const previousPort = previousStatus.state?.port
    if (wasRunning) await stopEditorUnlocked(paths)

    try {
      await activateRuntime(paths, candidate.version, candidate.directory)
      await startEditorUnlocked({ paths, port: previousPort })
      if (!wasRunning) {
        await stopEditorUnlocked(paths)
        await stopMcpService(paths)
      }
      return { runtime: candidate, restarted: wasRunning }
    } catch (error) {
      try {
        await stopEditorUnlocked(paths, { force: true })
        await stopMcpService(paths, { force: true })
      } catch {}
      let rollbackError: unknown
      if (previousRuntime) {
        try {
          await activateRuntime(paths, previousRuntime.version, previousRuntime.directory)
        } catch (activationError) {
          rollbackError = activationError
          await rm(paths.currentRuntime, { force: true })
        }
      } else {
        await rm(paths.currentRuntime, { force: true })
      }
      if (!rollbackError && wasRunning && previousRuntime) {
        try {
          await startEditorUnlocked({ paths, port: previousPort })
        } catch (restartError) {
          rollbackError = restartError
        }
      }
      if (rollbackError) {
        throw new CliError('update_failed', 'The candidate and rollback runtimes both failed.', {
          candidateError: errorMessage(error),
          rollbackError: errorMessage(rollbackError),
        })
      }
      throw new CliError(
        'update_failed',
        previousRuntime
          ? 'The candidate runtime failed; the previous runtime was restored.'
          : 'The candidate runtime failed and no valid previous runtime was available.',
        {
          candidateError: errorMessage(error),
        },
      )
    }
  })
}

export async function readLogTail(filePath: string, lines = 100): Promise<string> {
  try {
    const fileSize = (await stat(filePath)).size
    const length = Math.min(fileSize, 8 * 1024 * 1024)
    const handle = await open(filePath, 'r')
    const buffer = Buffer.alloc(length)
    try {
      await handle.read(buffer, 0, length, fileSize - length)
    } finally {
      await handle.close()
    }
    return buffer
      .toString('utf8')
      .split(/\r?\n/)
      .slice(-Math.max(1, lines) - 1)
      .join('\n')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

export async function followLog(filePath: string): Promise<never> {
  let offset = 0
  try {
    offset = (await stat(filePath)).size
  } catch {}
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    try {
      const size = (await stat(filePath)).size
      if (size < offset) offset = 0
      if (size === offset) continue
      const handle = await open(filePath, 'r')
      const buffer = Buffer.alloc(Math.min(size - offset, 1024 * 1024))
      try {
        await handle.read(buffer, 0, buffer.length, offset)
      } finally {
        await handle.close()
      }
      process.stdout.write(buffer)
      offset += buffer.length
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      offset = 0
    }
  }
}

async function checkHealth(state: EditorState): Promise<boolean> {
  return (await probeHealth(state)) === 'healthy'
}

async function probeHealth(state: EditorState): Promise<'healthy' | 'foreign' | 'unreachable'> {
  try {
    const response = await fetch(`http://127.0.0.1:${state.port}/api/health`, {
      signal: AbortSignal.timeout(1_000),
    })
    if (!response.ok) return 'foreign'
    let body: {
      status?: string
      app?: string
      version?: string
      instanceId?: string
    }
    try {
      body = (await response.json()) as typeof body
    } catch {
      return 'foreign'
    }
    return body.status === 'ok' &&
      body.app === 'editor' &&
      body.version === state.version &&
      body.instanceId === state.instanceId
      ? 'healthy'
      : 'foreign'
  } catch {
    return 'unreachable'
  }
}

export async function waitForHealth(state: EditorState, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const health = await probeHealth(state)
    if (health === 'healthy') return
    if (health === 'foreign') {
      throw new CliError(
        'port_conflict',
        `Port ${state.port} is responding as another application. Run Pascal again to choose another port, or pass --port <n>.`,
      )
    }
    if (!isProcessRunning(state.pid)) {
      throw new CliError('start_failed', 'The Pascal editor exited before becoming healthy.')
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new CliError('health_timeout', `Pascal did not become healthy within ${timeoutMs}ms.`)
}

async function withEditorLifecycleLock<T>(
  paths: PascalPaths,
  action: () => Promise<T>,
): Promise<T> {
  return withFileLock(
    path.join(paths.run, 'editor-lifecycle.lock'),
    'editor_locked',
    'Another Pascal editor lifecycle operation is active.',
    action,
  )
}

async function matchesRecordedEditorProcess(
  paths: PascalPaths,
  state: EditorState,
): Promise<boolean> {
  if (process.platform === 'win32') return false
  const runtimeDirectory = path.resolve(state.runtimeDirectory)
  if (!runtimeDirectory.startsWith(`${path.resolve(paths.runtime)}${path.sep}`)) return false
  let expectedEntrypoint: string
  try {
    const manifest = await readRuntimeManifest(runtimeDirectory)
    expectedEntrypoint = path.resolve(runtimeDirectory, manifest.entrypoint)
  } catch {
    expectedEntrypoint = path.join(runtimeDirectory, 'apps/editor/server.js')
  }
  const command = await processCommand(state.pid)
  return command.includes(expectedEntrypoint)
}

async function rotateEditorLog(filePath: string): Promise<void> {
  try {
    if ((await stat(filePath)).size <= 10 * 1024 * 1024) return
    const previousPath = `${filePath}.1`
    await rm(previousPath, { force: true })
    await rename(filePath, previousPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
