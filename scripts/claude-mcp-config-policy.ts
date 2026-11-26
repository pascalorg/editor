function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  )
}

export const hostedMcpUrl = 'https://editor.pascal.app/api/mcp'

function validateLocalServer(server: unknown, failures: string[]): void {
  if (!isRecord(server) || !hasExactKeys(server, ['type', 'command', 'args'])) {
    failures.push(
      'skills/.mcp.json pascal server must contain only type, command, and args; remote or credential fields are not allowed',
    )
    return
  }

  if (server.type !== 'stdio') failures.push('skills/.mcp.json pascal server type must be stdio')
  if (server.command !== 'pascal')
    failures.push('skills/.mcp.json pascal server command must be pascal')
  if (
    !Array.isArray(server.args) ||
    server.args.length !== 2 ||
    server.args[0] !== 'mcp' ||
    server.args[1] !== 'connect'
  ) {
    failures.push('skills/.mcp.json pascal server args must be exactly ["mcp", "connect"]')
  }
}

// Claude, Claude Desktop, Cowork and Claude Code connect a plain URL through the server's OAuth
// (CIMD); a header or ${user_config.*} reference would ship a credential path the web apps ignore.
function validateHostedServer(server: unknown, failures: string[]): void {
  if (!isRecord(server) || !hasExactKeys(server, ['type', 'url'])) {
    failures.push(
      'skills/.mcp.json pascal-hosted server must contain only type and url; it signs in with OAuth, not headers',
    )
    return
  }

  if (server.type !== 'http')
    failures.push('skills/.mcp.json pascal-hosted server type must be http')
  if (server.url !== hostedMcpUrl)
    failures.push(`skills/.mcp.json pascal-hosted server url must be ${hostedMcpUrl}`)
}

export function validateClaudeMcpPolicy(
  config: unknown,
  pluginManifest: unknown,
  marketplaceEntry: unknown,
): string[] {
  const failures: string[] = []
  if (!isRecord(config) || !hasExactKeys(config, ['mcpServers'])) {
    return ['skills/.mcp.json must contain only the mcpServers object']
  }

  const servers = config.mcpServers
  if (!isRecord(servers) || !hasExactKeys(servers, ['pascal', 'pascal-hosted'])) {
    return ['skills/.mcp.json must declare exactly the pascal and pascal-hosted servers']
  }

  validateLocalServer(servers.pascal, failures)
  validateHostedServer(servers['pascal-hosted'], failures)

  if (!isRecord(pluginManifest)) {
    failures.push('Claude plugin manifest must be an object')
  } else {
    if ('mcpServers' in pluginManifest) {
      failures.push('Claude plugin manifest must not define inline MCP servers')
    }
    if ('userConfig' in pluginManifest) {
      failures.push(
        'Claude plugin manifest must not ask for configuration; the hosted server signs in with OAuth',
      )
    }
  }

  if (!isRecord(marketplaceEntry)) {
    failures.push('Claude marketplace plugin entry must be an object')
  } else {
    if ('mcpServers' in marketplaceEntry) {
      failures.push('Claude marketplace entry must not override the plugin MCP configuration')
    }
    if ('headers' in marketplaceEntry || 'headersHelper' in marketplaceEntry) {
      failures.push('Claude marketplace entry must not request download credentials')
    }
  }

  return failures
}
