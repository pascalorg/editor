import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { TEMPLATES } from '../../templates'

export const listTemplatesInput = {} as const

export const listTemplatesOutput = {
  templates: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      nodeCount: z.number(),
    }),
  ),
}

/**
 * `list_templates` — enumerate the seed templates shipped with the MCP server.
 * Stateless; used by the `from_brief` prompt and by the UI to populate a
 * "start from a template" picker.
 */
export function registerListTemplates(server: McpServer): void {
  server.registerTool(
    'list_templates',
    {
      title: 'List scene templates',
      description:
        'List the seed Pascal scene templates available to `create_from_template`. Returns the id, display name, one-line description and node count for each.',
      inputSchema: listTemplatesInput,
      outputSchema: listTemplatesOutput,
    },
    async () => {
      const templates = Object.values(TEMPLATES).map((entry) => ({
        id: entry.id,
        name: entry.name,
        description: entry.description,
        nodeCount: Object.keys(entry.template.nodes).length,
      }))
      const payload = { templates }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}
