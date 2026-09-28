import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { bundledCatalog } from '../catalog/bundled'
import type { AssetCatalog } from '../catalog/types'
import type { SceneOperations } from '../operations'
import { registerAgentGuide } from './agent-guide'
import { registerCatalogItems } from './catalog-items'
import { registerConstraints } from './constraints'
import { registerSceneCurrent } from './scene-current'
import { registerSceneSummary } from './scene-summary'

/**
 * Registers all MCP resources exposed by `@pascal-app/mcp`.
 *
 * Resources:
 * - `pascal://scene/current`          — application/json, full snapshot
 * - `pascal://scene/current/summary`  — text/markdown, human summary
 * - `pascal://catalog/items`          — application/json, host-supplied catalog
 * - `pascal://constraints/{levelId}`  — application/json, per-level constraints
 * - `pascal://agent-guide`            — text/markdown, MCP-first agent guide
 * - `pascal://agent/guide`            — text/markdown, legacy alias
 */
export function registerResources(
  server: McpServer,
  operations: SceneOperations,
  assetCatalog: AssetCatalog = bundledCatalog,
): void {
  registerAgentGuide(server, operations)
  registerSceneCurrent(server, operations)
  registerSceneSummary(server, operations)
  registerCatalogItems(server, operations, assetCatalog)
  registerConstraints(server, operations)
}
