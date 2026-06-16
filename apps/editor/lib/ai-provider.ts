type ApiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image'
      source: {
        type: 'base64'
        media_type: string
        data: string
      }
    }

export type OpenAiStyleMessage = {
  role: string
  content?: string | ApiContentPart[]
  tool_call_id?: string
  tool_calls?: unknown
}

export type OpenAiStyleTool = {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: Record<string, unknown>
  }
}

export type OpenAiStyleResponseMessage = {
  role: string
  content?: string
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>
}

function normalizeApiKey(value: string | undefined) {
  return value?.trim().replace(/^bearer\s+/i, '') || undefined
}

function openAiBaseUrl() {
  return (process.env.AI_BASE_URL || process.env.NEXT_PUBLIC_AI_BASE_URL || '').replace(/\/+$/, '')
}

function openAiApiKey() {
  return normalizeApiKey(process.env.AI_API_KEY || process.env.NEXT_PUBLIC_AI_API_KEY)
}

function openAiModel() {
  return process.env.AI_MODEL || process.env.NEXT_PUBLIC_AI_MODEL
}

function anthropicBaseUrl() {
  return (process.env.ANTHROPIC_BASE_URL || '').replace(/\/+$/, '')
}

function anthropicMessagesUrl() {
  const explicitUrl = process.env.ANTHROPIC_MESSAGES_URL?.trim()
  if (explicitUrl) return explicitUrl
  return `${anthropicBaseUrl()}/v1/messages`
}

function anthropicToken() {
  return normalizeApiKey(process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY)
}

function anthropicAuthHeaderName() {
  return (process.env.ANTHROPIC_AUTH_HEADER || 'x-api-key').trim()
}

function anthropicAuthHeaders(token: string): Record<string, string> {
  const headerName = anthropicAuthHeaderName()
  if (headerName.toLowerCase() === 'authorization') {
    return { Authorization: `Bearer ${token}` }
  }
  return { [headerName]: token }
}

function anthropicModel() {
  return (
    process.env.ANTHROPIC_MODEL ||
    process.env.CLAUDE_MODEL ||
    process.env.AI_MODEL ||
    process.env.NEXT_PUBLIC_AI_MODEL ||
    'claude-3-5-sonnet-latest'
  )
}

function aiThinking() {
  const value = (process.env.AI_THINKING || 'disabled').trim().toLowerCase()
  if (value === 'enabled' || value === 'true' || value === '1') return { type: 'enabled' }
  return { type: 'disabled' }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeToolArgumentsSource(raw: string) {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced?.[1]?.trim() ?? trimmed
}

function parseToolArgs(raw: string) {
  try {
    const parsed = JSON.parse(normalizeToolArgumentsSource(raw || '{}') || '{}')
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function dataUrlToAnthropicImage(url: string) {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/i.exec(url)
  if (!match) return null
  const mediaType = match[1]
  const data = match[2]
  if (!mediaType || !data) return null
  return {
    type: 'image' as const,
    source: {
      type: 'base64' as const,
      media_type: mediaType,
      data,
    },
  }
}

function toAnthropicContent(content: OpenAiStyleMessage['content']) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const blocks: AnthropicContentBlock[] = []
  for (const part of content) {
    if (part.type === 'text') {
      blocks.push({ type: 'text', text: part.text })
      continue
    }
    if (part.type === 'image_url') {
      const image = dataUrlToAnthropicImage(part.image_url.url)
      blocks.push(image ?? { type: 'text', text: `[image: ${part.image_url.url}]` })
    }
  }
  return blocks
}

function openAiToolsToAnthropic(tools: unknown) {
  if (!Array.isArray(tools)) return undefined
  return tools.flatMap((tool) => {
    if (!isRecord(tool) || tool.type !== 'function' || !isRecord(tool.function)) return []
    const fn = tool.function
    if (typeof fn.name !== 'string') return []
    return [
      {
        name: fn.name,
        description: typeof fn.description === 'string' ? fn.description : undefined,
        input_schema: isRecord(fn.parameters)
          ? fn.parameters
          : { type: 'object', additionalProperties: true },
      },
    ]
  })
}

function openAiMessagesToAnthropic(messages: OpenAiStyleMessage[]) {
  const system: string[] = []
  const anthropicMessages: Array<{ role: 'user' | 'assistant'; content: unknown }> = []

  for (const message of messages) {
    if (message.role === 'system') {
      if (typeof message.content === 'string') system.push(message.content)
      continue
    }
    if (message.role === 'tool') {
      anthropicMessages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: message.tool_call_id || 'tool_call',
            content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
          },
        ],
      })
      continue
    }
    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      const content: unknown[] = []
      if (typeof message.content === 'string' && message.content) {
        content.push({ type: 'text', text: message.content })
      }
      for (const toolCall of message.tool_calls) {
        if (!isRecord(toolCall) || !isRecord(toolCall.function)) continue
        const name = toolCall.function.name
        const args = toolCall.function.arguments
        if (typeof name !== 'string') continue
        content.push({
          type: 'tool_use',
          id: typeof toolCall.id === 'string' ? toolCall.id : `tool_${content.length}`,
          name,
          input: typeof args === 'string' ? parseToolArgs(args) : {},
        })
      }
      anthropicMessages.push({ role: 'assistant', content })
      continue
    }
    anthropicMessages.push({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: toAnthropicContent(message.content),
    })
  }

  return { system: system.join('\n\n'), messages: anthropicMessages }
}

function anthropicResponseToOpenAiMessage(data: Record<string, unknown>): OpenAiStyleResponseMessage {
  const content = Array.isArray(data.content) ? data.content : []
  const textParts: string[] = []
  const toolCalls: NonNullable<OpenAiStyleResponseMessage['tool_calls']> = []

  for (const part of content) {
    if (!isRecord(part)) continue
    if (part.type === 'text' && typeof part.text === 'string') {
      textParts.push(part.text)
    } else if (part.type === 'tool_use' && typeof part.name === 'string') {
      toolCalls.push({
        id: typeof part.id === 'string' ? part.id : `tool_${toolCalls.length}`,
        function: {
          name: part.name,
          arguments: JSON.stringify(isRecord(part.input) ? part.input : {}),
        },
      })
    }
  }

  return {
    role: 'assistant',
    content: textParts.join('\n\n'),
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  }
}

export function configuredAiProvider() {
  if (openAiBaseUrl() && openAiApiKey()) return 'openai-compatible'
  if (anthropicBaseUrl() && anthropicToken()) return 'anthropic'
  return null
}

export async function callConfiguredAi(body: Record<string, unknown>, signal?: AbortSignal) {
  const openAiUrl = openAiBaseUrl()
  const openAiKey = openAiApiKey()
  if (openAiUrl && openAiKey) {
    const upstreamBody = {
      ...body,
      ...(openAiModel() ? { model: openAiModel() } : {}),
      ...(body.thinking ? {} : { thinking: aiThinking() }),
    }
  const res = await fetch(`${openAiUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'claude-code/1.0',
    },
      body: JSON.stringify(upstreamBody),
      signal,
    })
    const text = await res.text()
    return { res, text }
  }

  const anthropicUrl = anthropicBaseUrl()
  const token = anthropicToken()
  if (!anthropicUrl || !token) {
    throw new Error('AI_BASE_URL/AI_API_KEY or ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN are not configured on the server')
  }

  const { system, messages } = openAiMessagesToAnthropic(
    Array.isArray(body.messages) ? (body.messages as OpenAiStyleMessage[]) : [],
  )
  const anthropicTools = openAiToolsToAnthropic(body.tools)
  const anthropicBody = {
    model: anthropicModel(),
    max_tokens: typeof body.max_tokens === 'number' ? body.max_tokens : 4096,
    ...(system ? { system } : {}),
    messages,
    ...(anthropicTools?.length ? { tools: anthropicTools } : {}),
  }
  const res = await fetch(anthropicMessagesUrl(), {
    method: 'POST',
    headers: {
      ...anthropicAuthHeaders(token),
      Accept: 'application/json',
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
      'User-Agent': 'claude-code/1.0',
    },
    body: JSON.stringify(anthropicBody),
    signal,
  })
  const text = await res.text()
  if (!res.ok) return { res, text }

  const data = JSON.parse(text) as Record<string, unknown>
  const message = anthropicResponseToOpenAiMessage(data)
  return {
    res: new Response(
      JSON.stringify({
        choices: [{ message }],
        model: typeof data.model === 'string' ? data.model : anthropicModel(),
      }),
      {
        status: res.status,
        statusText: res.statusText,
        headers: { 'Content-Type': 'application/json' },
      },
    ),
    text: JSON.stringify({
      choices: [{ message }],
      model: typeof data.model === 'string' ? data.model : anthropicModel(),
    }),
  }
}
