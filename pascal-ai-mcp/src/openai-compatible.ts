import type { ChatCompletionResponse, ChatMessage, OpenAiTool } from './types'

export type ModelClientOptions = {
  apiKey: string
  baseUrl: string
  model: string
  referer?: string
  title: string
  temperature: number
}

export class OpenAiCompatibleClient {
  constructor(private readonly options: ModelClientOptions) {}

  async chat(
    messages: ChatMessage[],
    tools: OpenAiTool[],
    sessionId: string,
  ): Promise<ChatCompletionResponse> {
    const response = await fetch(`${this.options.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: this.options.model,
        messages,
        tools,
        tool_choice: 'auto',
        parallel_tool_calls: true,
        temperature: this.options.temperature,
        session_id: sessionId,
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Model API failed: ${response.status} ${response.statusText} ${body}`)
    }

    return (await response.json()) as ChatCompletionResponse
  }

  private headers(): HeadersInit {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.options.apiKey}`,
      'Content-Type': 'application/json',
    }
    if (this.options.referer) headers['HTTP-Referer'] = this.options.referer
    if (this.options.title) headers['X-OpenRouter-Title'] = this.options.title
    return headers
  }
}
