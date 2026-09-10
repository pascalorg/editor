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
  if (!isRecord(servers) || !hasExactKeys(servers, ['pascal'])) {
    return ['skills/.mcp.json must contain exactly one server named pascal']
  }

  const pascal = servers.pascal
  if (!isRecord(pascal) || !hasExactKeys(pascal, ['type', 'command', 'args'])) {
    failures.push(
      'skills/.mcp.json pascal server must contain only type, command, and args; remote or credential fields are not allowed',
    )
    return failures
  }

  if (pascal.type !== 'stdio') failures.push('skills/.mcp.json pascal server type must be stdio')
  if (pascal.command !== 'pascal')
    failures.push('skills/.mcp.json pascal server command must be pascal')
  if (
    !Array.isArray(pascal.args) ||
    pascal.args.length !== 2 ||
    pascal.args[0] !== 'mcp' ||
    pascal.args[1] !== 'connect'
  ) {
    failures.push('skills/.mcp.json pascal server args must be exactly ["mcp", "connect"]')
  }

  if (!isRecord(pluginManifest)) {
    failures.push('Claude plugin manifest must be an object')
  } else {
    if ('mcpServers' in pluginManifest) {
      failures.push('Claude plugin manifest must not define inline MCP servers')
    }
    if ('userConfig' in pluginManifest) {
      failures.push('Claude plugin manifest must not request credentials or user configuration')
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
