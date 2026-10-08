import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const DIALECT_2020_12 = 'https://json-schema.org/draft/2020-12/schema'

type RequestHandler = (request: unknown, extra: unknown) => Promise<unknown>

type HandlerRegistry = {
  _requestHandlers: Map<string, RequestHandler>
}

/**
 * A tuple of one item schema, `items: [A, A]` (draft-07), as 2020-12 writes an array of that length:
 * `items: A` with minItems and maxItems. Clients reading 2020-12 refuse the list form, and Claude
 * Code left out 9 tools over it (2026-10-03). The tools still validate with their own tuples.
 */
function untuple(record: Record<string, unknown>, key: 'items' | 'prefixItems'): void {
  const list = record[key]
  if (!(Array.isArray(list) && list.length > 0)) return
  const first = JSON.stringify(list[0])
  if (!list.every((entry) => JSON.stringify(entry) === first)) return
  delete record.prefixItems
  delete record.additionalItems
  record.items = list[0]
  record.minItems ??= list.length
  record.maxItems ??= list.length
}

function retargetDialect(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) retargetDialect(item)
    return
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.$schema === 'string') record.$schema = DIALECT_2020_12
    untuple(record, 'items')
    untuple(record, 'prefixItems')
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
