import { afterEach, describe, expect, test } from 'bun:test'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { agentVersionDrift, cliPinFiles } from './sync-agent-versions'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporaryRoots: string[] = []

function fixture(version: string): string {
  const target = mkdtempSync(join(tmpdir(), 'sync-agent-versions-'))
  temporaryRoots.push(target)
  for (const path of [...cliPinFiles, 'server.json']) {
    cpSync(join(root, path), join(target, path), { recursive: true })
  }
  for (const pkg of ['cli', 'mcp']) {
    const path = join(target, 'packages', pkg, 'package.json')
    cpSync(join(root, 'packages', pkg, 'package.json'), path)
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), version }))
  }
  return target
}

afterEach(() => {
  for (const path of temporaryRoots.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('agent integration versions follow the package versions', () => {
  test('the repository is in sync', () => {
    expect([...agentVersionDrift(root).keys()]).toEqual([])
  })

  test('a release bump rewrites the CLI pin and the registry manifest', () => {
    const drift = agentVersionDrift(fixture('9.8.7'))
    expect([...drift.keys()].sort()).toEqual([...cliPinFiles, 'server.json'].sort())

    const cursor = JSON.parse(drift.get('.cursor-plugin/mcp.json') ?? '{}')
    expect(cursor.mcpServers.pascal.args).toContain('--package=@pascal-app/cli@9.8.7')

    const server = JSON.parse(drift.get('server.json') ?? '{}')
    expect(server.version).toBe('9.8.7')
    expect(server.packages).toEqual([
      expect.objectContaining({ identifier: '@pascal-app/mcp', version: '9.8.7' }),
    ])
  })

  test('a beta release keeps every integration on the last stable version', () => {
    expect([...agentVersionDrift(fixture('9.8.7-beta.1')).keys()]).toEqual([])
  })
})
