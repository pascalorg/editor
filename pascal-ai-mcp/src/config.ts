import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export type McpMode = 'http' | 'stdio'
export type AiProvider = 'openai-compatible' | 'azure-openai'

export type AppConfig = {
  aiProvider: AiProvider
  aiApiKey?: string
  aiFallbackApiKey?: string
  aiBaseUrl: string
  aiModel: string
  aiFastModel: string
  aiFallbackModel?: string
  aiReferer?: string
  aiTitle: string
  aiTemperature: number
  aiRequestTimeoutMs: number
  azureDeployment?: string
  azureApiVersion: string
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
  maxClarificationRounds: number
  maxRepairRounds: number
  usableConfidence: number
  partialConfidence: number
}

export function loadConfig(): AppConfig {
  loadDotEnv()

  const sessionFile = resolve(
    process.env.AI_MCP_SESSION_FILE?.trim() || './.data/sessions.json',
  )
  mkdirSync(dirname(sessionFile), { recursive: true })

  const mcpMode = parseMcpMode(process.env.PASCAL_MCP_MODE)
  const aiProvider = parseAiProvider(process.env.AI_PROVIDER)
  const azureDeployment = emptyToUndefined(process.env.AZURE_OPENAI_DEPLOYMENT)
  const aiModel = aiProvider === 'azure-openai'
    ? azureDeployment || process.env.AI_MODEL || ''
    : process.env.OPENROUTER_MODEL || process.env.AI_MODEL || '~openai/gpt-latest'
  // Fast/cheap model for low-stakes classification calls (e.g. scene intent
  // routing). Falls back to the main model when not configured, so this is a
  // no-op until a fast model is explicitly set.
  const aiFastModel = aiProvider === 'azure-openai'
    ? emptyToUndefined(process.env.AZURE_OPENAI_FAST_DEPLOYMENT) || aiModel
    : process.env.OPENROUTER_FAST_MODEL || process.env.AI_FAST_MODEL || aiModel

  return {
    aiProvider,
    aiApiKey: aiProvider === 'azure-openai'
      ? optionalAnyEnv(['AZURE_OPENAI_API_KEY', 'AI_API_KEY'])
      : optionalAnyEnv(['OPENROUTER_API_KEY', 'AI_API_KEY']),
    aiFallbackApiKey: emptyToUndefined(
      process.env.OPENROUTER_FALLBACK_API_KEY || process.env.AI_FALLBACK_API_KEY,
    ),
    aiBaseUrl: trimTrailingSlash(aiProvider === 'azure-openai'
      ? process.env.AZURE_OPENAI_ENDPOINT || process.env.AI_BASE_URL || ''
      : process.env.OPENROUTER_BASE_URL || process.env.AI_BASE_URL || 'https://openrouter.ai/api/v1'),
    aiModel,
    aiFastModel,
    aiFallbackModel: emptyToUndefined(
      process.env.OPENROUTER_FALLBACK_MODEL || process.env.AI_FALLBACK_MODEL,
    ),
    aiReferer: emptyToUndefined(process.env.OPENROUTER_HTTP_REFERER || process.env.AI_HTTP_REFERER),
    aiTitle: process.env.OPENROUTER_APP_TITLE || process.env.AI_APP_TITLE || 'Pascal AI MCP',
    aiTemperature: parseFloatWithDefault(
      process.env.OPENROUTER_TEMPERATURE || process.env.AI_TEMPERATURE,
      0.2,
    ),
    // Per-attempt timeout for a single model API call. Without this, a
    // hung upstream request blocks that session's lock forever (the
    // conversation never recovers until the process is restarted).
    aiRequestTimeoutMs: parseIntWithDefault(process.env.AI_REQUEST_TIMEOUT_MS, 60_000),
    azureDeployment,
    azureApiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-10-21',
    host: process.env.AI_MCP_HOST || '0.0.0.0',
    port: parsePort(process.env.AI_MCP_PORT, 8788),
    sessionFile,
    mcpMode,
    mcpUrl: process.env.PASCAL_MCP_URL || 'http://127.0.0.1:3917/mcp',
    mcpToken: emptyToUndefined(process.env.PASCAL_MCP_TOKEN),
    mcpCommand: process.env.PASCAL_MCP_COMMAND || 'bun',
    mcpArgs: splitArgs(process.env.PASCAL_MCP_ARGS || '../packages/mcp/src/bin/pascal-mcp.ts --stdio'),
    pascalDataDir: emptyToUndefined(process.env.PASCAL_DATA_DIR),
    maxToolRounds: parseIntWithDefault(process.env.AI_MCP_MAX_TOOL_ROUNDS, 12),
    maxClarificationRounds: parseIntWithDefault(process.env.AI_MAX_CLARIFICATION_ROUNDS, 3),
    maxRepairRounds: parseIntWithDefault(process.env.AI_MAX_REPAIR_ROUNDS, 3),
    usableConfidence: parseBoundedFloat(process.env.AI_USABLE_CONFIDENCE, 0.8),
    partialConfidence: parseBoundedFloat(process.env.AI_PARTIAL_CONFIDENCE, 0.5),
  }
}

function parseAiProvider(value: string | undefined): AiProvider {
  return value === 'azure-openai' ? value : 'openai-compatible'
}

function loadDotEnv(): void {
  for (const envPath of [resolve('../.env.local'), resolve('../.env'), resolve('.env')]) {
    if (!existsSync(envPath)) continue
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
}

function optionalAnyEnv(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return undefined
}

function parseMcpMode(value: string | undefined): McpMode {
  if (value === 'stdio' || value === 'http') return value
  return 'stdio'
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

function parseBoundedFloat(value: string | undefined, fallback: number): number {
  const parsed = parseFloatWithDefault(value, fallback)
  return parsed >= 0 && parsed <= 1 ? parsed : fallback
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
