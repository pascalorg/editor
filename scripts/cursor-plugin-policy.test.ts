import { afterEach, describe, expect, test } from 'bun:test'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateCursorPluginPackage } from './cursor-plugin-policy'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporaryRoots: string[] = []

function fixture(): string {
  const target = mkdtempSync(join(tmpdir(), 'cursor-plugin-policy-'))
  temporaryRoots.push(target)
  for (const path of ['skills', '.cursor-plugin', 'assets']) {
    cpSync(join(root, path), join(target, path), { recursive: true })
  }
  return target
}

afterEach(() => {
  for (const path of temporaryRoots.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('Cursor marketplace installs from skills/', () => {
  test('ships a complete native package at the actual marketplace root', () => {
    expect(validateCursorPluginPackage(root)).toEqual([])
  })

  test('rejects the old Claude-only install root', () => {
    const target = fixture()
    rmSync(join(target, 'skills/.cursor-plugin'), { recursive: true })
    expect(validateCursorPluginPackage(target).length).toBeGreaterThan(0)
  })

  test('rejects falling back to the Claude MCP config', () => {
    const target = fixture()
    const path = join(target, 'skills/.cursor-plugin/plugin.json')
    const manifest = JSON.parse(readFileSync(path, 'utf8'))
    manifest.mcpServers = './.mcp.json'
    writeFileSync(path, JSON.stringify(manifest))
    expect(validateCursorPluginPackage(target)).toContain(
      'Cursor skills-root manifest must explicitly select its native MCP config',
    )
  })

  test.each([
    { type: 'stdio', command: 'pascal', args: ['mcp', 'connect'] },
    { type: 'stdio', command: 'npx', args: ['--yes', '@pascal-app/cli@latest', 'mcp', 'connect'] },
  ])('rejects a missing global executable or floating release: %j', (server) => {
    const target = fixture()
    for (const name of ['.cursor-plugin/mcp.json', 'skills/.cursor-plugin/mcp.json']) {
      const path = join(target, name)
      const config = JSON.parse(readFileSync(path, 'utf8'))
      config.mcpServers.pascal = server
      writeFileSync(path, JSON.stringify(config))
    }
    expect(validateCursorPluginPackage(target)).toContain(
      'Cursor local MCP must bootstrap the pinned npm CLI without a global Pascal dependency',
    )
  })
  test('rejects a legacy API-key header on the browser OAuth server', () => {
    const target = fixture()
    for (const name of ['.cursor-plugin/mcp.json', 'skills/.cursor-plugin/mcp.json']) {
      const path = join(target, name)
      const config = JSON.parse(readFileSync(path, 'utf8'))
      config.mcpServers['pascal-hosted'].headers = { Authorization: `Bearer \${PASCAL_API_KEY}` }
      writeFileSync(path, JSON.stringify(config))
    }
    expect(validateCursorPluginPackage(target)).toContain(
      'Cursor hosted MCP must use managed browser OAuth without an API-key header',
    )
    expect(validateCursorPluginPackage(target)).toContain(
      'Cursor browser sign-in must not require plugin secrets or placeholders',
    )
  })
})
