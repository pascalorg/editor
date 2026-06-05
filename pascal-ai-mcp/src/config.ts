import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export type McpMode = 'http' | 'stdio'

export type AppConfig = {
  aiApiKey: string
  aiBaseUrl: string
  aiModel: string
  aiReferer?: string
  aiTitle: string
  aiTemperature: number
  host: string
  port: number
  sessionFile: string
  mcpMode: McpMode
  mcpUrl: string
  mcpToken?: string
  mcpCommand: string
  mcpArgs: string[]
  pascalDataDir?: string
  maxToolRounds: number
}

export function loadConfig(): AppConfig {
  loadDotEnv()

  const sessionFile = resolve(
    process.env.AI_MCP_SESSION_FILE?.trim() || './.data/sessions.json',
  )
  mkdirSync(dirname(sessionFile), { recursive: true })

  const mcpMode = parseMcpMode(process.env.PASCAL_MCP_MODE)

  return {
    aiApiKey: requiredAnyEnv(['OPENROUTER_API_KEY', 'AI_API_KEY']),
    aiBaseUrl: trimTrailingSlash(
      process.env.OPENROUTER_BASE_URL || process.env.AI_BASE_URL || 'https://openrouter.ai/api/v1',
    ),
    aiModel: process.env.OPENROUTER_MODEL || process.env.AI_MODEL || '~openai/gpt-latest',
    aiReferer: emptyToUndefined(process.env.OPENROUTER_HTTP_REFERER || process.env.AI_HTTP_REFERER),
    aiTitle: process.env.OPENROUTER_APP_TITLE || process.env.AI_APP_TITLE || 'Pascal AI MCP',
    aiTemperature: parseFloatWithDefault(
      process.env.OPENROUTER_TEMPERATURE || process.env.AI_TEMPERATURE,
      0.2,
    ),
    host: process.env.AI_MCP_HOST || '0.0.0.0',
    port: parsePort(process.env.AI_MCP_PORT, 8788),
    sessionFile,
    mcpMode,
    mcpUrl: process.env.PASCAL_MCP_URL || 'http://127.0.0.1:3917/mcp',
    mcpToken: emptyToUndefined(process.env.PASCAL_MCP_TOKEN),
    mcpCommand: process.env.PASCAL_MCP_COMMAND || 'bun',
    mcpArgs: splitArgs(process.env.PASCAL_MCP_ARGS || '../packages/mcp/src/bin/pascal-mcp.ts --stdio'),
    pascalDataDir: emptyToUndefined(process.env.PASCAL_DATA_DIR),
    maxToolRounds: parseIntWithDefault(process.env.AI_MCP_MAX_TOOL_ROUNDS, 8),
  }
}

function loadDotEnv(): void {
  const envPath = resolve('.env')
  if (!existsSync(envPath)) return

  const content = readFileSync(envPath, 'utf8')
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    const value = stripQuotes(line.slice(eq + 1).trim())
    if (!(key in process.env)) process.env[key] = value
  }
}

function requiredAnyEnv(names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  throw new Error(`Missing required environment variable: ${names.join(' or ')}`)
}

function parseMcpMode(value: string | undefined): McpMode {
  if (value === 'stdio' || value === 'http') return value
  return 'http'
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10)
  return Number.isFinite(parsed) && parsed > 0 && parsed < 65_536 ? parsed : fallback
}

function parseIntWithDefault(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseFloatWithDefault(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value || '')
  return Number.isFinite(parsed) ? parsed : fallback
}

function emptyToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

function splitArgs(input: string): string[] {
  const matches = input.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []
  return matches.map((part) => stripQuotes(part))
}
