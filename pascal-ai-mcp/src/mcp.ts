import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { AppConfig } from './config'
import type { OpenAiTool } from './types'

export class PascalMcpClient {
  private client?: Client

  constructor(private readonly config: AppConfig) {}

  async connect(): Promise<void> {
    if (this.client) return

    const client = new Client({ name: 'pascal-ai-mcp', version: '0.1.0' })
    const transport =
      this.config.mcpMode === 'http'
        ? new StreamableHTTPClientTransport(new URL(this.config.mcpUrl), {
            requestInit: this.config.mcpToken
              ? {
                  headers: {
                    Authorization: `Bearer ${this.config.mcpToken}`,
                    'x-pascal-mcp-token': this.config.mcpToken,
                  },
                }
              : undefined,
          })
        : new StdioClientTransport({
            command: this.config.mcpCommand,
            args: this.config.mcpArgs,
            cwd: process.cwd(),
            env: this.config.pascalDataDir
              ? { ...cleanEnv(process.env), PASCAL_DATA_DIR: this.config.pascalDataDir }
              : cleanEnv(process.env),
            stderr: 'inherit',
          })

    await client.connect(transport)
    this.client = client
  }

  async close(): Promise<void> {
    await this.client?.close()
    this.client = undefined
  }

  async listOpenAiTools(): Promise<OpenAiTool[]> {
    const client = this.requireClient()
    const result = await client.listTools()
    return result.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: (tool.inputSchema ?? { type: 'object', properties: {} }) as Record<
          string,
          unknown
        >,
      },
    }))
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const client = this.requireClient()
    const result = await client.callTool({ name, arguments: args })
    if (result.isError) {
      throw new Error(`MCP tool ${name} failed: ${mcpErrorMessage(result)}`)
    }
    return result
  }

  /**
   * Read an MCP resource (e.g. `pascal://agent-guide`) and return its text
   * content. Returns undefined rather than throwing when the resource is
   * missing or has no text content, so callers can treat this as an
   * optional enrichment rather than a hard dependency.
   */
  async readResourceText(uri: string): Promise<string | undefined> {
    const client = this.requireClient()
    const result = await client.readResource({ uri })
    const textContent = result.contents.find(
      (content): content is typeof content & { text: string } =>
        'text' in content && typeof content.text === 'string',
    )
    return textContent?.text
  }

  /**
   * Fetch an MCP prompt (e.g. `from_brief`) and return its assembled
   * messages. Not currently used for scene generation (we keep our own
   * structured workflow), but available for prompts like
   * `renovation_from_photos` if we wire that up later.
   */
  async getPrompt(
    name: string,
    args: Record<string, string>,
  ): Promise<Array<{ role: string; content: unknown }>> {
    const client = this.requireClient()
    const result = await client.getPrompt({ name, arguments: args })
    return result.messages
  }

  private requireClient(): Client {
    if (!this.client) throw new Error('Pascal MCP client is not connected')
    return this.client
  }
}

export function mcpErrorMessage(result: unknown): string {
  if (!result || typeof result !== 'object') return 'unknown error'
  const content = (result as { content?: unknown }).content
  if (!Array.isArray(content)) return 'unknown error'
  const messages = content.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const text = (item as { text?: unknown }).text
    return typeof text === 'string' && text.trim() ? [text.trim()] : []
  })
  return messages.join('; ') || 'unknown error'
}

function cleanEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}
