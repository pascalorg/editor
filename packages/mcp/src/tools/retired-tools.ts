import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { RETIRED_MCP_TOOLS, retiredToolRefusal } from '@pascal-app/core/agent-tools'
import { toolError } from './errors'

type RequestHandler = (request: unknown, extra: unknown) => Promise<unknown>

/**
 * A retired tool (`RETIRED_MCP_TOOLS`) is listed nowhere and still answered: a call to its name gets
 * `tool_retired` with the tool that replaced it and how to use that one, where the SDK would answer
 * an unknown name with a bare error.
 */
export function answerRetiredTools(server: McpServer): void {
  const registry = server.server as unknown as { _requestHandlers: Map<string, RequestHandler> }
  const original = registry._requestHandlers.get('tools/call')
  if (!original) return

  server.server.removeRequestHandler('tools/call')
  server.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name } = request.params
    if (!Object.hasOwn(RETIRED_MCP_TOOLS, name)) return (await original(request, extra)) as never
    const { error, ...answer } = retiredToolRefusal(name, RETIRED_MCP_TOOLS[name]!)
    return toolError(error, answer)
  })
}
