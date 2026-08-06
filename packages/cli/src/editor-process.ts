import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, openSync } from 'node:fs'
import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
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
  sourceDirectory?: string
}

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
    return { installed: Boolean(runtime), running: false, healthy: false, state: null, runtime }
  }
  const running = isProcessRunning(state.pid)
  const healthy = running && (await checkHealth(state))
  return { installed: Boolean(runtime), running, healthy, state, runtime }
}

export async function startEditor(options: StartEditorOptions): Promise<StartEditorResult> {
  return withEditorLifecycleLock(options.paths, () => startEditorUnlocked(options))
}

async function startEditorUnlocked(options: StartEditorOptions): Promise<StartEditorResult> {
  await ensurePascalDirectories(options.paths)
  let currentStatus: EditorStatus
  try {
    currentStatus = await getEditorStatus(options.paths)
  } catch (error) {
    if (!(error instanceof CliError) || error.code !== 'invalid_runtime') throw error
    await stopEditorUnlocked(options.paths, { force: true })
    await rm(options.paths.currentRuntime, { force: true })
    await installBundledRuntime(options.paths, options.sourceDirectory)
    currentStatus = await getEditorStatus(options.paths)
  }
  if (currentStatus.healthy && currentStatus.state) {
    return { state: currentStatus.state, alreadyRunning: true }
  }
  if (currentStatus.running && currentStatus.state) {
    throw new CliError(
      'state_conflict',
      `Process ${currentStatus.state.pid} is running but does not identify as this Pascal editor.`,
    )
  }
  await rm(options.paths.state, { force: true })

  let runtime = await readActiveRuntime(options.paths)
  if (!runtime) {
    runtime = await installBundledRuntime(options.paths, options.sourceDirectory)
  }
  const manifest = await readRuntimeManifest(runtime.directory)
  const serverPath = path.resolve(runtime.directory, manifest.entrypoint)
  const port = await findAvailablePort(options.port ?? 3000)
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
  const child = spawn(nodeBinary, [serverPath], {
    cwd: path.dirname(serverPath),
    env: environment,
    detached: !options.foreground,
    stdio: options.foreground ? 'inherit' : ['ignore', logDescriptor!, logDescriptor!],
  })
  if (logDescriptor !== undefined) closeSync(logDescriptor)

  try {
    await waitForSpawn(child, nodeBinary)
    if (!child.pid) throw new CliError('start_failed', 'The Pascal editor process did not start.')
    state.pid = child.pid
    await writeJsonFile(options.paths.state, state)
    if (!options.foreground) child.unref()
    await waitForHealth(state, 30_000)
  } catch (error) {
    if (child.pid) await terminateProcess(child.pid)
    await rm(options.paths.state, { force: true })
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
  if (!state || !isProcessRunning(state.pid)) {
    await rm(paths.state, { force: true })
    return false
  }
  if (!(await checkHealth(state))) {
    if (options.force && (await matchesRecordedEditorProcess(paths, state))) {
      await terminateProcess(state.pid)
      await rm(paths.state, { force: true })
      return true
    }
    throw new CliError(
      'state_conflict',
      options.force
        ? `Refusing to stop process ${state.pid} because neither its health identity nor its operating-system command matches the recorded Pascal editor.`
        : `Refusing to stop process ${state.pid} because its health identity is unavailable. Inspect "pascal status --json", then use "pascal stop --force" only if it is the recorded editor.`,
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
      const healthy = Boolean(state && running && (await checkHealth(state)))
      previousStatus = {
        installed: false,
        running,
        healthy,
        state: state ?? null,
        runtime: null,
      }
    } else {
      previousStatus = await getEditorStatus(paths)
    }
    if (previousStatus.running && !previousStatus.healthy) {
      throw new CliError(
        'state_conflict',
        'The recorded editor process is running but unhealthy. Recover or stop it before updating.',
      )
    }
    if (
      previousRuntime?.version === candidate.version &&
      previousRuntime.directory === candidate.directory
    ) {
      return { runtime: previousRuntime, restarted: false }
    }

    const wasRunning = previousStatus.healthy
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
  try {
    const response = await fetch(`http://127.0.0.1:${state.port}/api/health`, {
      signal: AbortSignal.timeout(1_000),
    })
    if (!response.ok) return false
    const body = (await response.json()) as {
      status?: string
      app?: string
      version?: string
      instanceId?: string
    }
    return (
      body.status === 'ok' &&
      body.app === 'editor' &&
      body.version === state.version &&
      body.instanceId === state.instanceId
    )
  } catch {
    return false
  }
}

export async function waitForHealth(state: EditorState, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await checkHealth(state)) return
    if (!isProcessRunning(state.pid)) {
      throw new CliError('start_failed', 'The Pascal editor exited before becoming healthy.')
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new CliError('health_timeout', `Pascal did not become healthy within ${timeoutMs}ms.`)
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
  for (let port = preferredPort; port < Math.min(preferredPort + 20, 65_536); port += 1) {
    try {
      return await probePort(port)
    } catch {}
  }
  throw new CliError('port_unavailable', `No available port found from ${preferredPort}.`)
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
  const command = await new Promise<string>((resolve) => {
    execFile('ps', ['-ww', '-p', String(state.pid), '-o', 'command='], (error, stdout) => {
      resolve(error ? '' : stdout.trim())
    })
  })
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
