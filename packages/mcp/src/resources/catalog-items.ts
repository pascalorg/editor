import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneOperations } from '../operations'
import { MCP_CATALOG_ITEMS } from '../tools/asset-catalog'

/**
 * `pascal://catalog/items` — small built-in item catalog for standalone MCP.
 *
 * The editor UI owns the full catalog. MCP intentionally keeps a dependency-free
 * subset so headless agents can still place realistic furniture and fixtures.
 */
export function registerCatalogItems(server: McpServer, _bridge: SceneOperations): void {
  server.registerResource(
    'catalog-items',
    'pascal://catalog/items',
    {
      title: 'Item catalog',
      description:
        'Dependency-free catalog subset of placeable items available in standalone MCP mode.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const payload = {
        status: 'ok' as const,
        items: MCP_CATALOG_ITEMS,
        note: 'Standalone MCP catalog subset; host applications can still expose a larger catalog separately.',
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(payload),
          },
        ],
      }
    },
  )
}
