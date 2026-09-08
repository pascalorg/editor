import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const DIALECT_2020_12 = 'https://json-schema.org/draft/2020-12/schema'

type RequestHandler = (request: unknown, extra: unknown) => Promise<unknown>

type HandlerRegistry = {
  _requestHandlers: Map<string, RequestHandler>
}

function retargetDialect(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) retargetDialect(item)
    return
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.$schema === 'string') record.$schema = DIALECT_2020_12
    for (const key of Object.keys(record)) retargetDialect(record[key])
  }
}

export function normalizeToolSchemaDialect(server: McpServer): void {
  const registry = server.server as unknown as HandlerRegistry
  const original = registry._requestHandlers.get('tools/list')
  if (!original) return

  server.server.removeRequestHandler('tools/list')
  server.server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
    const result = (await original(request, extra)) as { tools?: unknown }
    retargetDialect(result.tools)
    return result
  })
}
