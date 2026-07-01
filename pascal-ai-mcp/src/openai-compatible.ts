import type { ChatCompletionResponse, ChatMessage, OpenAiTool } from './types'

export type ModelClientOptions = {
  provider: 'openai-compatible' | 'azure-openai'
  apiKey: string
  baseUrl: string
  model: string
  referer?: string
  title: string
  temperature: number
  azureDeployment?: string
  azureApiVersion?: string
  requestTimeoutMs?: number
}

export class OpenAiCompatibleClient {
  constructor(private readonly options: ModelClientOptions) {}

  async chat(
    messages: ChatMessage[],
    tools: OpenAiTool[],
    sessionId: string,
  ): Promise<ChatCompletionResponse> {
    return this.request(messages, sessionId, {
      tools,
      tool_choice: 'auto',
      parallel_tool_calls: true,
    })
  }

  async complete(messages: ChatMessage[], sessionId: string): Promise<string> {
    const completion = await this.request(messages, sessionId)
    return completion.choices[0]?.message.content ?? ''
  }

  async json<T>(messages: ChatMessage[], sessionId: string): Promise<T> {
    const completion = await this.request(messages, sessionId, {
      response_format: { type: 'json_object' },
    })
    const raw = completion.choices[0]?.message.content ?? ''
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    return JSON.parse(cleaned) as T
  }

  private async request(
    messages: ChatMessage[],
    sessionId: string,
    extras: Record<string, unknown> = {},
  ): Promise<ChatCompletionResponse> {
    const body = JSON.stringify({
      ...(this.options.provider === 'azure-openai' ? {} : { model: this.options.model }),
      messages,
      temperature: this.options.temperature,
      ...(this.options.provider === 'azure-openai' ? {} : { session_id: sessionId }),
      ...extras,
    })
    const timeoutMs = this.options.requestTimeoutMs ?? 60_000
    for (let attempt = 0; attempt < 5; attempt++) {
      let response: Response
      try {
        response = await fetch(this.requestUrl(), {
          method: 'POST',
          headers: this.headers(),
          body,
          // Without this, a hung upstream connection blocks this call (and
          // the caller's session lock) indefinitely instead of failing and
          // letting the retry/fallback logic recover.
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (error) {
        // Network-level failures (DNS, connection reset, timeout) never hit
        // the response.ok branch below, so without this catch they were not
        // retried at all — only HTTP-level 429/5xx were.
        if (attempt === 4) {
          throw new Error(
            `Model API request failed after ${attempt + 1} attempt(s): ${errorMessage(error)}`,
          )
        }
        await delay(retryDelayMs(undefined, attempt))
        continue
      }
      if (response.ok) return (await response.json()) as ChatCompletionResponse

      const responseBody = await response.text()
      const retryable = response.status === 429 || response.status >= 500
      if (!retryable || attempt === 4) {
        throw new Error(
          `Model API failed after ${attempt + 1} attempt(s): ${response.status} ${response.statusText} ${responseBody}`,
        )
      }
      await delay(retryDelayMs(response.headers, attempt))
    }
    throw new Error('Model API request exhausted retries')
  }

  private headers(): HeadersInit {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this.options.provider === 'azure-openai') {
      headers['api-key'] = this.options.apiKey
    } else {
      headers.Authorization = `Bearer ${this.options.apiKey}`
    }
    if (this.options.referer) headers['HTTP-Referer'] = this.options.referer
    if (this.options.title) headers['X-OpenRouter-Title'] = this.options.title
    return headers
  }

  private requestUrl(): string {
    if (this.options.provider !== 'azure-openai') {
      return `${this.options.baseUrl}/chat/completions`
    }
    if (!this.options.azureDeployment) {
      throw new Error('AZURE_OPENAI_DEPLOYMENT is not configured')
    }
    const version = this.options.azureApiVersion || '2024-10-21'
    return `${this.options.baseUrl}/openai/deployments/${encodeURIComponent(this.options.azureDeployment)}/chat/completions?api-version=${encodeURIComponent(version)}`
  }
}

function retryDelayMs(headers: Headers | undefined, attempt: number): number {
  const retryAfterMs = Number(headers?.get('retry-after-ms'))
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) return Math.min(retryAfterMs, 30_000)
  const retryAfterSeconds = Number(headers?.get('retry-after'))
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, 30_000)
  }
  return Math.min(2000 * 2 ** attempt, 30_000)
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
