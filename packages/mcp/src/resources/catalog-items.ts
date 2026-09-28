import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { bundledCatalog } from '../catalog/bundled'
import type { AssetCatalog } from '../catalog/types'
import type { SceneOperations } from '../operations'

export function registerCatalogItems(
  server: McpServer,
  _bridge: SceneOperations,
  assetCatalog: AssetCatalog = bundledCatalog,
): void {
  server.registerResource(
    'catalog-items',
    'pascal://catalog/items',
    {
      title: 'Item catalog',
      description:
        'Available item catalog and connection status. Bundled items work locally; a host can optionally connect an online catalog.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const snapshot = await assetCatalog.snapshot()
      const payload = {
        status: 'ok' as const,
        items: snapshot.items,
        catalog: snapshot.status,
        note: 'Read connection status before offering online access. Catalog access does not link an account or upload the scene. Use get_node_catalog for native parametric choices.',
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
