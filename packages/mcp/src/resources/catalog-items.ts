import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneBridge } from '../bridge/scene-bridge'

/**
 * `pascal://catalog/items` — item catalog (if the host supplies one).
 *
 * `@pascal-app/core` does NOT expose a runtime item catalog — that is the host
 * app's responsibility. In headless / standalone MCP mode we therefore return
 * a stable, machine-readable "unavailable" payload so agents can detect this
 * and fall back to free-form item creation.
 */
export function registerCatalogItems(server: McpServer, _bridge: SceneBridge): void {
  server.registerResource(
    'catalog-items',
    'pascal://catalog/items',
    {
      title: 'Item catalog',
      description:
        'Catalog of placeable items. Not available in core; the host app is expected to override this resource when it has a catalog.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const payload = {
        status: 'catalog_unavailable' as const,
        items: [] as never[],
        note: '@pascal-app/core does not ship a runtime item catalog; the host app is expected to provide one by overriding this resource.',
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
