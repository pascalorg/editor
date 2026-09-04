import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { closeSync, openSync } from 'node:fs'
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { CliError } from './errors.js'
import { withFileLock } from './file-lock.js'
import { readJsonFile, writeJsonFile } from './json-files.js'
import type { PascalPaths } from './paths.js'
import {
  type ActiveRuntime,
  activateRuntime,
  installBundledRuntime,
  readActiveRuntime,
  readRuntimeManifest,
} from './runtime.js'

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
  mcp?: McpState
}

export interface McpState {
  pid: number
  port: number
  host: '127.0.0.1'
  url: string
}

export interface EditorStatus {
  installed: boolean
  running: boolean
  healthy: boolean
  state: EditorState | null
  runtime: ActiveRuntime | null
  components: {
    editor: { running: boolean; healthy: boolean }
    mcp: { running: boolean; healthy: boolean }
  }
}

export interface StartEditorOptions {
  paths: PascalPaths
  port?: number
  foreground?: boolean
  sourceDirectory?: string
  onProgress?: (event: EditorStartProgress) => void
}

export type EditorStartProgress =
  | { step: 'storage-ready'; dataDirectory: string }
  | { step: 'runtime-installing' }
  | { step: 'runtime-ready'; version: string; installed: boolean }
  | { step: 'port-ready'; port: number; preferredPort: number }
  | { step: 'process-starting'; port: number }
  | { step: 'health-checking'; port: number }
  | { step: 'mcp-port-ready'; port: number }
  | { step: 'mcp-starting'; port: number }
  | { step: 'mcp-health-checking'; port: number }
  | { step: 'ready'; port: number }
  | { step: 'already-running'; port: number }

export interface StartEditorResult {
  state: EditorState
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
    [paths.root, paths.runtime, paths.data, paths.plugins, paths.run, paths.logs].map((directory) =>
      mkdir(directory, { recursive: true, mode: 0o700 }),
    ),
  )
}

export async function getEditorStatus(paths: PascalPaths): Promise<EditorStatus> {
  const [runtime, state] = await Promise.all([
    readActiveRuntime(paths),
    readJsonFile<EditorState>(paths.state),
  ])
  if (state?.schemaVersion !== 1 || typeof state.pid !== 'number') {
    return {
      installed: Boolean(runtime),
      running: false,
      healthy: false,
      state: null,
      runtime,
      components: {
        editor: { running: false, healthy: false },
        mcp: { running: false, healthy: false },
      },
    }
  }
  const editorRunning = isProcessRunning(state.pid)
  const mcpRunning = Boolean(state.mcp && isProcessRunning(state.mcp.pid))
  const [editorHealthy, mcpHealthy] = await Promise.all([
    editorRunning ? checkHealth(state) : false,
    mcpRunning ? checkMcpHealth(paths, state) : false,
  ])
  return {
    installed: Boolean(runtime),
    running: editorRunning || mcpRunning,
    healthy: editorHealthy && mcpHealthy,
    state,
    runtime,
    components: {
      editor: { running: editorRunning, healthy: editorHealthy },
      mcp: { running: mcpRunning, healthy: mcpHealthy },
    },
  }
}

export async function startEditor(options: StartEditorOptions): Promise<StartEditorResult> {
  return withEditorLifecycleLock(options.paths, () => startEditorUnlocked(options))
}

async function startEditorUnlocked(options: StartEditorOptions): Promise<StartEditorResult> {
  await ensurePascalDirectories(options.paths)
  options.onProgress?.({ step: 'storage-ready', dataDirectory: options.paths.data })
  let installedRuntime = false
  let currentStatus: EditorStatus
  try {
    currentStatus = await getEditorStatus(options.paths)
  } catch (error) {
    if (!(error instanceof CliError) || error.code !== 'invalid_runtime') throw error
    await stopEditorUnlocked(options.paths, { force: true })
    await rm(options.paths.currentRuntime, { force: true })
    options.onProgress?.({ step: 'runtime-installing' })
    await installBundledRuntime(options.paths, options.sourceDirectory)
    installedRuntime = true
    currentStatus = await getEditorStatus(options.paths)
  }
  if (currentStatus.healthy && currentStatus.state) {
    options.onProgress?.({ step: 'already-running', port: currentStatus.state.port })
    return { state: currentStatus.state, alreadyRunning: true }
  }
  if (currentStatus.running && currentStatus.state) {
    if (!statusComponentsAreIdentified(currentStatus)) {
      throw new CliError(
        'state_conflict',
        'A recorded Pascal process is running but its identity could not be verified.',
      )
    }
    await stopEditorUnlocked(options.paths)
  }
  await rm(options.paths.state, { force: true })
  await rm(options.paths.mcpToken, { force: true })

  let runtime = await readActiveRuntime(options.paths)
  if (!runtime) {
    options.onProgress?.({ step: 'runtime-installing' })
    runtime = await installBundledRuntime(options.paths, options.sourceDirectory)
    installedRuntime = true
  }
  options.onProgress?.({
    step: 'runtime-ready',
    version: runtime.version,
    installed: installedRuntime,
  })
  const manifest = await readRuntimeManifest(runtime.directory)
  const serverPath = path.resolve(runtime.directory, manifest.entrypoint)
  const mcpPath = path.resolve(runtime.directory, manifest.mcpEntrypoint)
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
    MINT_PASCAL_HOST_ORIGIN: state.url,
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

  let mcpChild: ChildProcess | undefined
  try {
    await waitForSpawn(child, nodeBinary)
    if (!child.pid) throw new CliError('start_failed', 'The Pascal editor process did not start.')
    state.pid = child.pid
    await writeJsonFile(options.paths.state, state)
    if (!options.foreground) child.unref()
    options.onProgress?.({ step: 'health-checking', port })
    await waitForHealth(state, 30_000)

    const mcpPort = await findAvailablePort(0)
    const mcpToken = randomBytes(32).toString('base64url')
    await rm(options.paths.mcpToken, { force: true })
    await writeFile(options.paths.mcpToken, `${mcpToken}\n`, { mode: 0o600 })
    state.mcp = {
      pid: 0,
      port: mcpPort,
      host: '127.0.0.1',
      url: `http://127.0.0.1:${mcpPort}/mcp`,
    }
    options.onProgress?.({ step: 'mcp-port-ready', port: mcpPort })
    const mcpEnvironment: NodeJS.ProcessEnv = {
      ...environment,
      PASCAL_EDITOR_ORIGIN: state.url,
      PASCAL_MCP_HTTP_TOKEN: mcpToken,
      PASCAL_MCP_VERSION: runtime.version,
    }
    const mcpLogDescriptor = options.foreground
      ? undefined
      : openSync(options.paths.editorLog, 'a', 0o600)
    options.onProgress?.({ step: 'mcp-starting', port: mcpPort })
    mcpChild = spawn(
      nodeBinary,
      [mcpPath, '--http', '--host', state.mcp.host, '--port', String(mcpPort)],
      {
        cwd: path.dirname(mcpPath),
        env: mcpEnvironment,
        detached: !options.foreground,
        stdio: options.foreground
          ? ['ignore', 'inherit', 'inherit']
          : ['ignore', mcpLogDescriptor!, mcpLogDescriptor!],
      },
    )
    if (mcpLogDescriptor !== undefined) closeSync(mcpLogDescriptor)
    await waitForSpawn(mcpChild, nodeBinary)
    if (!mcpChild.pid) throw new CliError('start_failed', 'The Pascal MCP process did not start.')
    state.mcp.pid = mcpChild.pid
    await writeJsonFile(options.paths.state, state)
    if (!options.foreground) mcpChild.unref()
    options.onProgress?.({ step: 'mcp-health-checking', port: mcpPort })
    await waitForMcpHealth(options.paths, state, 10_000)
    options.onProgress?.({ step: 'ready', port })
  } catch (error) {
    if (mcpChild?.pid) await terminateProcess(mcpChild.pid)
    if (child.pid) await terminateProcess(child.pid)
    await rm(options.paths.state, { force: true })
    await rm(options.paths.mcpToken, { force: true })
    throw error
  }
  return { state, alreadyRunning: false, child: options.foreground ? child : undefined }
}

export async function stopEditor(
  paths: PascalPaths,
  options: StopEditorOptions = {},
): Promise<boolean> {
  return withEditorLifecycleLock(paths, () => stopEditorUnlocked(paths, options))
}

async function stopEditorUnlocked(
  paths: PascalPaths,
  options: StopEditorOptions = {},
): Promise<boolean> {
  const state = await readJsonFile<EditorState>(paths.state)
  const editorRunning = Boolean(state && isProcessRunning(state.pid))
  const mcpRunning = Boolean(state?.mcp && isProcessRunning(state.mcp.pid))
  if (!state || (!editorRunning && !mcpRunning)) {
    await rm(paths.state, { force: true })
    await rm(paths.mcpToken, { force: true })
    return false
  }
  const [editorHealthy, mcpHealthy] = await Promise.all([
    editorRunning ? checkHealth(state) : true,
    mcpRunning ? checkMcpHealth(paths, state) : true,
  ])
  const editorIdentified =
    editorHealthy ||
    (options.force && editorRunning && (await matchesRecordedEditorProcess(paths, state)))
  const mcpIdentified =
    mcpHealthy || (options.force && mcpRunning && (await matchesRecordedMcpProcess(paths, state)))
  if (!editorIdentified || !mcpIdentified) {
    throw new CliError(
      'state_conflict',
      options.force
        ? 'Refusing to stop a process whose health identity and operating-system command do not match the recorded Pascal runtime.'
        : 'A Pascal process identity is unavailable. Inspect "pascal status --json", then use "pascal stop --force" only if the recorded commands are trusted.',
    )
  }
  if (mcpRunning && state.mcp) await terminateProcess(state.mcp.pid)
  if (editorRunning) await terminateProcess(state.pid)
  await rm(paths.state, { force: true })
  await rm(paths.mcpToken, { force: true })
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
      const editorRunning = Boolean(state && isProcessRunning(state.pid))
      const mcpRunning = Boolean(state?.mcp && isProcessRunning(state.mcp.pid))
      const editorHealthy = Boolean(state && editorRunning && (await checkHealth(state)))
      const mcpHealthy = Boolean(state && mcpRunning && (await checkMcpHealth(paths, state)))
      previousStatus = {
        installed: false,
        running: editorRunning || mcpRunning,
        healthy: editorHealthy && mcpHealthy,
        state: state ?? null,
        runtime: null,
        components: {
          editor: { running: editorRunning, healthy: editorHealthy },
          mcp: { running: mcpRunning, healthy: mcpHealthy },
        },
      }
    } else {
      previousStatus = await getEditorStatus(paths)
    }
    if (previousStatus.running && !statusComponentsAreIdentified(previousStatus)) {
      throw new CliError(
        'state_conflict',
        'A recorded Pascal process is running but its identity could not be verified. Recover or stop it before updating.',
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
      if (!wasRunning) await stopEditorUnlocked(paths)
      return { runtime: candidate, restarted: wasRunning }
    } catch (error) {
      try {
        await stopEditorUnlocked(paths, { force: true })
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

export async function checkHealth(state: EditorState): Promise<boolean> {
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

export async function checkMcpHealth(paths: PascalPaths, state: EditorState): Promise<boolean> {
  return (await probeMcpHealth(paths, state)) === 'healthy'
}

async function probeMcpHealth(
  paths: PascalPaths,
  state: EditorState,
): Promise<'healthy' | 'foreign' | 'unreachable'> {
  if (!state.mcp) return 'unreachable'
  let token: string
  try {
    token = (await readFile(paths.mcpToken, 'utf8')).trim()
  } catch {
    return 'unreachable'
  }
  if (!token) return 'unreachable'
  try {
    const response = await fetch(`http://127.0.0.1:${state.mcp.port}/health`, {
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
  state: EditorState,
  timeoutMs: number,
): Promise<void> {
  if (!state.mcp) throw new CliError('start_failed', 'Pascal MCP state was not created.')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const health = await probeMcpHealth(paths, state)
    if (health === 'healthy') return
    if (health === 'foreign') {
      throw new CliError(
        'port_conflict',
        `Port ${state.mcp.port} is responding as another application. Run Pascal again to choose another port.`,
      )
    }
    if (!isProcessRunning(state.mcp.pid)) {
      throw new CliError('start_failed', 'Pascal MCP exited before becoming healthy.')
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new CliError('health_timeout', `Pascal MCP did not become healthy within ${timeoutMs}ms.`)
}

export function isProcessRunning(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function findAvailablePort(preferredPort: number): Promise<number> {
  if (!Number.isInteger(preferredPort) || preferredPort < 0 || preferredPort > 65_535) {
    throw new CliError('invalid_port', `Invalid port: ${preferredPort}`)
  }
  if (preferredPort === 0) return probePort(0)
  if (!(await isPortAcceptingConnections(preferredPort))) {
    try {
      return await probePort(preferredPort)
    } catch {}
  }
  return probePort(0)
}

async function isPortAcceptingConnections(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    let settled = false
    const finish = (result: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(250)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

async function probePort(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port }, () => {
      const address = server.address()
      const resolvedPort = typeof address === 'object' && address ? address.port : port
      server.close((error) => (error ? reject(error) : resolve(resolvedPort)))
    })
  })
}

async function terminateProcess(pid: number): Promise<void> {
  try {
    process.kill(pid, 'SIGTERM')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return
    throw error
  }
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
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

async function waitForSpawn(child: ChildProcess, binary: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  }).catch((error) => {
    throw new CliError('start_failed', `Unable to launch ${binary}: ${errorMessage(error)}`)
  })
}

async function matchesRecordedEditorProcess(
  paths: PascalPaths,
  state: EditorState,
): Promise<boolean> {
  const runtimeDirectory = path.resolve(state.runtimeDirectory)
  if (!runtimeDirectory.startsWith(`${path.resolve(paths.runtime)}${path.sep}`)) return false
  if (process.platform === 'win32') return isProcessRunning(state.pid)
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

async function matchesRecordedMcpProcess(paths: PascalPaths, state: EditorState): Promise<boolean> {
  if (!state.mcp) return false
  const runtimeDirectory = path.resolve(state.runtimeDirectory)
  if (!runtimeDirectory.startsWith(`${path.resolve(paths.runtime)}${path.sep}`)) return false
  if (process.platform === 'win32') return isProcessRunning(state.mcp.pid)
  let expectedEntrypoint: string
  try {
    const manifest = await readRuntimeManifest(runtimeDirectory)
    expectedEntrypoint = path.resolve(runtimeDirectory, manifest.mcpEntrypoint)
  } catch {
    expectedEntrypoint = path.join(runtimeDirectory, 'services/pascal-mcp.mjs')
  }
  return (await processCommand(state.mcp.pid)).includes(expectedEntrypoint)
}

async function processCommand(pid: number): Promise<string> {
  return new Promise((resolve) => {
    execFile('ps', ['-ww', '-p', String(pid), '-o', 'command='], (error, stdout) => {
      resolve(error ? '' : stdout.trim())
    })
  })
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function statusComponentsAreIdentified(status: EditorStatus): boolean {
  return (
    (!status.components.editor.running || status.components.editor.healthy) &&
    (!status.components.mcp.running || status.components.mcp.healthy)
  )
}
