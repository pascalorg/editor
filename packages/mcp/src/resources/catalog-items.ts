import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneOperations } from '../operations'
import { MCP_CATALOG_ITEMS } from '../tools/asset-catalog'

/**
 * `pascal://catalog/items` — shared placeable item catalog for standalone MCP.
 *
 * The catalog lives in core as pure AssetInput data so MCP can run headlessly
 * without depending on editor UI/React packages.
 */
export function registerCatalogItems(server: McpServer, _bridge: SceneOperations): void {
  server.registerResource(
    'catalog-items',
    'pascal://catalog/items',
    {
      title: 'Item catalog',
      description:
        'Dependency-free shared catalog of placeable items available in standalone MCP mode.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const payload = {
        status: 'ok' as const,
        items: MCP_CATALOG_ITEMS,
        note: 'Shared core catalog; editor and MCP resolve the same built-in placeable item IDs.',
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
