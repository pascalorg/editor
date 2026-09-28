import { MCP_CATALOG_ITEMS } from '../tools/asset-catalog'
import type { AssetCatalog } from './types'

export const bundledCatalog: AssetCatalog = {
  usesNetwork: false,
  async snapshot() {
    return {
      items: structuredClone(MCP_CATALOG_ITEMS),
      status: {
        mode: 'bundled',
        bundledCount: MCP_CATALOG_ITEMS.length,
        onlineCount: 0,
        accountLinked: false,
        accountRequired: false,
        message:
          'Using the bundled item catalog. Parametric node choices are available through get_node_catalog.',
      },
    }
  },
}
