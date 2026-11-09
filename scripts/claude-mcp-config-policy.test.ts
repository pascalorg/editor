import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  hostedAuthorizationHeader,
  hostedMcpUrl,
  validateClaudeMcpPolicy,
} from './claude-mcp-config-policy'

const repositoryRoot = resolve(import.meta.dir, '..')
const canonicalConfig = JSON.parse(
  readFileSync(join(repositoryRoot, 'skills', '.mcp.json'), 'utf8'),
) as unknown
const canonicalPlugin = JSON.parse(
  readFileSync(join(repositoryRoot, 'skills', '.claude-plugin', 'plugin.json'), 'utf8'),
) as Record<string, unknown>
const marketplace = JSON.parse(
  readFileSync(join(repositoryRoot, '.claude-plugin', 'marketplace.json'), 'utf8'),
) as { plugins: Array<Record<string, unknown>> }
const canonicalMarketplaceEntry = marketplace.plugins[0]!
const upgradeGuidancePaths = [
  'README.md',
  'skills/README.md',
  'skills/VALIDATION.md',
  'skills/pascal-3d/references/setup.md',
  'skills/furniture-fit/references/setup.md',
] as const
const hostedGuidancePaths = [
  'skills/pascal-3d/references/setup.md',
  'skills/furniture-fit/references/setup.md',
] as const

const localServer = { type: 'stdio', command: 'pascal', args: ['mcp', 'connect'] }
const hostedServer = {
  type: 'http',
  url: hostedMcpUrl,
  headers: { Authorization: hostedAuthorizationHeader },
}

function withServers(servers: Record<string, unknown>): Record<string, unknown> {
  return { mcpServers: servers }
}

const canonicalKeyOption = (canonicalPlugin.userConfig as Record<string, unknown>)
  .pascal_api_key as Record<string, unknown>

function pluginWithUserConfig(userConfig: unknown): Record<string, unknown> {
  return { ...canonicalPlugin, userConfig }
}

describe('Claude plugin MCP configuration', () => {
  test('accepts the local connector beside the hosted endpoint', () => {
    expect(
      validateClaudeMcpPolicy(canonicalConfig, canonicalPlugin, canonicalMarketplaceEntry),
    ).toEqual([])
  })

  test.each([
    ['a third server', withServers({ pascal: localServer, 'pascal-hosted': hostedServer, o: {} })],
    ['a missing hosted server', withServers({ pascal: localServer })],
    ['a missing local server', withServers({ 'pascal-hosted': hostedServer })],
    [
      'a remote URL on the local server',
      withServers({
        pascal: { type: 'http', url: 'https://editor.pascal.app/api/mcp' },
        'pascal-hosted': hostedServer,
      }),
    ],
    [
      'request headers on the local server',
      withServers({
        pascal: { ...localServer, headers: { Authorization: 'Bearer placeholder' } },
        'pascal-hosted': hostedServer,
      }),
    ],
    [
      'environment credentials on the local server',
      withServers({
        pascal: { ...localServer, env: { PASCAL_API_KEY: 'placeholder' } },
        'pascal-hosted': hostedServer,
      }),
    ],
  ])('rejects %s', (_label, config) => {
    expect(
      validateClaudeMcpPolicy(config, canonicalPlugin, canonicalMarketplaceEntry).length,
    ).toBeGreaterThan(0)
  })

  test.each([
    [
      'a literal hosted credential',
      { ...hostedServer, headers: { Authorization: 'Bearer pascal_live_placeholder' } },
    ],
    [
      'an unexpected hosted header',
      { ...hostedServer, headers: { ...hostedServer.headers, 'X-Pascal-Org': 'acme' } },
    ],
    ['a redirected hosted URL', { ...hostedServer, url: 'https://mcp.example.com/api/mcp' }],
    ['a non-HTTP hosted transport', { ...hostedServer, type: 'sse' }],
    ['a hosted download helper', { ...hostedServer, headersHelper: './fetch-headers.sh' }],
  ])('rejects hosted %s', (_label, server) => {
    expect(
      validateClaudeMcpPolicy(
        withServers({ pascal: localServer, 'pascal-hosted': server }),
        canonicalPlugin,
        canonicalMarketplaceEntry,
      ).length,
    ).toBeGreaterThan(0)
  })

  test('rejects command or argument changes', () => {
    expect(
      validateClaudeMcpPolicy(
        withServers({
          pascal: { type: 'stdio', command: 'npx', args: ['pascal', 'mcp', 'connect'] },
          'pascal-hosted': hostedServer,
        }),
        canonicalPlugin,
        canonicalMarketplaceEntry,
      ),
    ).toEqual([
      'skills/.mcp.json pascal server command must be pascal',
      'skills/.mcp.json pascal server args must be exactly ["mcp", "connect"]',
    ])
  })

  test.each([
    ['inline MCP servers', { ...canonicalPlugin, mcpServers: { remote: {} } }],
    ['a missing hosted key option', pluginWithUserConfig(undefined)],
    [
      'an extra user configuration option',
      pluginWithUserConfig({
        pascal_api_key: canonicalKeyOption,
        pascal_password: { type: 'string', sensitive: true, required: false },
      }),
    ],
    [
      'a plaintext hosted key option',
      pluginWithUserConfig({ pascal_api_key: { ...canonicalKeyOption, sensitive: false } }),
    ],
    [
      'a required hosted key option',
      pluginWithUserConfig({ pascal_api_key: { ...canonicalKeyOption, required: true } }),
    ],
    [
      'a default hosted credential',
      pluginWithUserConfig({ pascal_api_key: { ...canonicalKeyOption, default: 'placeholder' } }),
    ],
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

describe('Claude plugin MCP upgrade guidance', () => {
  test.each(upgradeGuidancePaths)('%s warns about the duplicate local connection', (path) => {
    const content = readFileSync(join(repositoryRoot, path), 'utf8')
    expect(content).toContain('Claude Code 2.1.258 loads both')
    expect(content).toContain('claude mcp remove --scope user pascal')
    expect(content).toContain('before reloading or restarting Claude Code')
    expect(content).toContain('one-active-agent-client-per-local-service requirement')
  })

  test.each(hostedGuidancePaths)('%s documents the plugin hosted key path', (path) => {
    const content = readFileSync(join(repositoryRoot, path), 'utf8')
    expect(content).toContain('pascal-hosted')
    expect(content).toContain(
      'claude plugin install pascal-agent-skills@pascal --config pascal_api_key=',
    )
    expect(content).toContain('keychain')
  })
})
