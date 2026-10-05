import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  executeHostedServiceTool,
  type HostedServiceExecutor,
} from '@pascal-app/core/agent-operations'
import {
  HOSTED_SERVICE_TOOL_CONTRACTS,
  isAgentRefusal,
  refusalPayload,
} from '@pascal-app/core/agent-tools'
import { z } from 'zod'

export function registerHostedServiceTools(
  server: McpServer,
  execute: HostedServiceExecutor,
): void {
  for (const contract of HOSTED_SERVICE_TOOL_CONTRACTS) {
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
          const result = await executeHostedServiceTool(contract.name, input, execute, extra.signal)
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
        } catch (error) {
          const result = isAgentRefusal(error)
            ? refusalPayload(error)
            : {
                error:
                  'Pascal could not complete this service request. Check its retained result before repeating paid work.',
                code: 'service_error',
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
