import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneOperations } from '../operations'
import { type AssetCatalog, builtInCatalog } from '../tools/asset-catalog'

/**
 * `pascal://catalog/items` — the items place_items draws from: the host's library when it passes
 * one, else a dependency-free built-in subset, so headless agents can still place furniture.
 */
export function registerCatalogItems(
  server: McpServer,
  _bridge: SceneOperations,
  catalog: AssetCatalog = builtInCatalog,
): void {
  server.registerResource(
    'catalog-items',
    'pascal://catalog/items',
    {
      title: 'Item catalog',
      description: "Placeable items: the host's library when it has one, else a built-in subset.",
      mimeType: 'application/json',
    },
    async (uri) => {
      const payload = {
        status: 'ok' as const,
        items: await catalog(),
        note: 'A fixture this catalog lacks (a wall light, a house number) is built as a design: place_design.',
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
