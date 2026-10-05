import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneOperations } from '../operations'
import type { AssetCatalog } from '../tools/asset-catalog'
import { registerAgentGuide } from './agent-guide'
import { registerCatalogItems } from './catalog-items'
import { registerConstraints } from './constraints'
import { registerDesignSchema } from './design-schema'
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
 * - `pascal://schema/design`          — application/json, design contract for validate_design
 * - `pascal://agent-guide`            — text/markdown, MCP-first agent guide
 * - `pascal://agent/guide`            — text/markdown, legacy alias
 */
export function registerResources(
  server: McpServer,
  operations: SceneOperations,
  catalog?: AssetCatalog,
): void {
  registerAgentGuide(server, operations)
  registerSceneCurrent(server, operations)
  registerSceneSummary(server, operations)
  registerCatalogItems(server, operations, catalog)
  registerConstraints(server, operations)
  registerDesignSchema(server, operations)
}
