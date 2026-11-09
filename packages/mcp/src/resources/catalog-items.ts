import type { McpServer } from '@modelcontextprotocol/server'
import { isAssetCatalogSource } from '@pascal-app/core/agent-operations'
import type { SceneOperations } from '../operations'
import { type AssetCatalog, builtInCatalog } from '../tools/asset-catalog'

/** The items the resource lists of a library searched where it is kept; search_assets finds the rest. */
export const CATALOG_RESOURCE_LIMIT = 100

const NOTE =
  'A fixture this catalog lacks (a wall light, a house number) is built as a design: place_design.'

/**
 * `pascal://catalog/items` — the items place_items draws from: the host's library when it passes
 * one, else a dependency-free built-in subset, so headless agents can still place furniture. A
 * library kept elsewhere is listed by its first items and its size, never whole.
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
      const payload = isAssetCatalogSource(catalog)
        ? await catalog.search({ limit: CATALOG_RESOURCE_LIMIT }).then(({ items, total }) => ({
            status: 'ok' as const,
            items,
            total,
            note: `${items.length < total ? `The library holds ${total} items; these are the first ${items.length}, and search_assets finds any of them. ` : ''}${NOTE}`,
          }))
        : { status: 'ok' as const, items: catalog, note: NOTE }
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
