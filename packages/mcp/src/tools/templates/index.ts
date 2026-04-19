import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneBridge } from '../../bridge/scene-bridge'
import type { SceneStore } from '../../storage/types'
import { registerCreateFromTemplate } from './create-from-template'
import { registerListTemplates } from './list-templates'

/**
 * Register the template MCP tools (`list_templates`, `create_from_template`)
 * against the given server.
 *
 * `store` is optional: when omitted, `create_from_template` still applies the
 * template to the bridge but skips the save step. This makes the tool safe
 * to wire into headless bridge-only deployments.
 */
export function registerTemplateTools(
  server: McpServer,
  bridge: SceneBridge,
  store?: SceneStore,
): void {
  registerListTemplates(server)
  registerCreateFromTemplate(server, bridge, store)
}

export {
  createFromTemplateInput,
  createFromTemplateOutput,
  registerCreateFromTemplate,
} from './create-from-template'
export {
  listTemplatesInput,
  listTemplatesOutput,
  registerListTemplates,
} from './list-templates'
