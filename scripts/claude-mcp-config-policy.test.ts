import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { validateClaudeMcpPolicy } from './claude-mcp-config-policy'

const repositoryRoot = resolve(import.meta.dir, '..')
const canonicalConfig = JSON.parse(
  readFileSync(join(repositoryRoot, '.mcp.json'), 'utf8'),
) as unknown
const canonicalPlugin = JSON.parse(
  readFileSync(join(repositoryRoot, '.claude-plugin', 'plugin.json'), 'utf8'),
) as Record<string, unknown>
const marketplace = JSON.parse(
  readFileSync(join(repositoryRoot, '.claude-plugin', 'marketplace.json'), 'utf8'),
) as { plugins: Array<Record<string, unknown>> }
const canonicalMarketplaceEntry = marketplace.plugins[0]!

describe('Claude plugin MCP configuration', () => {
  test('uses the protected local connector configuration', () => {
    expect(
      validateClaudeMcpPolicy(canonicalConfig, canonicalPlugin, canonicalMarketplaceEntry),
    ).toEqual([])
  })

  test.each([
    ['another server', { ...canonicalConfig, mcpServers: { pascal: {}, other: {} } }],
    [
      'a remote URL',
      { mcpServers: { pascal: { type: 'http', url: 'https://editor.pascal.app/api/mcp' } } },
    ],
    [
      'request headers',
      {
        mcpServers: {
          pascal: {
            type: 'stdio',
            command: 'pascal',
            args: ['mcp', 'connect'],
            headers: { Authorization: 'Bearer placeholder' },
          },
        },
      },
    ],
    [
      'environment credentials',
      {
        mcpServers: {
          pascal: {
            type: 'stdio',
            command: 'pascal',
            args: ['mcp', 'connect'],
            env: { PASCAL_API_KEY: 'placeholder' },
          },
        },
      },
    ],
  ])('rejects %s', (_label, config) => {
    expect(
      validateClaudeMcpPolicy(config, canonicalPlugin, canonicalMarketplaceEntry).length,
    ).toBeGreaterThan(0)
  })

  test('rejects command or argument changes', () => {
    expect(
      validateClaudeMcpPolicy(
        {
          mcpServers: {
            pascal: { type: 'stdio', command: 'npx', args: ['pascal', 'mcp', 'connect'] },
          },
        },
        canonicalPlugin,
        canonicalMarketplaceEntry,
      ),
    ).toEqual([
      '.mcp.json pascal server command must be pascal',
      '.mcp.json pascal server args must be exactly ["mcp", "connect"]',
    ])
  })

  test.each([
    ['inline MCP servers', { ...canonicalPlugin, mcpServers: { remote: {} } }],
    ['user configuration', { ...canonicalPlugin, userConfig: { apiKey: { sensitive: true } } }],
  ])('rejects plugin-manifest %s', (_label, pluginManifest) => {
    expect(
      validateClaudeMcpPolicy(canonicalConfig, pluginManifest, canonicalMarketplaceEntry).length,
    ).toBeGreaterThan(0)
  })

  test.each([
    [
      'MCP override',
      { ...canonicalMarketplaceEntry, mcpServers: { remote: { url: 'https://example.com' } } },
    ],
    [
      'download credentials',
      { ...canonicalMarketplaceEntry, headers: { Authorization: 'Bearer placeholder' } },
    ],
  ])('rejects marketplace-entry %s', (_label, marketplaceEntry) => {
    expect(
      validateClaudeMcpPolicy(canonicalConfig, canonicalPlugin, marketplaceEntry).length,
    ).toBeGreaterThan(0)
  })
})
