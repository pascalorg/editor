import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneOperations } from '../../operations'
import { registerCreateFromTemplate } from './create-from-template'
import { registerListTemplates } from './list-templates'

/**
 * Register the template MCP tools (`list_templates`, `create_from_template`)
 * against the given server.
 *
 * When persistence operations are unavailable, `create_from_template` still
 * applies the template to the bridge but skips the save step.
 */
export function registerTemplateTools(server: McpServer, bridge: SceneOperations): void {
  registerListTemplates(server)
  registerCreateFromTemplate(server, bridge)
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
