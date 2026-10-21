import type { McpServer } from '@modelcontextprotocol/server'
import {
  RETIRED_MCP_TOOLS,
  type RetiredTool,
  retiredToolRefusal,
} from '@pascal-app/core/agent-tools'
import { toolError } from './errors'

type RequestHandler = (request: unknown, extra: unknown) => Promise<unknown>

/**
 * A retired tool (`RETIRED_MCP_TOOLS`, or a host's own map) is listed nowhere and still answered: a
 * call to its name gets `tool_retired` with the tool that replaced it and how to use that one,
 * where the SDK would answer an unknown name with a bare error. Install it once the tools are
 * registered.
 */
export function answerRetiredTools(
  server: McpServer,
  retired: Readonly<Record<string, RetiredTool>> = RETIRED_MCP_TOOLS,
): void {
  const registry = server.server as unknown as { _requestHandlers: Map<string, RequestHandler> }
  const original = registry._requestHandlers.get('tools/call')
  if (!original) return

  server.server.removeRequestHandler('tools/call')
  server.server.setRequestHandler('tools/call', async (request, ctx) => {
    const { name } = request.params
    if (!Object.hasOwn(retired, name)) return (await original(request, ctx)) as never
    const { error, ...answer } = retiredToolRefusal(name, retired[name]!)
    return toolError(error, answer)
  })
}
