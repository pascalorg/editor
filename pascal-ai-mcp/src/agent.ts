import { OpenAiCompatibleClient } from './openai-compatible'
import { PascalMcpClient } from './mcp'
import { SessionStore } from './session-store'
import type { AppConfig } from './config'
import type { ChatMessage, ToolCall } from './types'

const BASE_SYSTEM_PROMPT = [
  'You are a Pascal architectural design assistant.',
  'You must only help with Pascal editor workflows, architectural scenes, floor plans, rooms, walls, openings, levels, furniture placement, measurements, validation, saving, loading, exporting, and closely related design questions.',
  'If the user asks for unrelated general chat, news, personal advice, coding help outside this Pascal MCP client, entertainment, or any topic not related to Pascal architectural editing, politely refuse in one short sentence and redirect them to a Pascal scene or floor-plan task.',
  'For unrelated requests, do not call any MCP tool.',
  'Use the available MCP tools to inspect and modify the Pascal scene.',
  'When changing geometry, validate the scene before giving the final answer.',
  'Reply concisely in the user language.',
].join(' ')

export class PascalAiAgent {
  private readonly model: OpenAiCompatibleClient
  private readonly sessions: SessionStore

  constructor(
    private readonly config: AppConfig,
    private readonly mcp: PascalMcpClient,
  ) {
    this.model = new OpenAiCompatibleClient({
      apiKey: config.aiApiKey,
      baseUrl: config.aiBaseUrl,
      model: config.aiModel,
      referer: config.aiReferer,
      title: config.aiTitle,
      temperature: config.aiTemperature,
    })
    this.sessions = new SessionStore(config.sessionFile)
  }

  async chat(input: {
    sessionId: string
    message: string
    system?: string
  }): Promise<{ sessionId: string; reply: string; messages: ChatMessage[] }> {
    const tools = await this.mcp.listOpenAiTools()
    const messages = this.withSystemPrompt(this.sessions.get(input.sessionId), input.system)
    messages.push({ role: 'user', content: input.message })

    for (let round = 0; round < this.config.maxToolRounds; round++) {
      const completion = await this.model.chat(messages, tools, input.sessionId)
      const assistant = completion.choices[0]?.message
      if (!assistant) throw new Error('Model API returned no assistant message')

      messages.push({
        role: 'assistant',
        content: assistant.content ?? null,
        tool_calls: assistant.tool_calls,
      })

      if (!assistant.tool_calls?.length) {
        const reply = assistant.content ?? ''
        this.sessions.set(input.sessionId, messages)
        return { sessionId: input.sessionId, reply, messages }
      }

      for (const toolCall of assistant.tool_calls) {
        messages.push(await this.executeToolCall(toolCall))
      }
    }

    const reply = 'The tool-call round limit was reached, so I stopped the current operation.'
    messages.push({ role: 'assistant', content: reply })
    this.sessions.set(input.sessionId, messages)
    return { sessionId: input.sessionId, reply, messages }
  }

  getSession(sessionId: string): ChatMessage[] {
    return this.sessions.get(sessionId)
  }

  deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId)
  }

  private withSystemPrompt(messages: ChatMessage[], extra?: string): ChatMessage[] {
    if (messages.some((message) => message.role === 'system')) return messages
    const content = extra ? `${BASE_SYSTEM_PROMPT}\n\n${extra}` : BASE_SYSTEM_PROMPT
    return [{ role: 'system', content }, ...messages]
  }

  private async executeToolCall(toolCall: ToolCall): Promise<ChatMessage> {
    try {
      const args = parseToolArgs(toolCall.function.arguments)
      const result = await this.mcp.callTool(toolCall.function.name, args)
      return {
        role: 'tool',
        tool_call_id: toolCall.id,
        name: toolCall.function.name,
        content: JSON.stringify(result),
      }
    } catch (error) {
      return {
        role: 'tool',
        tool_call_id: toolCall.id,
        name: toolCall.function.name,
        content: JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      }
    }
  }
}

function parseToolArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {}
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  return parsed as Record<string, unknown>
}
