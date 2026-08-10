#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { parseArgs } from 'node:util'
import { openBrowser } from '../browser.js'
import { installGlobalPascalCommand, isNpxInvocation } from '../command-install.js'
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
import { connectManagedMcp } from '../mcp-connector.js'
import { resolvePascalPaths } from '../paths.js'
import { listLocalProjects, projectUrl, resolveLocalProject } from '../projects.js'
import { installBundledRuntime } from '../runtime.js'
import { TerminalProgress } from '../terminal-progress.js'
import { version } from '../version.js'

const HELP = `Pascal — local 3D editor

FIRST RUN:
  npx @pascal-app/cli editor
  Starts the editor and installs the shorter "pascal" command interactively.

RUN A COMMAND THROUGH NPX:
  npx @pascal-app/cli <command>

ENABLE THE SHORT GLOBAL COMMAND:
  npm install --global @pascal-app/cli
  pascal <command>

USAGE:
  pascal editor [--foreground] [--no-open] [--port <n>]
  pascal start [--foreground] [--port <n>]
  pascal stop | restart | status
  pascal open [project]
  pascal resume [project]
  pascal projects [--json]
  pascal logs [--follow] [--lines <n>]
  pascal update [--version <version>]
  pascal doctor [--json]
  pascal info [--json]
  pascal project list [--json]
  pascal project open <id-or-name>
  pascal project resume [id-or-name]
  pascal mcp connect | status | config | setup <client>
  pascal plugin list [--json]

Documentation: https://editor.pascal.app/docs/developers/local-editor
`

const MCP_HELP = `Pascal MCP — connect AI agents to local projects

The authenticated MCP service starts and stops with the Pascal editor.

USAGE:
  pascal mcp status [--json]       Check the managed MCP service
  pascal mcp setup codex           Configure Codex CLI
  pascal mcp setup claude          Configure Claude Code
  pascal mcp config [--json]       Print generic MCP client JSON
  pascal mcp connect               Start the stdio client connector

MCP clients should run "pascal mcp connect"; the connector discovers the
dynamic loopback port without exposing Pascal's private local token.

Documentation: https://editor.pascal.app/docs/developers/mcp
`

const paths = resolvePascalPaths()

async function main(): Promise<void> {
  const [command = 'help', ...args] = process.argv.slice(2)
  if (command === '--version' || command === '-v') return print(version)
  if (command === '--help' || command === '-h' || command === 'help') return print(HELP)
  if (args.includes('--help') || args.includes('-h')) {
    return print(command === 'mcp' ? MCP_HELP : HELP)
  }

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
    case 'resume':
      return runProjectOpen(args, true)
    case 'projects':
      return runProject(['list', ...args])
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
    case 'mcp':
      return runMcp(args)
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
  progress?.start('Preparing your local Pascal editor')
  let result: Awaited<ReturnType<typeof startEditor>>
  try {
    result = await startEditor({
      paths,
      port,
      foreground: values.foreground,
      onProgress: progress ? (event) => reportStartProgress(progress, event) : undefined,
    })
  } catch (error) {
    progress?.stop()
    throw error
  }
  progress?.stop()
  if (values.open && !values['no-open']) openBrowser(result.state.url)
  const npxInvocation = isNpxInvocation()
  let commandInstalled = false
  if (npxInvocation && !values.json && process.stdin.isTTY && process.stderr.isTTY) {
    progress?.start('Installing the pascal command')
    commandInstalled = await installGlobalPascalCommand(version)
    if (commandInstalled) {
      progress?.succeed('pascal command installed')
    } else {
      progress?.stop()
      process.stderr.write(
        '! The editor is ready, but npm could not install the pascal command globally.\n',
      )
    }
  }
  const useShortCommand = !npxInvocation || commandInstalled
  const commandPrefix = useShortCommand ? 'pascal' : 'npx @pascal-app/cli'
  output(
    values.json,
    { ...result.state, alreadyRunning: result.alreadyRunning },
    [
      result.alreadyRunning
        ? `Pascal is already running at ${result.state.url}`
        : `Pascal is ready at ${result.state.url}`,
      `MCP is ready on port ${result.state.mcp?.port}`,
      `Projects stay in ${paths.data}`,
      '',
      `Manage it with ${useShortCommand ? 'pascal' : 'npx'}:`,
      `  ${commandPrefix} status        Check the local editor`,
      `  ${commandPrefix} projects      List local projects`,
      `  ${commandPrefix} resume        Resume your latest project`,
      `  ${commandPrefix} logs --follow Follow editor logs`,
      `  ${commandPrefix} stop          Stop the background process`,
      ...(useShortCommand
        ? ['', 'Connect an AI agent:', `  ${commandPrefix} mcp setup codex`]
        : []),
      ...(useShortCommand
        ? []
        : [
            '',
            'To install the shorter "pascal" command:',
            '  npm install --global @pascal-app/cli',
          ]),
    ].join('\n'),
  )
  if (result.child) {
    const exitCode = await new Promise<number>((resolve) =>
      result.child?.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0))),
    )
    await stopEditor(paths, { force: true }).catch(() => undefined)
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
    case 'mcp-port-ready':
      progress.succeed(`MCP port ${event.port} selected automatically`)
      return
    case 'mcp-starting':
      progress.start('Starting Pascal MCP')
      return
    case 'mcp-health-checking':
      progress.update('Checking that MCP is ready')
      return
    case 'ready':
      progress.succeed('Pascal Editor and MCP are ready')
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
      ? [
          `Pascal ${status.state?.version} is running at ${status.state?.url}`,
          `MCP is ready on port ${status.state?.mcp?.port}`,
        ].join('\n')
      : status.running
        ? 'Pascal has a running but unhealthy process.'
        : status.installed
          ? `Pascal ${status.runtime?.version} is installed and stopped.`
          : 'Pascal is not installed.',
  )
  if (status.running && !status.healthy) process.exitCode = 1
}

async function runOpen(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: { json: { type: 'boolean', default: false } },
  })
  if (positionals.length > 1) {
    throw new CliError('invalid_option', 'Use "pascal open [project]".', undefined, 2)
  }
  if (positionals[0]) return runProjectOpen(args, false)
  const status = await ensureRunningEditor()
  openBrowser(status.state.url)
  output(values.json, { url: status.state.url }, status.state.url)
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
      `MCP: ${info.editor.components.mcp.healthy ? `ready on port ${info.editor.state?.mcp?.port}` : 'stopped'}`,
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
    const status = await ensureRunningEditor()
    const projects = await listLocalProjects(status.state)
    output(
      json,
      { projects },
      projects.length
        ? projects
            .map(
              (project) =>
                `${project.id}\t${project.name}\t${new Date(project.updatedAt).toLocaleString()}`,
            )
            .join('\n')
        : 'No projects yet.',
    )
    return
  }
  if (subcommand === 'open') {
    return runProjectOpen(rest, false)
  }
  if (subcommand === 'resume') {
    return runProjectOpen(rest, true)
  }
  throw new CliError(
    'unknown_command',
    'Use "pascal project list", "pascal project open <project>", or "pascal project resume".',
    undefined,
    2,
  )
}

async function runProjectOpen(args: string[], latestWhenMissing: boolean): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: { json: { type: 'boolean', default: false } },
  })
  if (positionals.length > 1 || (!latestWhenMissing && positionals.length !== 1)) {
    throw new CliError(
      'invalid_option',
      latestWhenMissing ? 'Use "pascal resume [project]".' : 'Use "pascal open <project>".',
      undefined,
      2,
    )
  }
  const status = await ensureRunningEditor()
  const projects = await listLocalProjects(status.state)
  const project = resolveLocalProject(projects, positionals[0])
  const url = projectUrl(status.state, project)
  openBrowser(url)
  output(values.json, { project, url }, `${project.name}\n${url}`)
}

async function runMcp(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args
  if (subcommand === 'connect') {
    if (rest.length > 0) {
      throw new CliError('invalid_option', 'Use "pascal mcp connect".', undefined, 2)
    }
    await connectManagedMcp(paths)
    return
  }
  if (subcommand === 'status') {
    const json = booleanOption(rest, 'json')
    const status = await getEditorStatus(paths)
    const result = {
      running: status.components.mcp.running,
      healthy: status.components.mcp.healthy,
      port: status.state?.mcp?.port ?? null,
    }
    output(
      json,
      result,
      result.healthy
        ? `Pascal MCP is ready on port ${result.port}.`
        : result.running
          ? 'Pascal MCP is running but unhealthy.'
          : 'Pascal MCP is stopped.',
    )
    if (result.running && !result.healthy) process.exitCode = 1
    return
  }
  if (subcommand === 'config') {
    const json = booleanOption(rest, 'json')
    const config = { command: 'pascal', args: ['mcp', 'connect'] }
    const document = { mcpServers: { pascal: config } }
    output(json, document, JSON.stringify(document, null, 2))
    return
  }
  if (subcommand === 'setup') {
    const { values, positionals } = parseArgs({
      args: rest,
      strict: true,
      allowPositionals: true,
      options: { json: { type: 'boolean', default: false } },
    })
    const client = positionals[0]
    if (positionals.length !== 1 || (client !== 'codex' && client !== 'claude')) {
      throw new CliError(
        'invalid_option',
        'Use "pascal mcp setup codex" or "pascal mcp setup claude".',
        undefined,
        2,
      )
    }
    await ensureShortCommandAvailable()
    const command = client === 'codex' ? 'codex' : 'claude'
    const commandArgs =
      client === 'codex'
        ? ['mcp', 'add', 'pascal', '--', 'pascal', 'mcp', 'connect']
        : ['mcp', 'add', '--scope', 'user', 'pascal', '--', 'pascal', 'mcp', 'connect']
    let result: Awaited<ReturnType<typeof spawnAndCapture>>
    try {
      result = await spawnAndCapture(command, commandArgs)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new CliError(
          'mcp_client_unavailable',
          `${client === 'codex' ? 'Codex' : 'Claude Code'} is not installed or is not on PATH.`,
        )
      }
      throw error
    }
    if (result.exitCode !== 0) {
      throw new CliError(
        'mcp_setup_failed',
        `Unable to configure ${client}. It may already have a Pascal MCP entry.`,
        { stderr: result.stderr.trim() || undefined, stdout: result.stdout.trim() || undefined },
      )
    }
    output(
      values.json,
      { client, configured: true, command: 'pascal', args: ['mcp', 'connect'] },
      `${client === 'codex' ? 'Codex' : 'Claude Code'} now uses the managed Pascal MCP service. Start a new agent session to connect.`,
    )
    return
  }
  throw new CliError(
    'unknown_command',
    'Use "pascal mcp connect", "pascal mcp status", "pascal mcp config", or "pascal mcp setup <client>".',
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

async function ensureRunningEditor() {
  const status = await getEditorStatus(paths)
  if (status.healthy && status.state) return { ...status, state: status.state }
  const started = await startEditor({ paths })
  return {
    ...(await getEditorStatus(paths)),
    state: started.state,
  }
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

async function ensureShortCommandAvailable(): Promise<void> {
  try {
    const result = await spawnAndCapture('pascal', ['--version'])
    if (result.exitCode === 0 && result.stdout === version) return
  } catch {}
  throw new CliError(
    'pascal_command_unavailable',
    `The matching Pascal CLI ${version} is required in MCP client configuration. Run "npm install --global @pascal-app/cli@${version}" and try again.`,
  )
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
