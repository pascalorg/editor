import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdtemp, open, readFile, rm, stat } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const smokeRoot = await mkdtemp(path.join(os.tmpdir(), 'pascal-cli-smoke-'))
let tarballPath: string | null = null
let smokeExecutable: string | null = null
let mcpOnlyExecutable: string | null = null
const defaultPortBlocker = http.createServer((_request, response) => {
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify({ status: 'ok', app: 'foreign' }))
})
/** MCP-only mode is verified in its own home so no web runtime can be installed there. */
const mcpOnlyEnvironment = {
  ...process.env,
  PASCAL_HOME: path.join(smokeRoot, 'home-mcp-only'),
  PASCAL_NO_OPEN: '1',
}
const smokeEnvironment = {
  ...process.env,
  PASCAL_HOME: path.join(smokeRoot, 'home'),
  PASCAL_NO_OPEN: '1',
}

try {
  await listen(defaultPortBlocker)
  const pack = await run('npm', ['pack', '--json', '--ignore-scripts'], packageDirectory)
  const packResult = JSON.parse(pack.stdout) as
    | Array<PackedArtifact>
    | Record<string, PackedArtifact>
  const artifact = Array.isArray(packResult) ? packResult[0] : Object.values(packResult)[0]
  if (!artifact) throw new Error('npm pack did not return an artifact')
  tarballPath = path.join(packageDirectory, artifact.filename)
  enforceArtifactBudget(artifact)
  const runtimeArchive = await verifyStagedWebRuntime()

  const installDirectory = path.join(smokeRoot, 'install')
  await run('npm', ['install', '--ignore-scripts', '--prefix', installDirectory, tarballPath])
  const executable = path.join(installDirectory, 'node_modules/@pascal-app/cli/dist/bin/pascal.js')

  mcpOnlyExecutable = executable
  await checkMcpWithoutWebRuntime(executable)
  mcpOnlyExecutable = null

  smokeExecutable = executable
  await checkTamperedArchiveIsRejected(executable, runtimeArchive.file)
  await checkEditorFromLocalArchive(executable, runtimeArchive.file)
  smokeExecutable = null

  console.log(
    `Packed CLI smoke passed (${formatMb(artifact.size)} MB compressed, ${formatMb(artifact.unpackedSize)} MB unpacked, ${artifact.entryCount} files).`,
  )
  console.log(
    `Web runtime archive ${path.basename(runtimeArchive.file)} (${formatMb(runtimeArchive.size)} MB) verified against ${runtimeArchive.url}`,
  )
} finally {
  await close(defaultPortBlocker)
  for (const [command, environment] of [
    [smokeExecutable, smokeEnvironment],
    [mcpOnlyExecutable, mcpOnlyEnvironment],
  ] as Array<[string | null, NodeJS.ProcessEnv]>) {
    if (!command) continue
    await run(
      process.execPath,
      [command, 'stop', '--force', '--json'],
      undefined,
      environment,
    ).catch(() => undefined)
  }
  if (tarballPath) await rm(tarballPath, { force: true })
  await rm(smokeRoot, { recursive: true, force: true })
}

/**
 * Phase 1: agent tools must work on a machine that has never downloaded the web runtime.
 */
async function checkMcpWithoutWebRuntime(executable: string): Promise<void> {
  const client = new Client({ name: 'pascal-cli-smoke-mcp-only', version: '0.0.0' })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [executable, 'mcp', 'connect'],
    env: mcpOnlyEnvironment as Record<string, string>,
    stderr: 'pipe',
  })
  try {
    await client.connect(transport)
    const tools = await client.listTools()
    if (!tools.tools.some((tool) => tool.name === 'save_scene')) {
      throw new Error('MCP-only mode did not expose save_scene')
    }
    const saved = await client.callTool({
      name: 'save_scene',
      arguments: { id: 'mcp-only-project', name: 'MCP only project' },
    })
    if (saved.isError) throw new Error(`MCP-only save_scene failed: ${JSON.stringify(saved)}`)
    const listed = await client.callTool({ name: 'list_scenes', arguments: {} })
    if (listed.isError || !JSON.stringify(listed).includes('mcp-only-project')) {
      throw new Error(`MCP-only list_scenes failed: ${JSON.stringify(listed)}`)
    }
    console.log(
      `MCP-only mode exposed ${tools.tools.length} tools and stored a scene with no web runtime installed.`,
    )
  } finally {
    await client.close()
  }
  const status = JSON.parse(
    (await run(process.execPath, [executable, 'status', '--json'], undefined, mcpOnlyEnvironment))
      .stdout,
  ) as { installed: boolean; running: boolean; runtime: unknown; mcp: { healthy: boolean } }
  if (status.installed || status.runtime !== null || status.running) {
    throw new Error('MCP-only mode installed or started the web runtime')
  }
  if (!status.mcp.healthy) throw new Error('the managed MCP service is not healthy on its own')
  const stopped = JSON.parse(
    (await run(process.execPath, [executable, 'stop', '--json'], undefined, mcpOnlyEnvironment))
      .stdout,
  ) as { stopped: boolean }
  if (!stopped.stopped) throw new Error('stop did not report the MCP-only service as stopped')
}

/** Phase 2: a modified archive must never reach the runtime directory. */
async function checkTamperedArchiveIsRejected(
  executable: string,
  archiveFile: string,
): Promise<void> {
  const tampered = path.join(smokeRoot, 'tampered-web-runtime.tar.gz')
  await copyFile(archiveFile, tampered)
  const handle = await open(tampered, 'r+')
  try {
    const offset = Math.floor((await handle.stat()).size / 2)
    const byte = Buffer.alloc(1)
    await handle.read(byte, 0, 1, offset)
    byte[0] = ((byte[0] ?? 0) ^ 0xff) & 0xff
    await handle.write(byte, 0, 1, offset)
  } finally {
    await handle.close()
  }
  const failure = await runExpectingFailure(
    process.execPath,
    [executable, 'editor', '--no-open', '--json', '--runtime', tampered],
    smokeEnvironment,
  )
  const reported = JSON.parse(failure.stderr) as { error: string; message: string }
  if (reported.error !== 'runtime_digest_mismatch') {
    throw new Error(`a tampered archive was not rejected: ${failure.stderr}`)
  }
  await stat(tampered)
  const status = JSON.parse(
    (await run(process.execPath, [executable, 'status', '--json'], undefined, smokeEnvironment))
      .stdout,
  ) as { installed: boolean }
  if (status.installed) throw new Error('a tampered archive was installed')
  console.log(`Tampered archive rejected: ${reported.message.split('\n')[0]}`)
}

/** Phase 3: the offline install path, then the full editor and MCP flow over that runtime. */
async function checkEditorFromLocalArchive(executable: string, archiveFile: string): Promise<void> {
  const started = JSON.parse(
    (
      await run(
        process.execPath,
        [executable, 'editor', '--no-open', '--json', '--runtime', archiveFile],
        undefined,
        smokeEnvironment,
      )
    ).stdout,
  ) as { pid: number; port: number; url: string; mcp: { port: number } }
  if (started.port === 3000) throw new Error('editor reused the occupied default port')
  if (!started.mcp?.port) throw new Error('the editor did not report a managed MCP port')
  const rootResponse = await fetch(`http://127.0.0.1:${started.port}/`)
  if (!rootResponse.ok) throw new Error(`editor root returned ${rootResponse.status}`)
  const scenesResponse = await fetch(`${started.url}/scenes`)
  if (!scenesResponse.ok) throw new Error(`editor scenes returned ${scenesResponse.status}`)
  const repeatedStart = JSON.parse(
    (
      await run(
        process.execPath,
        [executable, 'editor', '--no-open', '--port', '0', '--json'],
        undefined,
        smokeEnvironment,
      )
    ).stdout,
  ) as { alreadyRunning: boolean; pid: number; port: number }
  if (
    !repeatedStart.alreadyRunning ||
    repeatedStart.pid !== started.pid ||
    repeatedStart.port !== started.port
  ) {
    throw new Error('a repeated editor command did not reuse the managed process')
  }
  const humanStart = await run(
    process.execPath,
    [executable, 'editor', '--no-open'],
    undefined,
    smokeEnvironment,
  )
  if (
    !humanStart.stdout.includes('pascal status') ||
    humanStart.stdout.includes('npm install --global @pascal-app/cli')
  ) {
    throw new Error('direct CLI start output did not use the persistent pascal command')
  }
  await run(
    process.execPath,
    [executable, 'project', 'list', '--json'],
    undefined,
    smokeEnvironment,
  )
  const mcpTransport = new StdioClientTransport({
    command: process.execPath,
    args: [executable, 'mcp', 'connect'],
    env: smokeEnvironment as Record<string, string>,
    stderr: 'pipe',
  })
  const mcpClient = new Client({ name: 'pascal-cli-smoke', version: '0.0.0' })
  try {
    await mcpClient.connect(mcpTransport)
    const tools = await mcpClient.listTools()
    if (!tools.tools.some((tool) => tool.name === 'save_scene')) {
      throw new Error('managed MCP did not expose save_scene')
    }
    const saved = await mcpClient.callTool({
      name: 'save_scene',
      arguments: { id: 'smoke-project', name: 'Smoke project' },
    })
    if (saved.isError) throw new Error(`managed MCP save_scene failed: ${JSON.stringify(saved)}`)
  } finally {
    await mcpClient.close()
  }
  const resumed = JSON.parse(
    (
      await run(
        process.execPath,
        [executable, 'resume', 'Smoke project', '--json'],
        undefined,
        smokeEnvironment,
      )
    ).stdout,
  ) as { project: { id: string }; url: string }
  if (resumed.project.id !== 'smoke-project' || !resumed.url.endsWith('/scene/smoke-project')) {
    throw new Error('CLI project resume did not resolve the MCP-saved project')
  }
  console.log(
    `Editor installed from ${path.basename(archiveFile)} on port ${started.port}, MCP on port ${started.mcp.port}, and a scene round-tripped between MCP and the CLI.`,
  )
  await run(process.execPath, [executable, 'doctor', '--json'], undefined, smokeEnvironment)
  await run(process.execPath, [executable, 'stop', '--json'], undefined, smokeEnvironment)
}

async function verifyStagedWebRuntime(): Promise<{ file: string; size: number; url: string }> {
  const source = JSON.parse(
    await readFile(path.join(packageDirectory, 'dist/runtime-source.json'), 'utf8'),
  ) as { version: string; url: string; sha256: string; size: number }
  const packageVersion = (
    JSON.parse(await readFile(path.join(packageDirectory, 'package.json'), 'utf8')) as {
      version: string
    }
  ).version
  if (source.version !== packageVersion) {
    throw new Error(`dist/runtime-source.json targets ${source.version}, not ${packageVersion}`)
  }
  const archiveName = `pascal-web-runtime-${packageVersion}.tar.gz`
  const expectedUrl = `https://github.com/pascalorg/editor/releases/download/@pascal-app/cli@${packageVersion}/${archiveName}`
  if (source.url !== expectedUrl) {
    throw new Error(`dist/runtime-source.json points at ${source.url}, not ${expectedUrl}`)
  }
  const file = path.join(packageDirectory, 'build', archiveName)
  const { size } = await stat(file)
  if (size !== source.size) {
    throw new Error(`${archiveName} is ${size} bytes; runtime-source.json records ${source.size}`)
  }
  const maximumArchiveSize = 70 * 1024 * 1024
  if (size > maximumArchiveSize) {
    throw new Error(
      `the web runtime archive exceeds its release budget: ${formatMb(size)} MB > ${formatMb(maximumArchiveSize)} MB`,
    )
  }
  const digestFile = `${file}.sha256`
  const recordedDigest = (await readFile(digestFile, 'utf8')).trim().split(/\s+/)[0]
  if (recordedDigest !== source.sha256) {
    throw new Error(`${digestFile} does not match dist/runtime-source.json`)
  }
  const hashed = await sha256(file)
  if (hashed !== source.sha256) {
    throw new Error(`${archiveName} hashes to ${hashed}, not the published ${source.sha256}`)
  }
  return { file, size, url: source.url }
}

async function sha256(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function listen(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) =>
      error.code === 'EADDRINUSE' ? resolve() : reject(error),
    )
    server.listen({ host: '::', port: 3000, ipv6Only: false }, resolve)
  })
}

async function close(server: http.Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}

interface PackedArtifact {
  filename: string
  size: number
  unpackedSize: number
  entryCount: number
}

/**
 * The npm package carries the CLI and the MCP service only. The web runtime rides a GitHub
 * release asset, so both budgets are enforced separately.
 */
function enforceArtifactBudget(artifact: {
  size: number
  unpackedSize: number
  entryCount: number
}): void {
  const maximumSize = 3 * 1024 * 1024
  const maximumUnpackedSize = 10 * 1024 * 1024
  const maximumEntryCount = 250
  if (
    artifact.size > maximumSize ||
    artifact.unpackedSize > maximumUnpackedSize ||
    artifact.entryCount > maximumEntryCount
  ) {
    throw new Error(
      `packed CLI exceeds its release budget: ${formatMb(artifact.size)} MB compressed, ${formatMb(artifact.unpackedSize)} MB unpacked, ${artifact.entryCount} files`,
    )
  }
}

async function run(
  command: string,
  args: string[],
  cwd?: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ stdout: string; stderr: string }> {
  const result = await capture(command, args, cwd, env)
  if (result.exitCode !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.exitCode}): ${result.stderr}`)
  }
  return result
}

async function runExpectingFailure(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> {
  const result = await capture(command, args, undefined, env)
  if (result.exitCode === 0) {
    throw new Error(`${command} ${args.join(' ')} succeeded but should have failed`)
  }
  return result
}

async function capture(
  command: string,
  args: string[],
  cwd?: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const executable = process.platform === 'win32' && command === 'npm' ? 'npm.cmd' : command
  const child = spawn(executable, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => resolve(code ?? 1))
  })
  return {
    exitCode,
    stdout: Buffer.concat(stdout).toString('utf8'),
    stderr: Buffer.concat(stderr).toString('utf8'),
  }
}

function formatMb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1)
}
