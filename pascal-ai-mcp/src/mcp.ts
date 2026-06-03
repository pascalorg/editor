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
            cwd: '..',
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
    return await client.callTool({ name, arguments: args })
  }

  private requireClient(): Client {
    if (!this.client) throw new Error('Pascal MCP client is not connected')
    return this.client
  }
}

function cleanEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}
