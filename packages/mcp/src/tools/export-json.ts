import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { SceneBridge } from '../bridge/scene-bridge'

export const exportJsonInput = {
  pretty: z.boolean().optional(),
}

export const exportJsonOutput = {
  json: z.string(),
}

export function registerExportJson(server: McpServer, bridge: SceneBridge): void {
  server.registerTool(
    'export_json',
    {
      title: 'Export JSON',
      description:
        'Return the scene as a serialized JSON string. Pass `pretty: true` to indent with 2 spaces.',
      inputSchema: exportJsonInput,
      outputSchema: exportJsonOutput,
    },
    async ({ pretty }) => {
      const scene = bridge.exportJSON()
      const json = JSON.stringify(scene, null, pretty ? 2 : 0)
      const payload = { json }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}
