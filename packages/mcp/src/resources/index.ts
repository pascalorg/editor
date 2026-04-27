import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneBridge } from '../bridge/scene-bridge'
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
 * - `pascal://agent/guide`            — text/markdown, MCP-first construction guide
 */
export function registerResources(server: McpServer, bridge: SceneBridge): void {
  registerAgentGuide(server, bridge)
  registerSceneCurrent(server, bridge)
  registerSceneSummary(server, bridge)
  registerCatalogItems(server, bridge)
  registerConstraints(server, bridge)
}
