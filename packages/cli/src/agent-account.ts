import { CliError } from './errors.js'

const CLAIM_ENDPOINT = 'https://editor.pascal.app/api/auth/agent/claim/start'
const CLAIM_PAGE = 'https://editor.pascal.app/settings/agents/claim'
const MAX_RESPONSE_BYTES = 32 * 1024
const DEFAULT_TIMEOUT_MS = 15_000
const CLAIM_CODE_PATTERN =
  /^[23456789BCDFGHJKLMNPQRSTVWXZ]{4}(?:-[23456789BCDFGHJKLMNPQRSTVWXZ]{4}){2}$/

export interface AgentClaim {
  claimCode: string
  claimUrl: string
  expiresAt: string
}

export function agentClaimHandoffUrl(claim: AgentClaim): string {
  const url = new URL(claim.claimUrl)
  url.searchParams.set('code', claim.claimCode)
  return url.toString()
}

interface StartAgentClaimOptions {
  fetch?: typeof fetch
  timeoutMs?: number
}

export async function startAgentClaim(
  apiKey: string,
  options: StartAgentClaimOptions = {},
): Promise<AgentClaim> {
  const credential = apiKey.trim()
  if (!credential) {
    throw new CliError(
      'agent_api_key_missing',
      "Set PASCAL_API_KEY to this autonomous agent's API key and try again.",
    )
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    let response: Response
    try {
      response = await (options.fetch ?? fetch)(CLAIM_ENDPOINT, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${credential}`,
        },
        redirect: 'error',
        signal: controller.signal,
      })
    } catch {
      if (controller.signal.aborted) {
        throw claimTimeout()
      }
      throw new CliError(
        'agent_claim_unavailable',
        'Pascal could not be reached while starting the agent claim. Try again.',
      )
    }

    if (!response.ok) {
      if (response.body) void response.body.cancel().catch(() => {})
      throw claimResponseError(response.status)
    }
    const body = await readJsonResponse(response, controller.signal)
    if (!isAgentClaim(body)) throw invalidResponse()
    return {
      claimCode: body.claimCode,
      claimUrl: body.claimUrl,
      expiresAt: body.expiresAt,
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function readJsonResponse(response: Response, signal: AbortSignal): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw invalidResponse()
  }

  if (!response.body) throw invalidResponse()
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  while (true) {
    let chunk
    try {
      chunk = await reader.read()
    } catch {
      if (signal.aborted) throw claimTimeout()
      throw invalidResponse()
    }
    if (chunk.done) break
    bytes += chunk.value.byteLength
    if (bytes > MAX_RESPONSE_BYTES) {
      void reader.cancel().catch(() => {})
      throw invalidResponse()
    }
    text += decoder.decode(chunk.value, { stream: true })
  }
  text += decoder.decode()

  try {
    return JSON.parse(text) as unknown
  } catch {
    throw invalidResponse()
  }
}

function isAgentClaim(value: unknown): value is AgentClaim {
  if (!isRecord(value)) return false
  if (typeof value.claimCode !== 'string' || !CLAIM_CODE_PATTERN.test(value.claimCode)) return false
  if (typeof value.expiresAt !== 'string') return false
  const expiresAt = Date.parse(value.expiresAt)
  if (Number.isNaN(expiresAt) || new Date(expiresAt).toISOString() !== value.expiresAt) return false
  return value.claimUrl === CLAIM_PAGE
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function claimResponseError(status: number): CliError {
  switch (status) {
    case 400:
      return new CliError(
        'agent_claim_not_available',
        'This agent credential cannot start a claim.',
        { status },
      )
    case 401:
      return new CliError('agent_claim_unauthorized', 'PASCAL_API_KEY is invalid or revoked.', {
        status,
      })
    case 403:
      return new CliError(
        'agent_claim_forbidden',
        'PASCAL_API_KEY must belong to an autonomous Pascal agent.',
        { status },
      )
    case 409:
      return new CliError('agent_already_claimed', 'This agent has already been claimed.', {
        status,
      })
    case 429:
      return new CliError(
        'agent_claim_rate_limited',
        'Too many agent claim attempts. Wait and try again.',
        { status },
      )
    default:
      return new CliError(
        'agent_claim_failed',
        `Pascal could not start the agent claim (HTTP ${status}).`,
        { status },
      )
  }
}

function invalidResponse(): CliError {
  return new CliError(
    'agent_claim_invalid_response',
    'Pascal returned an invalid agent claim response. Try again.',
  )
}

function claimTimeout(): CliError {
  return new CliError(
    'agent_claim_timeout',
    'Pascal did not respond while starting the agent claim. Try again.',
  )
}
