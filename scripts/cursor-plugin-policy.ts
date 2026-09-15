import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function validateCursorPluginPackage(root: string): string[] {
  const failures: string[] = []
  const read = (path: string): Record<string, unknown> => {
    try {
      return JSON.parse(readFileSync(join(root, path), 'utf8'))
    } catch {
      failures.push(`Cursor package file is missing or invalid: ${path}`)
      return {}
    }
  }
  const rootManifest = read('.cursor-plugin/plugin.json')
  const manifest = read('skills/.cursor-plugin/plugin.json')
  const rootConfig = read('.cursor-plugin/mcp.json')
  const config = read('skills/.cursor-plugin/mcp.json')
  const expectedManifest = {
    ...rootManifest,
    skills: ['./pascal-3d', './furniture-fit'],
    logo: '.cursor-plugin/pascal-mark-plate.svg',
  }
  if (JSON.stringify(manifest) !== JSON.stringify(expectedManifest)) {
    failures.push(
      'Cursor skills-root manifest must match the root manifest with local skill and logo paths',
    )
  }
  if (manifest.mcpServers !== './.cursor-plugin/mcp.json') {
    failures.push('Cursor skills-root manifest must explicitly select its native MCP config')
  }
  if (JSON.stringify(config) !== JSON.stringify(rootConfig)) {
    failures.push('Cursor MCP configs must match at both install roots')
  }
  const expectedLocalServer = {
    type: 'stdio',
    command: 'npx',
    args: ['--yes', '--package=@pascal-app/cli@1.0.0', 'pascal', 'mcp', 'connect'],
  }
  if (
    JSON.stringify((config.mcpServers as Record<string, unknown> | undefined)?.pascal) !==
    JSON.stringify(expectedLocalServer)
  ) {
    failures.push(
      'Cursor local MCP must bootstrap the pinned npm CLI without a global Pascal dependency',
    )
  }
  const expectedHostedServer = {
    type: 'http',
    url: 'https://editor.pascal.app/api/mcp',
    auth: {
      CLIENT_ID: 'pascal-cursor',
      scopes: ['openid', 'profile', 'offline_access', 'scene:read', 'scene:write'],
    },
  }
  if (
    JSON.stringify(
      (config.mcpServers as Record<string, unknown> | undefined)?.['pascal-hosted'],
    ) !== JSON.stringify(expectedHostedServer)
  ) {
    failures.push('Cursor hosted MCP must use managed browser OAuth without an API-key header')
  }
  if (
    'variables' in rootManifest ||
    'variables' in manifest ||
    JSON.stringify(config).includes('${')
  ) {
    failures.push('Cursor browser sign-in must not require plugin secrets or placeholders')
  }
  for (const path of [
    'pascal-3d/SKILL.md',
    'furniture-fit/SKILL.md',
    '.cursor-plugin/pascal-mark-plate.svg',
  ]) {
    if (!existsSync(join(root, 'skills', path))) {
      failures.push(`Cursor install must contain ${path}`)
    }
  }
  const logo = 'skills/.cursor-plugin/pascal-mark-plate.svg'
  if (
    existsSync(join(root, logo)) &&
    !readFileSync(join(root, logo)).equals(readFileSync(join(root, 'assets/pascal-mark-plate.svg')))
  ) {
    failures.push('Cursor skills-root logo must match the canonical logo')
  }
  return failures
}
