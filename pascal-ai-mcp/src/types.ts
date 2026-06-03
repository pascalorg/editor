export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export type ChatMessage = {
  role: ChatRole
  content?: string | null
  name?: string
  tool_call_id?: string
  tool_calls?: ToolCall[]
}

export type ToolCall = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export type ChatCompletionMessage = {
  role: 'assistant'
  content?: string | null
  tool_calls?: ToolCall[]
}

export type ChatCompletionResponse = {
  choices: Array<{
    message: ChatCompletionMessage
    finish_reason?: string
  }>
}

export type OpenAiTool = {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: Record<string, unknown>
  }
}
