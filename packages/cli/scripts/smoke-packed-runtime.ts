import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const smokeRoot = await mkdtemp(path.join(os.tmpdir(), 'pascal-cli-smoke-'))
let tarballPath: string | null = null
let smokeExecutable: string | null = null
const defaultPortBlocker = http.createServer((_request, response) => {
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify({ status: 'ok', app: 'foreign' }))
})
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

  const installDirectory = path.join(smokeRoot, 'install')
  await run('npm', ['install', '--ignore-scripts', '--prefix', installDirectory, tarballPath])
  smokeExecutable = path.join(installDirectory, 'node_modules/@pascal-app/cli/dist/bin/pascal.js')

  const started = JSON.parse(
    (
      await run(
        process.execPath,
        [smokeExecutable, 'editor', '--no-open', '--json'],
        undefined,
        smokeEnvironment,
      )
    ).stdout,
  ) as { pid: number; port: number; url: string }
  if (started.port === 3000) throw new Error('editor reused the occupied default port')
  const rootResponse = await fetch(`http://127.0.0.1:${started.port}/`)
  if (!rootResponse.ok) throw new Error(`editor root returned ${rootResponse.status}`)
  const scenesResponse = await fetch(`${started.url}/scenes`)
  if (!scenesResponse.ok) throw new Error(`editor scenes returned ${scenesResponse.status}`)
  const repeatedStart = JSON.parse(
    (
      await run(
        process.execPath,
        [smokeExecutable, 'editor', '--no-open', '--port', '0', '--json'],
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
    [smokeExecutable, 'editor', '--no-open'],
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
    [smokeExecutable, 'project', 'list', '--json'],
    undefined,
    smokeEnvironment,
  )
  await run(process.execPath, [smokeExecutable, 'doctor', '--json'], undefined, smokeEnvironment)
  await run(process.execPath, [smokeExecutable, 'stop', '--json'], undefined, smokeEnvironment)
  smokeExecutable = null

  console.log(
    `Packed runtime smoke passed (${formatMb(artifact.size)} MB compressed, ${formatMb(artifact.unpackedSize)} MB unpacked, ${artifact.entryCount} files).`,
  )
} finally {
  await close(defaultPortBlocker)
  if (smokeExecutable) {
    await run(
      process.execPath,
      [smokeExecutable, 'stop', '--force', '--json'],
      undefined,
      smokeEnvironment,
    ).catch(() => undefined)
  }
  if (tarballPath) await rm(tarballPath, { force: true })
  await rm(smokeRoot, { recursive: true, force: true })
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

function enforceArtifactBudget(artifact: {
  size: number
  unpackedSize: number
  entryCount: number
}): void {
  const maximumSize = 105 * 1024 * 1024
  const maximumUnpackedSize = 160 * 1024 * 1024
  const maximumEntryCount = 4_000
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
  const result = {
    stdout: Buffer.concat(stdout).toString('utf8'),
    stderr: Buffer.concat(stderr).toString('utf8'),
  }
  if (exitCode !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${exitCode}): ${result.stderr}`)
  }
  return result
}

function formatMb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1)
}
