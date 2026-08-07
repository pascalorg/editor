#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { parseArgs } from 'node:util'
import { openBrowser } from '../browser.js'
import { collectInfo, runDoctor } from '../diagnostics.js'
import {
  activateEditorRuntime,
  type EditorStartProgress,
  followLog,
  getEditorStatus,
  readLogTail,
  restartEditor,
  startEditor,
  stopEditor,
} from '../editor-process.js'
import { CliError, toCliError } from '../errors.js'
import { readJsonFile } from '../json-files.js'
import { resolvePascalPaths } from '../paths.js'
import { installBundledRuntime } from '../runtime.js'
import { TerminalProgress } from '../terminal-progress.js'
import { version } from '../version.js'

const HELP = `Pascal — local 3D editor

USAGE:
  pascal editor [--foreground] [--no-open] [--port <n>]
  pascal start [--foreground] [--port <n>]
  pascal stop | restart | status | open
  pascal logs [--follow] [--lines <n>]
  pascal update [--version <version>]
  pascal doctor [--json]
  pascal info [--json]
  pascal project list [--json]
  pascal project open <id>
  pascal plugin list [--json]

Run "pascal --help" for the command reference.
`

const paths = resolvePascalPaths()

async function main(): Promise<void> {
  const [command = 'help', ...args] = process.argv.slice(2)
  if (command === '--version' || command === '-v') return print(version)
  if (command === '--help' || command === '-h' || command === 'help') return print(HELP)
  if (args.includes('--help') || args.includes('-h')) return print(HELP)

  switch (command) {
    case 'editor':
      return runStart(args, true)
    case 'start':
      return runStart(args, false)
    case 'stop':
      return runStop(args)
    case 'restart':
      return runRestart(args)
    case 'status':
      return runStatus(args)
    case 'open':
      return runOpen(args)
    case 'logs':
      return runLogs(args)
    case 'doctor':
      return runDoctorCommand(args)
    case 'info':
      return runInfo(args)
    case 'update':
      return runUpdate(args)
    case 'project':
      return runProject(args)
    case 'plugin':
      return runPlugin(args)
    case '_install-runtime':
      return output(true, await installBundledRuntime(paths, undefined, { activate: false }), '')
    default:
      throw new CliError('unknown_command', `Unknown command: ${command}`, { command }, 2)
  }
}

async function runStart(args: string[], shouldOpen: boolean): Promise<void> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      foreground: { type: 'boolean', default: false },
      open: { type: 'boolean', default: shouldOpen },
      'no-open': { type: 'boolean', default: false },
      port: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  if (values.help) return print(HELP)
  const port = parseIntegerOption(values.port, 'port')
  const progress = values.json ? undefined : new TerminalProgress()
  let installedRuntime = false
  progress?.start('Preparing your local Pascal editor')
  let result: Awaited<ReturnType<typeof startEditor>>
  try {
    result = await startEditor({
      paths,
      port,
      foreground: values.foreground,
      onProgress: progress
        ? (event) => {
            if (event.step === 'runtime-installing') installedRuntime = true
            reportStartProgress(progress, event)
          }
        : undefined,
    })
  } catch (error) {
    progress?.stop()
    throw error
  }
  progress?.stop()
  if (values.open && !values['no-open']) openBrowser(result.state.url)
  output(
    values.json,
    { ...result.state, alreadyRunning: result.alreadyRunning },
    result.alreadyRunning
      ? `Pascal is already running at ${result.state.url}`
      : installedRuntime
        ? [
            `Pascal is ready at ${result.state.url}`,
            `Projects stay in ${paths.data}`,
            '',
            'Next steps:',
            '  npx @pascal-app/cli status        Check the local editor',
            '  npx @pascal-app/cli logs --follow Follow editor logs',
            '  npx @pascal-app/cli stop          Stop the background process',
          ].join('\n')
        : `Pascal is running at ${result.state.url}`,
  )
  if (result.child) {
    const exitCode = await new Promise<number>((resolve) =>
      result.child?.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0))),
    )
    process.exitCode = exitCode
  }
}

function reportStartProgress(progress: TerminalProgress, event: EditorStartProgress): void {
  switch (event.step) {
    case 'storage-ready':
      progress.succeed(`Local data directory ready at ${event.dataDirectory}`)
      return
    case 'runtime-installing':
      progress.start('Installing the editor runtime')
      return
    case 'runtime-ready':
      progress.succeed(
        event.installed
          ? `Editor runtime ${event.version} installed`
          : `Editor runtime ${event.version} ready`,
      )
      return
    case 'port-ready':
      progress.succeed(
        event.preferredPort === 0
          ? `Local port ${event.port} selected automatically`
          : event.port === event.preferredPort
            ? `Local port ${event.port} is available`
            : `Port ${event.preferredPort} is busy; using ${event.port} instead`,
      )
      return
    case 'process-starting':
      progress.start(`Starting Pascal on port ${event.port}`)
      return
    case 'health-checking':
      progress.update('Checking that the editor is ready')
      return
    case 'ready':
      progress.succeed('Pascal Editor is ready')
      return
    case 'already-running':
      progress.succeed(`Pascal is already running on port ${event.port}`)
  }
}

async function runStop(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      force: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
    },
  })
  const stopped = await stopEditor(paths, { force: values.force })
  output(values.json, { stopped }, stopped ? 'Pascal stopped.' : 'Pascal is not running.')
}

async function runRestart(args: string[]): Promise<void> {
  const json = booleanOption(args, 'json')
  const result = await restartEditor(paths)
  output(json, result.state, `Pascal restarted at ${result.state.url}`)
}

async function runStatus(args: string[]): Promise<void> {
  const json = booleanOption(args, 'json')
  const status = await getEditorStatus(paths)
  output(
    json,
    status,
    status.healthy
      ? `Pascal ${status.state?.version} is running at ${status.state?.url}`
      : status.running
        ? 'Pascal has a running but unhealthy process.'
        : status.installed
          ? `Pascal ${status.runtime?.version} is installed and stopped.`
          : 'Pascal is not installed.',
  )
  if (status.running && !status.healthy) process.exitCode = 1
}

async function runOpen(args: string[]): Promise<void> {
  const json = booleanOption(args, 'json')
  const status = await getEditorStatus(paths)
  if (!status.healthy || !status.state)
    throw new CliError('editor_stopped', 'Pascal is not running.')
  openBrowser(status.state.url)
  output(json, { url: status.state.url }, status.state.url)
}

async function runLogs(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      follow: { type: 'boolean', short: 'f', default: false },
      lines: { type: 'string', default: '100' },
    },
  })
  const lines = parseIntegerOption(values.lines ?? '100', 'lines')
  if (lines === undefined || lines < 1) {
    throw new CliError('invalid_option', '--lines must be a positive integer.', undefined, 2)
  }
  print(await readLogTail(paths.editorLog, lines))
  if (values.follow) await followLog(paths.editorLog)
}

async function runDoctorCommand(args: string[]): Promise<void> {
  const json = booleanOption(args, 'json')
  const checks = await runDoctor(paths)
  output(
    json,
    { checks },
    checks
      .map(
        (check) =>
          `${check.status === 'pass' ? '✓' : check.status === 'warn' ? '!' : '✗'} ${check.message}`,
      )
      .join('\n'),
  )
  if (checks.some((check) => check.status === 'fail')) process.exitCode = 1
}

async function runInfo(args: string[]): Promise<void> {
  const json = booleanOption(args, 'json')
  const info = await collectInfo(paths)
  output(
    json,
    info,
    [
      `CLI: ${version}`,
      `Node: ${info.cli.node}`,
      `Home: ${paths.root}`,
      `Runtime: ${info.editor.runtime?.version ?? 'not installed'}`,
      `Editor: ${info.editor.healthy ? info.editor.state?.url : 'stopped'}`,
      `Plugins: ${info.plugins.length}`,
    ].join('\n'),
  )
}

async function runUpdate(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: { version: { type: 'string' }, json: { type: 'boolean', default: false } },
  })
  const target = values.version ?? 'latest'
  if (!isAllowedUpdateVersion(target)) {
    throw new CliError(
      'invalid_version',
      '--version must be an exact semantic version or the "latest" tag.',
      undefined,
      2,
    )
  }
  let candidate
  if (target === version) {
    candidate = await installBundledRuntime(paths, undefined, { activate: false })
  } else {
    const spec = `@pascal-app/cli@${target}`
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    if (!values.json) print(`Installing ${spec}...`)
    let result: Awaited<ReturnType<typeof spawnAndCapture>>
    try {
      result = await spawnAndCapture(
        npm,
        [
          'exec',
          '--yes',
          '--ignore-scripts',
          `--package=${spec}`,
          '--',
          'pascal',
          '_install-runtime',
        ],
        !values.json,
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new CliError(
          'npm_unavailable',
          'npm is required to install another Pascal runtime. Install Node.js with npm and try again.',
        )
      }
      throw error
    }
    if (result.exitCode !== 0) {
      throw new CliError('update_failed', `Unable to install ${spec}.`, {
        stderr: result.stderr.trim() || undefined,
      })
    }
    try {
      candidate = JSON.parse(result.stdout) as {
        schemaVersion: 1
        version: string
        directory: string
      }
    } catch {
      throw new CliError('update_failed', `The installer for ${spec} returned invalid output.`)
    }
  }
  const activation = await activateEditorRuntime(paths, candidate)
  output(
    values.json,
    activation,
    `Pascal runtime ${activation.runtime.version} is active${activation.restarted ? ' and the editor was restarted' : ''}.`,
  )
}

async function runProject(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args
  if (subcommand === 'list') {
    const json = booleanOption(rest, 'json')
    const status = await requireRunningEditor()
    const response = await fetch(`http://127.0.0.1:${status.state.port}/api/scenes`)
    if (!response.ok)
      throw new CliError('project_list_failed', `Scene API returned ${response.status}.`)
    const body = (await response.json()) as { scenes?: Array<{ id: string; name: string }> }
    output(
      json,
      body,
      body.scenes?.length
        ? body.scenes.map((scene) => `${scene.id}\t${scene.name}`).join('\n')
        : 'No projects yet.',
    )
    return
  }
  if (subcommand === 'open') {
    const { values, positionals } = parseArgs({
      args: rest,
      strict: true,
      allowPositionals: true,
      options: { json: { type: 'boolean', default: false } },
    })
    if (positionals.length !== 1) {
      throw new CliError('invalid_option', 'Use "pascal project open <id>".', undefined, 2)
    }
    const status = await requireRunningEditor()
    const url = `${status.state.url}/scene/${encodeURIComponent(positionals[0]!)}`
    openBrowser(url)
    return output(values.json, { url }, url)
  }
  throw new CliError(
    'unknown_command',
    'Use "pascal project list" or "pascal project open <id>".',
    undefined,
    2,
  )
}

async function runPlugin(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args
  if (subcommand === 'list') {
    const json = booleanOption(rest, 'json')
    const storedLock = await readJsonFile<{ schemaVersion?: unknown; plugins?: unknown }>(
      paths.pluginLock,
    )
    if (storedLock && (storedLock.schemaVersion !== 1 || !Array.isArray(storedLock.plugins))) {
      throw new CliError('invalid_plugin_state', 'The managed plugin lock is invalid.')
    }
    const lock = {
      schemaVersion: 1 as const,
      plugins: storedLock ? (storedLock.plugins as unknown[]) : [],
    }
    output(
      json,
      lock,
      lock.plugins.length ? JSON.stringify(lock.plugins, null, 2) : 'No plugins installed.',
    )
    return
  }
  throw new CliError(
    'plugin_command_unavailable',
    'Plugin installation is not enabled in this CLI release yet. Use "pascal plugin list".',
    undefined,
    2,
  )
}

async function requireRunningEditor() {
  const status = await getEditorStatus(paths)
  if (!status.healthy || !status.state) throw new CliError('editor_stopped', 'Start Pascal first.')
  return { ...status, state: status.state }
}

function booleanOption(args: string[], name: string): boolean {
  const { values } = parseArgs({
    args,
    strict: true,
    options: { [name]: { type: 'boolean', default: false } },
  })
  return Boolean(values[name])
}

function parseIntegerOption(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined
  if (!/^\d+$/.test(value)) {
    throw new CliError('invalid_option', `--${name} must be an integer.`, undefined, 2)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new CliError('invalid_option', `--${name} is outside the supported range.`, undefined, 2)
  }
  return parsed
}

function output(json: boolean | undefined, value: unknown, human: string): void {
  print(json ? JSON.stringify(value, null, 2) : human)
}

function print(value: string): void {
  process.stdout.write(value.endsWith('\n') ? value : `${value}\n`)
}

async function spawnAndCapture(
  command: string,
  args: string[],
  streamStderr = false,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  let capturedBytes = 0
  let captureError: CliError | undefined
  let forceKill: ReturnType<typeof setTimeout> | undefined
  const terminateInstaller = (error: CliError) => {
    captureError ??= error
    child.kill('SIGTERM')
    forceKill ??= setTimeout(() => child.kill('SIGKILL'), 5_000)
  }
  const capture = (target: Buffer[]) => (chunk: Buffer) => {
    capturedBytes += chunk.byteLength
    if (capturedBytes > 4 * 1024 * 1024) {
      terminateInstaller(
        new CliError('update_failed', 'The package installer produced more than 4 MiB of output.'),
      )
      return
    }
    target.push(chunk)
  }
  const captureStdout = capture(stdout)
  const captureStderr = capture(stderr)
  child.stdout?.on('data', captureStdout)
  child.stderr?.on('data', (chunk: Buffer) => {
    if (streamStderr) process.stderr.write(chunk)
    captureStderr(chunk)
  })
  const exitCode = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => {
      terminateInstaller(
        new CliError('update_timeout', 'The package installer did not finish within 10 minutes.'),
      )
    }, 10 * 60_000)
    child.once('error', (error) => {
      clearTimeout(timeout)
      if (forceKill) clearTimeout(forceKill)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timeout)
      if (forceKill) clearTimeout(forceKill)
      captureError ? reject(captureError) : resolve(code ?? 1)
    })
  })
  return {
    exitCode,
    stdout: Buffer.concat(stdout).toString('utf8').trim(),
    stderr: Buffer.concat(stderr).toString('utf8'),
  }
}

function isAllowedUpdateVersion(value: string): boolean {
  return (
    value === 'latest' ||
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value)
  )
}

main().catch((error) => {
  const cliError = toCliError(error)
  const wantsJson = process.argv.includes('--json')
  if (wantsJson) {
    process.stderr.write(
      `${JSON.stringify({ error: cliError.code, message: cliError.message, details: cliError.details })}\n`,
    )
  } else {
    process.stderr.write(`Error: ${cliError.message}\n`)
  }
  process.exitCode = cliError.exitCode
})
