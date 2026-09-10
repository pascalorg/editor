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
export const hostedApiKeyOption = 'pascal_api_key'
export const hostedAuthorizationHeader = `Bearer \${user_config.${hostedApiKeyOption}}`

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

function validateHostedServer(server: unknown, failures: string[]): void {
  if (!isRecord(server) || !hasExactKeys(server, ['type', 'url', 'headers'])) {
    failures.push('skills/.mcp.json pascal-hosted server must contain only type, url, and headers')
    return
  }

  if (server.type !== 'http')
    failures.push('skills/.mcp.json pascal-hosted server type must be http')
  if (server.url !== hostedMcpUrl)
    failures.push(`skills/.mcp.json pascal-hosted server url must be ${hostedMcpUrl}`)

  const headers = server.headers
  if (!isRecord(headers) || !hasExactKeys(headers, ['Authorization'])) {
    failures.push('skills/.mcp.json pascal-hosted server must send only an Authorization header')
    return
  }
  // The header must stay a ${user_config.*} reference. A literal token here would publish a
  // credential in the installed plugin source instead of resolving it from the host's secret store.
  if (headers.Authorization !== hostedAuthorizationHeader) {
    failures.push(
      `skills/.mcp.json pascal-hosted Authorization header must be exactly "${hostedAuthorizationHeader}"`,
    )
  }
}

function validateUserConfig(userConfig: unknown, failures: string[]): void {
  if (!isRecord(userConfig) || !hasExactKeys(userConfig, [hostedApiKeyOption])) {
    failures.push(
      `Claude plugin manifest must declare exactly one user configuration option named ${hostedApiKeyOption}`,
    )
    return
  }

  const option = userConfig[hostedApiKeyOption]
  if (!isRecord(option)) {
    failures.push(`Claude plugin manifest ${hostedApiKeyOption} option must be an object`)
    return
  }

  if (option.type !== 'string') {
    failures.push(`Claude plugin manifest ${hostedApiKeyOption} type must be string`)
  }
  if (option.sensitive !== true) {
    failures.push(
      `Claude plugin manifest ${hostedApiKeyOption} must be sensitive so the key is stored outside settings.json`,
    )
  }
  if (option.required !== false) {
    failures.push(
      `Claude plugin manifest ${hostedApiKeyOption} must set required to false so the local connector works without a key`,
    )
  }
  if ('default' in option) {
    failures.push(`Claude plugin manifest ${hostedApiKeyOption} must not ship a default credential`)
  }
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
    validateUserConfig(pluginManifest.userConfig, failures)
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
