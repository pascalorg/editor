import type { ChatCompletionResponse, ChatMessage, OpenAiTool } from './types'

// Optional per-call hooks: `signal` lets a caller abort an in-flight request
// (e.g. on user cancel); `onAttempt` is invoked once per real HTTP attempt so
// the caller can meter actual API usage including internal retries;
// `temperature` overrides the client default for this one call (plan-first
// temperature split, 批次 D).
export type RequestHooks = {
  signal?: AbortSignal
  onAttempt?: () => void
  temperature?: number
}

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
    hooks: RequestHooks = {},
  ): Promise<ChatCompletionResponse> {
    return this.request(messages, sessionId, {
      tools,
      tool_choice: 'auto',
      parallel_tool_calls: true,
    }, hooks)
  }

  async complete(messages: ChatMessage[], sessionId: string, hooks: RequestHooks = {}): Promise<string> {
    const completion = await this.request(messages, sessionId, {}, hooks)
    return completion.choices[0]?.message.content ?? ''
  }

  async json<T>(messages: ChatMessage[], sessionId: string, hooks: RequestHooks = {}): Promise<T> {
    const completion = await this.request(messages, sessionId, {
      response_format: { type: 'json_object' },
    }, hooks)
    const raw = completion.choices[0]?.message.content ?? ''
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    return JSON.parse(cleaned) as T
  }

  private async request(
    messages: ChatMessage[],
    sessionId: string,
    extras: Record<string, unknown> = {},
    hooks: RequestHooks = {},
  ): Promise<ChatCompletionResponse> {
    const body = JSON.stringify({
      ...(this.options.provider === 'azure-openai' ? {} : { model: this.options.model }),
      messages,
      temperature: hooks.temperature ?? this.options.temperature,
      ...(this.options.provider === 'azure-openai' ? {} : { session_id: sessionId }),
      ...extras,
    })
    const timeoutMs = this.options.requestTimeoutMs ?? 60_000
    for (let attempt = 0; attempt < 5; attempt++) {
      // Count every real HTTP attempt (including internal retries and, since
      // the fallback model reuses this method, fallback calls) so the cost
      // budget reflects actual API usage rather than logical call count.
      hooks.onAttempt?.()
      let response: Response
      try {
        response = await fetch(this.requestUrl(), {
          method: 'POST',
          headers: this.headers(),
          body,
          // Combine the per-attempt timeout with the caller's cancel signal
          // (if any) so a user cancel aborts the in-flight request instead of
          // waiting for it (or its retries) to finish.
          signal: anySignal(AbortSignal.timeout(timeoutMs), hooks.signal),
        })
      } catch (error) {
        // A cancel is not a transient failure — do not burn retries on it,
        // surface it immediately so the caller can unwind.
        if (hooks.signal?.aborted) {
          throw new Error('Model API request cancelled')
        }
        // Network-level failures (DNS, connection reset, timeout) never hit
        // the response.ok branch below, so without this catch they were not
        // retried at all — only HTTP-level 429/5xx were.
        if (attempt === 4) {
          throw new Error(
            `Model API request failed after ${attempt + 1} attempt(s): ${errorMessage(error)}`,
          )
        }
        await delay(retryDelayMs(undefined, attempt), hooks.signal)
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
      await delay(retryDelayMs(response.headers, attempt), hooks.signal)
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

// Combine a timeout signal with an optional external (cancel) signal into one
// signal that aborts when either does. Implemented manually rather than via
// AbortSignal.any for portability across runtimes/type libs.
function anySignal(primary: AbortSignal, external?: AbortSignal): AbortSignal {
  if (!external) return primary
  if (primary.aborted) return primary
  if (external.aborted) return external
  const controller = new AbortController()
  const abortFrom = (source: AbortSignal) => () => controller.abort(source.reason)
  primary.addEventListener('abort', abortFrom(primary), { once: true })
  external.addEventListener('abort', abortFrom(external), { once: true })
  return controller.signal
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

// Abortable sleep: resolves after `milliseconds`, or rejects immediately if
// `signal` is (or becomes) aborted, so a user cancel doesn't have to wait out
// the full retry backoff (up to ~30s) before it takes effect.
function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Model API request cancelled'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    function onAbort() {
      clearTimeout(timer)
      reject(new Error('Model API request cancelled'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
