import { afterAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const executable = path.join(import.meta.dir, 'bin/pascal.ts')
const testRoot = await mkdtemp(path.join(os.tmpdir(), 'pascal-cli-command-test-'))
const testHome = path.join(testRoot, 'home')

afterAll(() => rm(testRoot, { recursive: true, force: true }))

describe('command parsing', () => {
  test('shows the command reference for subcommand help', async () => {
    const result = await runCli('status', '--help')

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('pascal editor')
    expect(result.stdout).toContain('npx @pascal-app/cli <command>')
    expect(result.stdout).toContain('npm install --global @pascal-app/cli')
  })

  test('rejects a partially numeric port', async () => {
    const result = await runCli('editor', '--port', '3000junk', '--no-open', '--json')

    expect(result.exitCode).toBe(2)
    expect(JSON.parse(result.stderr)).toMatchObject({ error: 'invalid_option' })
  })

  test('rejects a non-numeric log line count', async () => {
    const result = await runCli('logs', '--lines', 'many')

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('--lines must be an integer')
  })

  test('rejects non-registry update sources before invoking npm', async () => {
    const result = await runCli('update', '--version', 'file:/tmp/untrusted', '--json')

    expect(result.exitCode).toBe(2)
    expect(JSON.parse(result.stderr)).toMatchObject({ error: 'invalid_version' })
  })

  test('reports unknown options as command errors', async () => {
    const result = await runCli('project', 'list', '--unknown', '--json')

    expect(result.exitCode).toBe(2)
    expect(JSON.parse(result.stderr)).toMatchObject({ error: 'invalid_option' })
  })

  test('reports a malformed plugin lock as managed-state corruption', async () => {
    await mkdir(testHome, { recursive: true })
    await writeFile(path.join(testHome, 'pascal.plugins.lock'), '{"schemaVersion":1}')

    const result = await runCli('plugin', 'list', '--json')

    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr)).toMatchObject({ error: 'invalid_plugin_state' })
  })
})

async function runCli(...args: string[]) {
  const child = Bun.spawn([process.execPath, executable, ...args], {
    env: { ...process.env, PASCAL_HOME: testHome, PASCAL_NO_OPEN: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { exitCode, stdout, stderr }
}
