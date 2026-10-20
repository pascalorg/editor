import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  executeProjectFileTool,
  type ProjectFileToolExecutor,
} from '@pascal-app/core/agent-operations'
import {
  isAgentRefusal,
  PROJECT_FILE_TOOL_CONTRACTS,
  refusalPayload,
} from '@pascal-app/core/agent-tools'
import { z } from 'zod'

export function registerProjectFileTools(server: McpServer, execute: ProjectFileToolExecutor) {
  for (const contract of PROJECT_FILE_TOOL_CONTRACTS) {
    server.registerTool(
      contract.name,
      {
        title: contract.title,
        description: contract.description,
        inputSchema: z.object(contract.input).strict(),
        annotations: contract.annotations,
      },
      async (input: Record<string, unknown>, extra: { signal: AbortSignal }) => {
        try {
          const result = await executeProjectFileTool(contract.name, input, execute, extra.signal)
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
        } catch (error) {
          const result = isAgentRefusal(error)
            ? refusalPayload(error)
            : {
                code: 'file_error',
                error:
                  'Could not complete the file request. List project files before retrying an upload.',
              }
          return {
            isError: true,
            content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          }
        }
      },
    )
  }
}
