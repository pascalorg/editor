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
  // Plan-first temperature split (批次 D): intent generation wants a little
  // variety across correction rounds; the experimental LLM-geometry path
  // wants none at all. Scene-agent/repair calls keep aiTemperature.
  aiTemperatureIntent: number
  aiTemperatureGeometry: number
  aiRequestTimeoutMs: number
  azureDeployment?: string
  azureApiVersion: string
  host: string
  port: number
  // Upper bound for a /chat body. The editor allows 20MB source images;
  // base64 inflates that to ~26.7MB plus JSON overhead, so the two limits
  // must move together (ARCHITECTURE_TASKS.md T0.3).
  maxRequestBodyBytes: number
  // Graceful-shutdown budget: how long to wait for queued session writes
  // before giving up and exiting non-zero.
  shutdownDrainTimeoutMs: number
  sessionFile: string
  mcpMode: McpMode
  mcpUrl: string
  mcpToken?: string
  mcpCommand: string
  mcpArgs: string[]
  mcpRequestTimeoutMs: number
  pascalDataDir?: string
  maxToolRounds: number
  maxClarificationRounds: number
  maxRepairRounds: number
  maxModelCallsPerTurn: number
  maxModelCallsPerSession: number
  usableConfidence: number
  partialConfidence: number
  // Market/regulation profile id (NORMS_PROFILE_DESIGN.md §1); unknown ids
  // resolve to the default profile.
  normProfile: string
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
    aiTemperatureIntent: parseFloatWithDefault(process.env.AI_TEMPERATURE_INTENT, 0.3),
    aiTemperatureGeometry: parseFloatWithDefault(process.env.AI_TEMPERATURE_GEOMETRY, 0),
    // Per-attempt timeout for a single model API call. Without this, a
    // hung upstream request blocks that session's lock forever (the
    // conversation never recovers until the process is restarted).
    aiRequestTimeoutMs: parseIntWithDefault(process.env.AI_REQUEST_TIMEOUT_MS, 60_000),
    azureDeployment,
    azureApiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-10-21',
    // Loopback by default: the service has no authentication, so exposing it
    // beyond the local machine must be an explicit operator decision.
    host: process.env.AI_MCP_HOST || '127.0.0.1',
    port: parsePort(process.env.AI_MCP_PORT, 8788),
    maxRequestBodyBytes: parseIntWithDefault(process.env.AI_MCP_MAX_BODY_MB, 28) * 1024 * 1024,
    shutdownDrainTimeoutMs: parseIntWithDefault(process.env.AI_MCP_DRAIN_TIMEOUT_MS, 5_000),
    sessionFile,
    mcpMode,
    mcpUrl: process.env.PASCAL_MCP_URL || 'http://127.0.0.1:3917/mcp',
    mcpToken: emptyToUndefined(process.env.PASCAL_MCP_TOKEN),
    mcpCommand: process.env.PASCAL_MCP_COMMAND || 'bun',
    mcpArgs: splitArgs(process.env.PASCAL_MCP_ARGS || '../packages/mcp/src/bin/pascal-mcp.ts --stdio'),
    // Per-call timeout for a single MCP tool invocation. Without this a hung
    // MCP call blocks the session's lock forever (the conversation never
    // recovers until the process is restarted). Generation tools (e.g.
    // create_house_from_brief) can legitimately take a while, so the default
    // is generous.
    mcpRequestTimeoutMs: parseIntWithDefault(
      process.env.PASCAL_MCP_REQUEST_TIMEOUT_MS || process.env.AI_MCP_REQUEST_TIMEOUT_MS,
      120_000,
    ),
    pascalDataDir: emptyToUndefined(process.env.PASCAL_DATA_DIR),
    maxToolRounds: parseIntWithDefault(process.env.AI_MCP_MAX_TOOL_ROUNDS, 12),
    maxClarificationRounds: parseIntWithDefault(process.env.AI_MAX_CLARIFICATION_ROUNDS, 3),
    // 批次 D：structure/openings/furniture are deterministic now, so repair
    // rounds only chase decorative issues — two rounds is the budget (§5).
    maxRepairRounds: parseIntWithDefault(process.env.AI_MAX_REPAIR_ROUNDS, 2),
    // Absolute safety ceiling on model API calls in a single chat turn. All
    // internal loops are already individually bounded (tool rounds, phases,
    // repair/clarification rounds), so this only trips on pathological
    // runaway — it exists to cap cost/latency, not to gate normal jobs.
    maxModelCallsPerTurn: parseIntWithDefault(process.env.AI_MAX_MODEL_CALLS_PER_TURN, 200),
    // Cumulative ceiling across all turns of one session. A single turn is
    // already capped by maxModelCallsPerTurn; this stops an unbounded
    // multi-turn conversation from accumulating cost without limit.
    maxModelCallsPerSession: parseIntWithDefault(process.env.AI_MAX_MODEL_CALLS_PER_SESSION, 1000),
    usableConfidence: parseBoundedFloat(process.env.AI_USABLE_CONFIDENCE, 0.8),
    partialConfidence: parseBoundedFloat(process.env.AI_PARTIAL_CONFIDENCE, 0.5),
    normProfile: process.env.PASCAL_NORM_PROFILE?.trim() || 'default',
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
